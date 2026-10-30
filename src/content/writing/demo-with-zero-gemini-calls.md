---
title: A demo with zero Gemini calls
description: How I put the public MemLedger demo on Cloud Run with no API key, no model calls, one instance by design and a one-line redeploy, inside a project shared with another service.
date: 2026-10-29
kind: technical
tags: [Cloud Run, GCP, Docker]
project: memledger
draft: false
---

The MemLedger demo is public. Anyone can open it and click through the scripted incident as often as they like, and every step drives agents that write to shared memory. The live pipeline turns text into claims with Gemini, and the free tier allowed 20 requests a day. So the deploy had four requirements: make zero model calls, keep the API key out of everything, cost close to nothing, and share a Google Cloud project with another app without disturbing it.

This post covers how I deployed it to Cloud Run under those constraints. How the live extraction pipeline copes with the quota is in [Gemini on twenty requests](/writing/gemini-on-twenty-requests), and what MemLedger does is on the [project page](/work/memledger).

## A public mode that needs no key

Two environment variables put the app in its public mode. `MEMLEDGER_EXTRACT=golden` replays fixed, hand-written reference extractions instead of calling the model, and `MEMLEDGER_AGENTS=offline` runs the agents without a model. In that mode the app never creates a Gemini client, so it has no use for a key, and no amount of clicking can spend quota.

Golden mode passes every step of the scenario. I had planned to serve real Gemini extractions from a cache, and spent most of a morning on it before shipping without it. Why that cache could never replay is its own post, [The cache that never replayed](/writing/cache-that-never-replayed). The live site says in its header that it runs on golden.

![The deployed MemLedger console, with the why-panel open over the memory graph](/img/memledger.jpg)

## Deploying without secrets

The repo's original `deploy.sh` pulled the Gemini key from Secret Manager and passed it to the service. For the public demo I skipped the script and deployed with plain `gcloud`, with no secrets attached.

Before pushing, I checked what was actually inside the image. It had no `.env` file, no local demo state file and no `GEMINI` environment variables, and the extraction cache was present.

## Sharing a project safely

The only Google Cloud project with billing enabled already ran another service. Cloud Build wasn't enabled there, and turning it on meant IAM changes I didn't want to make in a shared project. So I built the image locally with Docker, pushed it to a new Artifact Registry repository, and deployed with `--image`.

The service runs as a new service account, `memledger-run`, with no project roles. The default compute account may be able to read the other service's secrets, and MemLedger needs none of them, so the service doesn't run as that account.

Every command passed `--project` explicitly, so the local gcloud default never changed. For an app with CI and several services I used a different setup, which is in [Keyless deploys to Cloud Run](/writing/keyless-deploys-cloud-run). This one is a single container that I build and push by hand.

## One instance on purpose

The deployed app uses an embedded graph database, so each Cloud Run instance holds its own graph. With two instances, consecutive requests could land on different graphs, and the demo would appear to jump between states. I set `--max-instances=1`.

Capping at one doesn't change the cost. With `--min-instances=0`, an idle service scales to zero either way.

Scaling to zero has a side effect I liked. Each cold start seeds the demo tenants fresh, so most visitors start from a clean run of the scenario.

## Startup and memory

Seeding on every cold start puts the seed on the startup path, so I checked how long startup takes. With `--cpu-boost`:

| Measure | Value |
|---|---|
| Time until the instance passed its startup probe | 4.3 s |
| Of that, seeding the demo tenants | 3.1 s |
| Time the startup probe allows | 240 s |
| Memory requested | 512 MiB |
| Memory the app uses | about 81 MiB |

## Checking the live service

`scripts/smoke.py --full` drives all 20 steps of the acme scenario against the live URL over HTTP and fails on any broken check. It also resets both demo tenants, so it shouldn't run while someone is presenting the demo.

One bug only showed up in a browser. After a redesign, the server had the new CSS, but browsers kept the old file, because the static files were served without cache headers. Adding a version tag to the asset links (`style.css?v=ui1`) forced a fresh download.

## Redeploying in one line

With the image built locally, a redeploy is one line:

```bash
IMG=asia-south1-docker.pkg.dev/<project>/memledger/memledger:$(git rev-parse --short HEAD) && docker build -t $IMG . && docker push $IMG && gcloud run deploy memledger --project=<project> --region=asia-south1 --image=$IMG
```

It builds the image, pushes it to Artifact Registry in `asia-south1` and rolls out a new revision, with the project named on the command instead of taken from the local default. The image tag is the short commit hash, so every revision in Cloud Run maps back to the exact code it runs.
