---
title: Billing that can't double-charge
description: How CortexAI reserves credits with one atomic MongoDB update, refunds failed agent runs, and grants a Razorpay purchase exactly once.
date: 2026-10-06
kind: technical
tags: [Go, MongoDB, Payments, Concurrency]
project: cortexai
draft: false
---

The first prototype of CortexAI charged credits with a read-modify-write: load the user, `user.credits -= cost`, `save()`. Two parallel requests could both pass the balance check and overspend. It also charged before the work and never refunded a failure, so a provider timeout cost the user credits for nothing.

Payments had their own hole. The browser's verify call checked Razorpay's signature but not who owned the order, so anyone holding a genuinely signed payment could replay it against their own account.

## Reserve, commit, refund

Every agent run now goes through three steps, owned by the Go auth service:

| Step | What happens |
|---|---|
| reserve | Subtract the cost with a guarded atomic update, then insert a reservation with `status: "reserved"` |
| commit | Flip the reservation from `reserved` to `committed` when the turn succeeds |
| refund | Flip it from `reserved` to `refunded`, then add the credits back |

Check-and-subtract is a single document update. The balance condition sits in the filter, so MongoDB either matches the document and decrements it, or matches nothing. This is `Reserve` from `backend/internal/auth/mongo_store.go`:

```go
// The $gte guard makes check-and-subtract one atomic operation, so
// concurrent requests can never drive the balance below zero.
var u User
err := s.users.FindOneAndUpdate(ctx,
	bson.M{"_id": userID, "credits": bson.M{"$gte": amount}},
	bson.M{"$inc": bson.M{"credits": -amount}, "$set": bson.M{"updatedAt": now}},
	options.FindOneAndUpdate().SetReturnDocument(options.After),
).Decode(&u)
if mongox.IsNotFound(err) {
	if _, getErr := s.GetUser(ctx, userID); getErr != nil {
		return Reservation{}, 0, getErr
	}
	return Reservation{}, 0, ErrInsufficientCredits
}
```

No transaction is needed. Two writes are still involved, the balance and the reservation record, so I ordered them to fail safe. If inserting the reservation fails, the store gives the credits straight back. If the process dies between the two writes, the user loses that one reservation's cost, but credits can never be minted.

## Settling exactly once

Commit and refund are both a conditional state transition. Only the call that moves the reservation out of `reserved` gets to act. From the same file:

```go
func (s *MongoStore) settle(ctx context.Context, reservationID, status string) (Reservation, bool, error) {
	var r Reservation
	err := s.reservations.FindOneAndUpdate(ctx,
		bson.M{"_id": reservationID, "status": StatusReserved},
		bson.M{"$set": bson.M{"status": status, "updatedAt": s.now()}},
		options.FindOneAndUpdate().SetReturnDocument(options.After),
	).Decode(&r)
	if err == nil {
		return r, true, nil
	}
	// ...
}
```

`Refund` adds the credits back only when `settle` reports that this call flipped the status. A retried refund pays nothing. A commit after a refund, or a refund after a commit, gets `ErrReservationSettled`, so the two can't both win.

## Where the reservation happens

The price depends on which agent handles the message, and that isn't known until the LangGraph router has run. So the reservation lives in a `guard` node that runs after the router and before any expensive call. From `agent/app/graph/router.py`:

```python
async def guard(state: AgentState, config: RunnableConfig) -> AgentState:
    deps, req = deps_of(config), request_of(config)
    agent = state["agent"]
    await deps.limiter.check(req.user_id, agent)
    # Reserve last: if anything above fails there is nothing to refund.
    req.reservation_id, req.credits = await deps.auth.reserve(req.user_id, CREDIT_COST[agent], agent)
    return {}
```

The reservation id goes on a per-request context object rather than graph state, because it has to survive a node raising an error. The API layer in `agent/app/api/chat.py` commits after a successful turn and refunds on any error. Its `settle` helper clears the reservation id before calling auth, so one request can't settle twice.

One case needed a rule of its own: the client disconnecting mid-answer. The code charges only if some output already reached the user:

```python
except asyncio.CancelledError:
    # The client disconnected. If they already received part of an
    # answer the work was done, so it is charged; otherwise refunded.
    await asyncio.shield(settle(deps, rc, commit=rc.streamed_chars > 0))
    raise
```

That stops free answers from someone who cancels at the last token, and still refunds a user who gives up before any output.

## Two ways to hear about a payment

On the buying side, the price always comes from the server's plan table. The client sends a plan name, and an unknown name is a 400. The billing service creates a Razorpay order and a `Payment` record with the caller's `userId` and `status: created`.

Then there are two paths that can confirm the payment, and either can arrive first:

1. Browser verify: Checkout hands the browser `HMAC_SHA256(order_id|payment_id, key_secret)`, and the server checks the HMAC and then checks that the order belongs to the caller.
2. Webhook: Razorpay posts `payment.captured` with `X-Razorpay-Signature`, an HMAC of the raw body. The server verifies it over the exact bytes received, before any JSON parsing, and checks that the amount matches the stored payment. This is the path that credits a user who closes the tab too early.

The ownership check is the fix for the replay bug. From `backend/internal/billing/handler.go`:

```go
p, err := h.Store.GetByOrder(r.Context(), in.OrderID)
// A valid signature proves Razorpay saw a payment for this order, not
// that the order belongs to the caller. Without this check a user could
// replay someone else's signed payment to credit their own account.
if errors.Is(err, ErrPaymentNotFound) || (err == nil && p.UserID != userID) {
	return httpx.NewError(http.StatusNotFound, "not_found", "Payment not found.")
}
```

The webhook handler picks its status codes on purpose. An unknown order or an amount mismatch is logged and acknowledged with 200, so Razorpay stops retrying something that can't succeed. A failure inside fulfilment returns an error, and the non-2xx makes Razorpay retry later.

## Making the grant idempotent

Both paths call the same `fulfill`. It marks the payment paid (a no-op if it already is) and then always asks auth to grant the credits, keyed by order id. It calls the grant every time so that, if an earlier attempt marked the order paid and crashed before granting, the next verify or webhook retry finishes the job.

The grant itself uses the same trick as the reservation. The order id is pushed onto the user in the same atomic update that adds the credits, and the filter refuses to match if it's already there. From `backend/internal/auth/mongo_store.go`:

```go
res, err := s.users.UpdateOne(ctx,
	bson.M{"_id": userID, "appliedGrants": bson.M{"$ne": key}},
	bson.M{
		"$inc":  bson.M{"credits": amount, "totalCredits": amount},
		"$set":  bson.M{"plan": plan, "planExpiresAt": expires, "updatedAt": now},
		"$push": bson.M{"appliedGrants": key},
	},
)
```

A replayed webhook, a retried verify, or both paths firing at once all end in exactly one grant.

## Testing it against a real MongoDB

An in-memory fake would prove nothing here, since the design depends on MongoDB's single-document atomicity. The store tests in `backend/internal/auth/mongo_store_integration_test.go` run against a real database, a throwaway one per test. The central test fires 50 goroutines at a balance of 10:

```go
func TestConcurrentReservesNeverOverspend(t *testing.T) {
	s := newTestStore(t)
	u := newUser(t, s, 10)

	var ok atomic.Int64
	var wg sync.WaitGroup
	for range 50 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, _, err := s.Reserve(context.Background(), u.ID, 1, "chat"); err == nil {
				ok.Add(1)
			}
		}()
	}
	wg.Wait()

	got, err := s.GetUser(context.Background(), u.ID)
	require.NoError(t, err)
	require.EqualValues(t, 10, ok.Load())
	require.EqualValues(t, 0, got.Credits)
}
```

Exactly 10 succeed and the balance ends at 0. Other tests in the same file:

| Test | What it proves |
|---|---|
| `TestRefundIsIdempotent` | Three refunds of one reservation restore the balance once; a later commit fails |
| `TestCommitThenRefundFails` | Commit is idempotent; a refund after it is rejected |
| `TestGrantAppliesOnce` | 10 concurrent grants for `order_123` apply once: 50 + 500 = 550 credits |

The payment handlers are tested separately in `backend/internal/billing/handler_test.go`, with an in-memory store and a fake auth client that is idempotent per key. Those cover a verify replayed three times, two webhooks plus a verify for one order, forged signatures, Mallory replaying Alice's signed payment, an amount mismatch, and a client asking for a plan called `free-money`.

CI runs all of it on every push to `main` and every pull request: the Go job starts a `mongo:7` service container and runs `go test -race -tags integration ./...`, so the concurrency tests also run under the race detector.

## The gap I know about

A process that dies after subtracting and before recording, or a reservation that is never settled, leaves credits deducted with no refund coming. The planned fix is a reaper: a scheduled job that refunds `reserved` records older than about 10 minutes. It isn't built yet. Until it is, every failure I know of can cost a user a few credits, and none can create credits from nothing.
