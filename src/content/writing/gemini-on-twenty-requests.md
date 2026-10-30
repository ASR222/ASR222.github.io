---
title: Gemini on twenty requests a day
description: How MemLedger makes Gemini quote evidence for every claim it extracts, and how its retry, fallback and cache code copes with a free tier of 20 requests a day.
date: 2026-10-26
kind: technical
tags: [Gemini, LLM extraction, Rate limits]
project: memledger
draft: false
---

MemLedger's agents never write raw text into memory. Alerts, logs, webhooks and the agents' own notes go through Gemini first, and Gemini turns them into structured claims about the incident. The model is the part of [MemLedger](/work/memledger) most likely to make something up, so every claim it returns has to quote the input text that supports it. If the quoted evidence isn't in the input, the validator drops the claim.

I built and tested all of this on a free tier that allowed 20 requests a day on the main model, so the code around the model call also had to cope with running out of quota.

## A fixed shape for every claim

Extraction uses Gemini's `response_schema`, so the model returns claims in a fixed shape: predicate, value, certainty and evidence. It runs at temperature 0, and predicate and certainty are enums, so the model can't invent a new predicate. Everything after the model call is deterministic code. I wrote up the grounding check, the hedge downgrade and the full list of validator checks in [Grounded claims, separate graphs](/writing/memledger-grounding-and-tenancy), so I'll skip them here.

The extraction test prints one line per claim. A kept claim is a `KEEP` line with its quote after a `|`, and a claim the validator rejects is a `DROP` line. I found the drops the most useful part of that output, because each one shows exactly where the model stretched past what the text said.

Late in the build I looked at moving to Groq. I stayed with Gemini because extraction leans on that strict schema, and swapping providers on the last day of the build was the bigger risk. A second provider can sit behind `agents/llm.py` later.

## Two prompt rules that fixed most misses

The second version of the prompt, `ext-v2`, added two rules, and between them they fixed most of the misses I was seeing. Text filed under an incident counts as being about that incident even when it doesn't name it. Recommended actions count as mitigations.

Even with `ext-v2`, one step still separated the two models I could use. At step 8 of the 20-step scenario, a webhook, `gemini-3.5-flash-lite` left out a "flush cache" mitigation that `gemini-3.5-flash` returned. That one missing claim failed four later checks in the scenario, because those steps built on it.

The scenario itself, and what happens when one of its sources turns out to be compromised, is in [Retracting a source in one query](/writing/memledger-revoke-a-source).

## Living on the free tier

The free tier gave me 20 requests a day on `gemini-3.5-flash`, resetting at midnight Pacific, which is 12:30 PM in India. `gemini-2.5-flash` returned 404 for my key, so 3.5 Flash became the default and 3.5 Flash-Lite the fallback.

The retry layer, `memledger/llm_retry.py`, handles 429 and 503 errors. On each one it waits as long as the error asks, or otherwise backs off for up to 60 seconds. It retries up to `GEMINI_MAX_RETRIES` times (default 5), and after that it tries `GEMINI_FALLBACK_MODEL`.

## Two kinds of 429

The same status code meant two different things, and each needed its own handling.

A per-minute limit clears in seconds, so waiting and retrying is the right response. Spacing calls about 12 seconds apart avoided most of these in the first place.

A daily-quota 429 won't clear until the next reset, so retrying only burns time. On that error the code now skips the retries and switches to the fallback model immediately.

A 429 during an agent step used to crash the whole demo run. Now it fails that step's check, records the reason, and the run continues to the next step.

## Don't cache the fallback

Code review caught a quieter bug. Extraction results are cached so a repeated call doesn't spend quota again. When Flash hit its quota and Flash-Lite answered, the cache stored Flash-Lite's answer under Flash's key. Given what happened at step 8, that was a real problem: a weaker extraction could sit in the cache and replay forever as if Flash had written it.

The fix was small. `generate` now reports which model actually answered, and the extractor writes to the cache only when the main model did. A fallback answer is used for the call that needed it and is not stored.

That cache had a deeper problem that I only found later, when I tried to replay real extractions for the public demo. A random ID inside the Comms agent's text meant the keys could never match across runs. I wrote up [why that cache could never replay](/writing/cache-that-never-replayed) separately.

## Quota belongs to the project

One more thing I learned the hard way. Free-tier quota belongs to the Google Cloud project, and the API key has nothing to do with it. Two keys in the same project share the same 20 requests a day. A key in a new project starts fresh.

With a budget that small, the public demo couldn't spend any of it. Anyone can click through the deployed site as often as they like, so it replays fixed reference extractions and never creates a Gemini client at all. The deploy needs no API key, and I described [how it ships with zero Gemini calls](/writing/demo-with-zero-gemini-calls) in its own post.
