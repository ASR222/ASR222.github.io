---
title: The cache that never replayed
description: Why MemLedger's cache of real Gemini extractions could not replay, how a dry run hid it, and the two fixes on the table.
date: 2026-10-28
kind: technical
tags: [Caching, LLM extraction, Reproducibility]
project: memledger
draft: false
---

I wanted the public MemLedger demo to replay real Gemini extractions from a cache. Visitors would see what the model actually returned for each alert and note, and clicking through the demo would cost nothing from a free tier that allowed 20 requests a day on `gemini-3.5-flash`. I spent most of a morning on it and shipped without it. The cause was a random ID inside a sentence.

MemLedger is shared memory for a set of incident-response agents (Triage, an Investigator and Comms), stored as a graph in FalkorDB. Agents never write raw text into memory. Gemini turns every input, including the agents' own notes, into structured claims, and each claim has to quote the input text that supports it. A validator drops any claim whose quoted evidence is not in the input. I wrote up that check in [Grounded claims, separate graphs](/writing/memledger-grounding-and-tenancy). It comes back later in this story as the second reason the cache could never work.

## How the cache is keyed

The cache key covers the input text and the beliefs already known for the incident at that step. I chose that on purpose. The same alert, read in a different state of memory, can mean something different, so it should be extracted again.

The cost is that every key depends on everything the scenario wrote before it. The acme demo scenario runs 20 steps, and one different belief early on changes every key that comes after it.

The cache already carried one rule from an earlier bug. It stores an answer only when the main model produced it, so a Flash-Lite fallback answer can never replay under Flash's key. The [quota post](/writing/gemini-on-twenty-requests) has that story.

## The first miss came from the agents

The cache I committed came from a run with live agents, which use the model. The deployed site runs offline agents (`MEMLEDGER_AGENTS=offline`), which run without a model and write different beliefs. At steps 5, 7 and 8 the known values differed from the recorded run, so the keys differed and the lookups missed. The smoke test, `scripts/smoke.py --full`, drives all 20 steps against the live URL over HTTP. It failed on those three steps and on the later ones that depended on them.

The fallback extraction mode, golden (`MEMLEDGER_EXTRACT=golden`), replays hand-written reference claims. It passed every step. I deployed on golden and planned to fill the cache for the offline configuration once the daily quota reset at midnight Pacific, which is 12:30 PM in India. The deploy itself, which makes [zero Gemini calls and holds no API key](/writing/demo-with-zero-gemini-calls), is a separate post.

## A dry run that couldn't fail

With 20 requests a day there was no room for a wasted run, so I budgeted first. The dry run answered each cache miss with the golden claims and counted the misses. It reported 11 calls, well under the limit, and every step passed.

## The live run

The live run made 8 successful calls, lost step 8 to a failed request, and hit the daily limit at step 20. I stopped there and committed nothing.

Free-tier quota is counted per Google Cloud project, and two keys in the same project share the same 20 requests, so I got a key from a fresh project, which starts with a full allowance. Before spending any of it, I replayed the partial cache in cache-only mode as a check. Step 5 missed, even though the live run had just written it.

## The root cause

Fact IDs in MemLedger are random (`uuid4`). Comms' status text cites them inline, like `payments-api [f-23e93a9b]`, and that text gets extracted like any other input. So:

1. Comms' text is different on every run, so its cache key never matches.
2. Step 4 misses, so no status gets stored.
3. The known values at step 5 change, so step 5's key changes, and every later key changes with it.

Comparing two runs side by side made the shape plain. Both runs produced the same key at step 3. From step 4 on, every key differed.

## Matching keys would have failed too

Suppose the keys had matched. The cached answers quote the old IDs as evidence, because the grounding rule makes every claim quote its supporting text, and Comms' text contained IDs. On replay the validator checks that evidence against the new text, where the old IDs no longer appear, and drops the claim. The cache would have hit and the claims still would not have survived.

That second failure is the more uncomfortable one, because the validator is doing its job. To the grounding check, a cached quote with a stale ID is evidence that is not in the text.

## What the dry run hid

Golden claims answered every miss, so the chain never broke and the IDs never mattered. Step 4 got an answer whatever its key was.

A dry run that substitutes answers can count calls. It cannot tell you whether a replay will match, because the substitution removes the exact dependency that breaks the replay.

## Two fixes

The first fix is deterministic fact IDs in scenario runs. The same run would then produce the same Comms text, the same keys and the same evidence quotes. Fact IDs belong to the memory core, though, and changing how they are made touches nearly every test.

The second fix is smaller. Strip `[f-...]` citations from the text before computing the cache key and before checking evidence. That makes the key stable and lets old quotes match new text. It touches the validator, though, and the validator is the one piece that stops the model from inventing facts.

On the last day of the build, neither was worth the risk. The live site runs on golden, its header says so, and the live Gemini runs are recorded in the project log. Deterministic replay is first on my list for MemLedger now, since any memory system that caches model output on top of its own state will need it.
