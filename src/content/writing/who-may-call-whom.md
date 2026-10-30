---
title: Who may call whom
description: CortexAI's internal services trust an X-User-Id header, so several layers make sure only the gateway can set it.
date: 2026-10-27
kind: technical
tags: [Go, Security, GCP, Microservices]
project: cortexai
draft: false
---

Every internal service in CortexAI identifies the user from one HTTP header, `X-User-Id`. The chat service lists conversations for whatever id that header carries. The billing service creates orders for it.

That's a convenient design and a dangerous one. If a request reaches the chat service with `X-User-Id: victim`, it gets the victim's conversations. The services take the header on trust, so the security question is who can get a request to them with that header set.

Only the gateway should be able to. This post goes through the layers that make that true, on Google Cloud Run and in Docker Compose.

## Where the user id comes from

The gateway is the only public service. A browser signs in with Google through Firebase, the auth service verifies the ID token, and the gateway creates a server-side session in Redis. The cookie holds a random 256-bit token, and Redis stores only its SHA-256 hash, so read access to Redis doesn't give anyone a usable session.

On each request, the gateway's `requireSession` middleware looks the cookie up and puts the user id into the request context. That context value is the only source for `X-User-Id`. Write requests also need an `X-Requested-With: XMLHttpRequest` header, which a cross-site page can't add without a CORS preflight the gateway never approves. That's the CSRF layer on top of `SameSite=Lax`.

## Layer 1: the gateway owns the headers

The gateway forwards to services through `httputil.ReverseProxy`. Before setting its own headers, it deletes every header a client must never control. From `backend/internal/gateway/proxy.go`:

```go
var headersFromClient = []string{
	httpx.HeaderUserID,
	httpx.HeaderInternalToken,
	httpx.HeaderRequestID,
	"Cookie",        // services have no use for the session cookie
	"Authorization", // only the gateway's own Google identity token may reach services
	"X-User-Email",
	"X-User-Avatar",
}
```

And in the proxy's `Rewrite` function:

```go
for _, h := range headersFromClient {
	pr.Out.Header.Del(h)
}
pr.Out.Header.Set(httpx.HeaderInternalToken, internalToken)
pr.Out.Header.Set(httpx.HeaderRequestID, httpx.RequestID(pr.In.Context()))
if uid, ok := userIDFrom(pr.In.Context()); ok {
	pr.Out.Header.Set(httpx.HeaderUserID, uid)
}
```

Deleting first, then setting, means a spoofed value never survives, even on a path where the gateway sets nothing. The request id gets the same treatment: the gateway creates it and ignores any id the client sends, so the `request_id` in every service's logs can be trusted when tracing a request.

## Layer 2: internal routes stay inside

Services expose `/internal/...` endpoints for each other. The chat service's are an example: `/internal/users/{userId}/conversations/{id}/messages` takes the user from the path, not the header, because the agent calls it on the user's behalf. If the gateway forwarded `/api/chat/internal/...` as a prefix rewrite, those would be one URL away from the internet.

The gateway refuses any path with an `internal` segment, in any case, along with `..`, `.`, percent-encoded segments and backslashes. From `backend/internal/gateway/proxy.go`:

```go
func safePath(p string) bool {
	for _, seg := range strings.Split(p, "/") {
		s := strings.ToLower(seg)
		if s == "internal" || s == ".." || s == "." || strings.Contains(s, "%") || strings.Contains(s, "\\") {
			return false
		}
	}
	return true
}
```

The guard checks both the decoded path and the raw path, and a rejected path is a plain 404.

## Layer 3: Google identity tokens on Cloud Run

Headers and paths only help if the internal services can't be reached directly. On Cloud Run, every service gets a public URL, so network isolation isn't available. Instead, the four internal services require IAM.

Each service runs as its own service account. A caller has to present a Google-signed identity token for its own account, and that account needs `roles/run.invoker` on the specific target service. Google's front end checks this before the request reaches the container.

The caller gets the token from the metadata server, which is only reachable from inside Google Cloud. From `backend/internal/platform/gcpauth/gcpauth.go`:

```go
// Token returns a cached identity token for audience, refreshing it five
// minutes before it expires.
func (m *MetadataIDTokens) Token(ctx context.Context, audience string) (string, error) {
	m.mu.Lock()
	if c, ok := m.cache[audience]; ok && time.Now().Before(c.refresh) {
		m.mu.Unlock()
		return c.token, nil
	}
	m.mu.Unlock()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.URL+"?audience="+url.QueryEscape(audience), nil)
	// ...
	req.Header.Set("Metadata-Flavor", "Google")
	// ...
}
```

Tokens are cached per audience. The proxy puts the token in `Authorization`, which is why the client's own `Authorization` header is on the strip list. This only switches on when `SERVICE_AUTH=google`, so local development doesn't need it.

The grants are defined in `infra/locals.tf` and mirror the call graph exactly:

| Caller | May invoke |
|---|---|
| gateway | auth, chat, billing, agent |
| agent | auth, chat |
| chat | agent |
| billing | auth |

Anything else gets a 403 from Google. Billing needs to grant credits after a payment, so it can call auth. It has no reason to read conversations, so it can't call chat or agent. If the billing service were compromised, it still couldn't reach a user's messages.

## Layer 4: a shared token anyway

On top of IAM, every internal service rejects requests without the correct `X-Internal-Token`. From `backend/internal/platform/internalauth/internalauth.go`:

```go
got := []byte(r.Header.Get(httpx.HeaderInternalToken))
// ConstantTimeCompare avoids leaking the token through timing.
if len(expected) == 0 || subtle.ConstantTimeCompare(got, expected) != 1 {
	httpx.WriteJSON(w, http.StatusUnauthorized, &httpx.Error{
		Code: "unauthorized", Message: "Invalid internal token.",
	})
	return
}
```

The Python agent does the same with `hmac.compare_digest`. An empty configured token rejects everything, so a missing secret fails closed.

On Cloud Run the token still protects the services if an IAM binding is ever misconfigured. In Docker Compose there are no identity tokens, and the services sit on a private network where only Caddy publishes ports, so the shared token is the main guard there.

## The keep-alive exception

Free-tier databases suspend when idle. A daily Cloud Scheduler job calls the agent's `/internal/keepalive`, which pings Qdrant, Redis and (through chat) MongoDB.

Putting the shared token in the scheduler job would leave it readable in the job's settings. So the job authenticates with an identity token for its own service account, `cortex-scheduler`, which has `roles/run.invoker` on the agent and nothing else. The agent exempts exactly that path from the token check. The endpoint reads no user data and changes nothing, and the gateway's path guard means it can never be reached from outside through the gateway.

## Why not mTLS

On Cloud Run, Google terminates TLS, so there's no certificate for me to issue or rotate. IAM gives per-caller, per-service authorization with audit logs. Identity tokens last an hour and no key files exist. For five services on a free-tier budget, that's less to operate and less to leak.

## What the tests check

The gateway tests in `backend/internal/gateway/gateway_test.go` run the real gateway against fake upstreams:

| Test | Checks |
|---|---|
| `TestProxyReplacesSpoofedIdentityHeaders` | A client sends `X-User-Id: victim` and a guessed internal token; chat receives the session's user id, the real token, and no cookie |
| `TestInternalRoutesAreNeverForwarded` | `/api/chat/internal/...`, `/api/chat/INTERNAL/x` and `/api/agent/internal/...` are 404 and never reach a service |
| `TestIdentityTokenReplacesClientAuthorization` | The client's `Authorization` is replaced by the gateway's identity token |
| `TestClientAuthorizationIsStrippedWithoutIdentityTokens` | With identity tokens off, the client's `Authorization` is still removed |
| `TestRequestIDFromClientIsNotTrusted` | A client-supplied request id is ignored |
| `TestCSRFHeaderRequiredForWrites` | A POST without `X-Requested-With` is a 403 |
| `TestRedisStoresOnlyHashedSessionIDs` | The raw cookie token never appears as a Redis key |

On the agent side, in `agent/tests/test_api.py`, `test_requires_internal_token` checks that `/chat` without the token is a 401 while `/healthz` stays open. `test_keepalive_needs_no_internal_token_and_pings_everything` and `test_other_internal_routes_still_need_the_token` check that the keep-alive exemption covers that one route and no other.

The layers overlap on purpose. Header stripping assumes the gateway is the only way in. IAM makes that true on Cloud Run, the private network makes it true in Compose, and the shared token covers the case where either of those is set up wrong.
