---
title: Retracting a source in one query
description: How MemLedger uses one Cypher traversal to withdraw everything a compromised source said, and everything agents concluded from it, without losing the audit trail.
date: 2026-10-24
kind: technical
tags: [Cypher, FalkorDB, Provenance]
project: memledger
draft: false
---

At 13:45 a cache integration posts this to our incident:

```json
{
  "integration": "cache-svc",
  "event": "health.degraded",
  "time": "2026-10-17T13:44:02+05:30",
  "message": "Redis cluster down since 09:50, possibly the cause of upstream latency.",
  "recommended_action": "Flush cache on all nodes."
}
```

The webhook has trust 0.6, above our 0.5 threshold, so "flush the cache" becomes an active mitigation. Five minutes later the Comms agent includes the cache flush in a status update to stakeholders. At 14:20 we learn the integration was compromised.

So what do we take back? Everything the webhook said directly, plus anything an agent concluded from it, possibly a different agent and possibly hours later. In a chat history or a key-value scratchpad nobody can answer that. In MemLedger it is one query.

MemLedger is the system we built as a team for GraphHacks 2026, and this post walks through how that query works.

## The provenance edges

Every fact in MemLedger is a node in a FalkorDB graph, and two edge types carry provenance:

- `(Fact)-[:FROM_SOURCE]->(Source)`: the source that asserted the fact.
- `(Fact)-[:DERIVED_FROM]->(Episode)`: the logged turn it was extracted from. Episodes have their own `FROM_SOURCE` edge.
- `(Fact)-[:DERIVED_FROM]->(Fact)`: earlier facts an agent cited when it concluded this one.

The agents write that last edge themselves. When an agent records a conclusion, its tool call passes the fact ids it reasoned from as `parents`, and the memory core rejects parents that are not active. So "fail over checkout-api to the standby database" points back at the `affects_service=checkout-api` fact it was built on, which points back at the alert episode, which points at the `alerts` source.

## Previewing the blast radius

Revoking is irreversible, so the operator does a dry run first. This is `BLAST_RADIUS` from `memledger/queries.py`:

```cypher
MATCH p = (s:Source {id:$source})<-[:FROM_SOURCE|DERIVED_FROM*1..6]-(f:Fact)
WHERE f.status IN ['active','quarantined']
WITH s, f, min(length(p)) AS hops
OPTIONAL MATCH (f)-[d:FROM_SOURCE]->(s)
WITH f, hops, count(d) > 0 AS direct
OPTIONAL MATCH (a:Agent)-[w:WROTE]->(f)
WHERE w.corroborates IS NULL
RETURN f.id AS id, f.subject AS subject, f.predicate AS predicate,
       f.object AS object, f.status AS status, a.id AS writer, hops, direct
ORDER BY hops, f.valid_from
```

It walks backwards from the source along provenance edges, up to 6 hops, and returns every live fact it reaches along with who wrote it. `direct` is true when the fact has its own `FROM_SOURCE` edge to the source. You can't get that from the hop count: a fact derived from one of the source's facts is also two hops away, the same distance as a direct fact's path through its episode. The operator layer in `memledger/trust.py` groups the result by agent, and a test checks that the preview returns exactly the fact ids the real revoke will touch.

## The revoke

This is `REVOKE` from `memledger/queries.py`, the whole thing:

```cypher
MATCH (s:Source {id:$source})
SET s.compromised = true
WITH s
MATCH (s)<-[:FROM_SOURCE|DERIVED_FROM*1..6]-(f:Fact)
WHERE f.status IN ['active','quarantined']
WITH DISTINCT f
SET f.revoked_from = f.status, f.status = 'revoked', f.valid_to = $now
WITH f
OPTIONAL MATCH (a:Agent)-[w:WROTE]->(f)
WHERE w.corroborates IS NULL
RETURN f.id AS id, f.subject AS subject, f.predicate AS predicate,
       f.object AS object, a.id AS writer
```

Four things happen in one statement. The source is marked compromised. The query finds every active or quarantined fact connected to it within 6 hops, across all agents. Each of those gets `status = 'revoked'` and a `valid_to`, and the status it had before goes into `revoked_from`, which time travel needs later.

The Python side in `memledger/memory.py` is thin. It takes the per-tenant lock so the revoke cannot interleave with a write, checks that the source exists, and runs the query:

```python
def revoke(tenant, source, now) -> list[dict]:
    """Mark a source compromised and revoke everything that depends on it."""
    with _tenant_lock(tenant):
        g = graph(tenant)
        if not _rows(g.ro_query(Q.SOURCE_INFO, {"id": source})):
            raise UnknownReference(f"unknown source {source!r}")
        return _rows(g.query(Q.REVOKE, {"source": source, "now": now}))
```

## Two revokes in the incident

Our scripted incident has two revocations, and they reach different numbers of agents.

The webhook revoke touches one agent. At 14:20 the preview for `webhook` returns two facts, both written by the Investigator: the active `mitigation=flush-cache` and the quarantined `root_cause=redis-outage` (the "possibly the cause" claim, held back because it was hedged). Revoke withdraws both. The runbook's root cause and rollback stay active, and Comms' next update no longer mentions the flush.

Comms' 13:50 update did cite flush-cache, but its status value ("mitigating") matched the existing status fact. It was stored as a corroboration of that fact, and corroboration does not add new parent links, so the status fact is not in the webhook's blast radius.

The alert feed revoke touches three agents. Session three adds a forged alert at 16:00 saying `checkout-api` is failing too. Triage records it, and the Investigator concludes a failover for checkout-api and cites that fact. At 16:20 we learn the alert feed's token was leaked. The preview for `alerts` now returns five facts:

| Writer | Facts | How they reach `alerts` |
|---|---|---|
| Triage | `affects_service=checkout-api`, `affects_service=payments-api`, `severity=sev1` | asserted directly |
| Investigator | the checkout-api failover | concluded from the forged alert fact |
| Comms | `status=mitigating` | its session-1 status cited the 09:58 alert facts as parents |

One revoke withdraws exactly those five. Root cause, rollback and owner came from the runbook, so they stay active. Comms then writes a fresh status that cites only surviving facts.

The revoke also withdraws the genuine 09:58 alert facts, on purpose: once a feed's token is known to be leaked, we don't trust anything it said.

## What an agent sees afterwards

![The MemLedger console: the why-panel open over the memory graph, with the scripted steps and sources](/img/memledger.jpg)

- Revoked facts drop out of current beliefs. Agents read memory only through queries that match `status:'active'`, so the facts disappear from every agent's view at once.
- The source cannot write again. `write_fact`, `retract` and `ingest` raise `CompromisedSource`, and `ingest` checks before logging anything.
- Poisoned spellings stop spreading. We leave revoked values out of the known values we show the extractor, so the model isn't nudged to reuse them.
- Handoffs show the change. A handoff between agents carries fact ids rather than text, and the pending-handoffs query returns each carried fact's current status, so a receiver can see that something it was handed has since been revoked.
- Older beliefs are not reinstated. If a revoked fact had superseded something, that older fact stays closed, so after revoking a bad root cause there is no active root cause until someone writes a new one. We did not want the system to fall back to an old belief without anyone noticing.
- History is kept. Nothing is deleted. Asking "what did we believe at 13:55?" still returns the cache flush, because the team did believe it then. A claim that was only ever quarantined does not appear, which is what `revoked_from` is for.

There is no un-revoke. If a source was revoked by mistake, the documented path is a new source id and re-ingesting what it said.

## Choices and limits

Taint is coarse. If a trusted source also asserted a fact that a compromised source corroborated, the fact is still withdrawn. For a security feature we chose "when in doubt, retract". The trusted source can re-assert it, which creates a fresh fact with clean provenance. We could count the remaining clean support before revoking, but we did not build that.

Junk echoes are ignored. Taint opens up one abuse: a low-trust source repeats a true fact, gets revoked, and takes the true fact down with it. So when an untrusted source asserts something that is already active, the write is ignored and no edge is added.

Six hops is a hard limit, and deeper derivation chains are not followed. The same `*1..6` appears in `REVOKE`, `BLAST_RADIUS`, `WHY`, `WHY_PATHS` and `STALE`, and they need to change together.

There is no operator authentication. Anyone who can reach the operator routes can revoke. That was acceptable for a hackathon demo, and it is written down as a known limit.

Without the graph, this feature could not exist at all. A revoke is a variable-length traversal over provenance edges written at the moment each belief was created, and if those edges are not recorded at write time, there is nothing to walk later.
