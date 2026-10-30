---
title: Keyless deploys to Cloud Run
description: How CortexAI deploys five services to Cloud Run from GitHub Actions without a key file anywhere, and how Terraform and CI split ownership.
date: 2026-10-20
kind: technical
tags: [GCP, Terraform, GitHub Actions, DevOps]
project: cortexai
draft: false
---

The original prototype of CortexAI had a service-account private key committed to its repository. I removed the need for that one by verifying Firebase ID tokens directly against Google's public keys. Then I set one rule for the production setup: no key file anywhere, whether in the repo, in a GitHub secret, or in a container image.

This post covers how that works for five services on Google Cloud Run: the CI pipeline, the per-service identities, the secrets, and how Terraform and CI avoid overwriting each other.

## GitHub's token, Google's credentials

GitHub Actions can mint a short-lived OIDC token for each workflow run. Workload Identity Federation lets Google's STS exchange that token for credentials of a service account. No long-lived secret changes hands.

The trust is defined in `infra/cicd.tf`. The part that matters is the condition:

```hcl
resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  attribute_condition = "assertion.repository == '${var.github_repo}' && assertion.ref == 'refs/heads/main'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}
```

A token from a fork, from another repository, or from a branch other than `main` doesn't match, so it can't become deployer credentials. A pull request can run the tests but can't deploy.

On the workflow side, `.github/workflows/ci.yml` gives only the deploy job the `id-token: write` permission, and the job only runs after the Go, agent, frontend and Terraform jobs pass:

```yaml
deploy:
  name: Deploy to Cloud Run
  # Only after every check passes, only for pushes to main, one at a time.
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  needs: [go, agent, frontend, terraform]
  runs-on: ubuntu-latest
  permissions:
    contents: read
    id-token: write # lets GitHub mint an OIDC token for Workload Identity Federation
  concurrency: { group: deploy-production, cancel-in-progress: false }
```

The `concurrency` group means two pushes in quick succession deploy one after the other instead of racing. The job then authenticates with `google-github-actions/auth@v2`, passing the pool provider and the `cortex-deployer` service account, and runs `deploy/gcp/deploy.sh`.

## What the deployer may do

A keyless credential is still a credential, so I kept the deployer small. It has three grants in `infra/cicd.tf`:

| Grant | Why |
|---|---|
| `roles/run.developer` on the project | Roll out new revisions. It can't change IAM policies. |
| `roles/artifactregistry.writer` on the `cortex` repository | Push images |
| `roles/iam.serviceAccountUser` on each runtime account | Start revisions that run as those accounts |

An earlier, script-based setup gave the deployer `roles/run.admin` and `roles/secretmanager.viewer`. The deployment guide now includes the commands to remove those leftovers.

## Terraform owns config, CI owns the image

Having both Terraform and CI touch Cloud Run is an easy way to get them fighting: CI deploys a new image, and the next `terraform apply` rolls it back to whatever the `.tf` file says. I split ownership cleanly. In `infra/services.tf`, each service starts from Google's placeholder image and Terraform ignores the image after that:

```hcl
lifecycle {
  ignore_changes = [
    client,
    client_version,
    template[0].containers[0].image,
  ]
}
```

And `deploy/gcp/deploy.sh` changes nothing but the image:

```bash
# Internal services first, the public gateway last.
for svc in auth chat billing agent gateway; do
  echo "==> Rolling out cortex-$svc"
  gcloud run services update "cortex-$svc" --region "$REGION" --image "$REGISTRY/$svc:$TAG" --quiet
done
```

Images are tagged with the first seven characters of the commit SHA. Env vars, memory, scaling, secrets and IAM all live in Terraform. So code ships on every green push without anyone running Terraform, and an infrastructure change is a reviewable diff that can't undo a code deploy.

CI runs only `terraform fmt -check`, `init -backend=false` and `validate`. A human runs `plan` and `apply` from Cloud Shell. Running `plan` in CI would need broad read access to IAM and secret metadata, and that would undo the point of keeping the deployer small. The trade-off is that someone has to remember to apply infrastructure changes.

## One identity per service

Each of the five services (gateway, auth, chat, billing, agent) runs as its own service account, `cortex-<name>`. That pays off for secrets and for calls between services.

For secrets, Terraform maps each Secret Manager secret to the services allowed to read it, in `infra/locals.tf`, and creates one IAM binding per pair. A few rows:

| Secret | Readers |
|---|---|
| `internal-token` | gateway, auth, chat, billing, agent |
| `mongodb-uri` | auth, chat, billing |
| `redis-url` | gateway, agent |
| `groq-api-key`, `google-api-key`, `tavily-api-key` | agent |
| `razorpay-key-secret`, `razorpay-webhook-secret` | billing |

Secrets reach the containers as env vars pinned to `latest`. Only the agent can write to the Cloud Storage bucket, which holds user files.

For calls between services, only the gateway is public. The other four reject any request without a Google identity token from a service account that holds `roles/run.invoker` on that specific service, and the grants mirror the call graph. I cover that layer in more detail in [Who may call whom](/writing/who-may-call-whom).

## Secret values stay out of Terraform

Terraform state is stored as plain JSON. If Terraform set secret values, those values would be in the state file. So Terraform manages only the secret containers and who may read them. The values are uploaded by `deploy/gcp/bootstrap.sh` from a local `secrets.env` that is never committed, and the guide says to delete that file afterwards.

Bootstrap also does the other thing Terraform can't do for itself: it creates the versioned GCS bucket that holds Terraform's remote state.

## URLs known before services exist

The services call each other in a cycle at deploy time: gateway calls agent, agent calls chat, and chat calls agent to clean up a deleted conversation's files and vectors. If each service read the others' URLs from resource attributes, Terraform would see a dependency cycle.

Cloud Run URLs are deterministic, so `infra/locals.tf` computes them instead:

```hcl
# Cloud Run URLs are deterministic, so services can reference each other
# without depending on each other's resources (no cycles).
url = { for s in local.services : s => "https://cortex-${s}-${var.project_number}.${var.region}.run.app" }
```

## Guardrails

Terraform came to this project after the infrastructure already existed, created by a `setup.sh` script and `gcloud run deploy`. `infra/imports.tf` uses `import` blocks to adopt those resources into state without recreating anything. The guide's instruction for that first plan is to stop if anything says `destroy` or `must be replaced`.

To make a mistake fail loudly instead of deleting data:

- The files bucket and every secret have `prevent_destroy`.
- Every Cloud Run service has `deletion_protection = true`.
- The bucket has `public_access_prevention = "enforced"`.

## What it costs, and the trade-offs

Every service scales to zero and is capped at 2 instances by default. Artifact Registry has a cleanup policy that keeps the 3 newest images per service. The deployment guide's estimate is $0 to $1 a month, mostly within free tiers, with a manual budget alert as the backstop.

The trade-offs are written down in the design notes:

- After idle time, the first request waits for containers to start (a cold start), and the wait is longest for the Python agent. `startup_cpu_boost` shortens it, and the UI says it's waking up.
- Atlas network access is `0.0.0.0/0`, because Cloud Run has no fixed outbound IP without paid Cloud NAT. The generated password and TLS are the protection.
- Free tiers go to sleep, so a daily Cloud Scheduler job pings Qdrant, Redis and MongoDB through the agent to keep an idle demo from being suspended.
- Applying infrastructure is manual. For a team, the next step would be a protected apply environment with approval.

None of these trade-offs involve a key: every credential in the system is either short-lived and minted on demand, or sits in Secret Manager where only the service that needs it can read it.
