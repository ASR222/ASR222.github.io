---
title: Rules I write for coding agents
description: What my CLAUDE.md files tell Claude Code on real projects, the checks they push back onto me, and how HazeBusters and MemLedger disclose AI use, quoted from the repos.
date: 2026-10-18
kind: journey
tags: [AI agents, Claude Code, Workflow]
draft: false
---

Every Claude Code session on HazeBusters starts with one file. The HazeBusters `CLAUDE.md` opens like this:

> Handoff for Claude Code or any new AI chat session. Read this fully before helping.

This post covers what my instruction files tell the agent, what they make me check, and how each repo records who wrote what. Everything quoted is in the public repos.

## One file the agent reads first

The file says who wins when it and I disagree: "when something here conflicts with what the user says now, the user wins", and then the file gets updated, so it keeps changing along with the project.

Section 0 is the working rules. A few of them:

- "Read only CSVs; never browse image folders." The datasets live outside the repo.
- "Never commit data, model weights, `.env`, keys or secrets."
- "Only report metrics read from files on disk (`ml/runs/...`); run long jobs in the foreground or detached and verify on disk."
- "Prefer small, working, committed steps over big rewrites. Commit after each working step."
- "User prefers concise, practical, informal answers."

The results file follows the metrics rule. `ml/RESULTS.md` opens with "All numbers are copied from files in `ml/runs/`."

Section 2 is the hackathon's hard rules, headed "violating these = disqualification". Build only after the clock starts. And no reuse of my older project: AQI Vision "must not be reused: no code, no weights (`aqi_model.keras`), no frontend, not the name. Ideas/knowledge are fine."

The rest of the file reads like a lab notebook, so a new session picks up where the last one stopped. It has the frozen train/val/test date split with row counts, the result that killed the image-to-AQI model (32.0% on held-out dates against a 47.5% baseline) with the run directory it came from, the AWS layout, and a status section with test counts after a merge ("backend 68, shared 50, infra 92"). It also records known limitations, like this one about the quality gate: "bright indoor scenes (white walls/ceiling, windows) can pass as overcast sky".

## Many sessions, one board

MemLedger, our GraphHacks project, needed a different shape: several agent sessions working on one codebase. Its `CLAUDE.md` is short and strict:

```text
- ONE TASK PER SESSION. Claim one board task, finish it, write the handoff note
  (`status.py done/release <ID> --note ...`), push, then end the session.
# ...
- Only edit files listed in your task's Locks. Need another file? Add it to the task's locks
  through the board first; if that clashes, stop and report.
```

Tasks live on a board (`SETUP-STATUS.md`) and are claimed with `scripts/status.py`. A session loads only the sections its task names ("Never read all the docs"). All Cypher goes in one file, `memledger/queries.py`. And a task is "done" only when two commands say so: "`pytest -q` matches INSTRUCTIONS.md §2 (or better) and `python scripts/status.py check` is OK."

The same file has this rule: "Don't change test expectations to make a failure go away."

## A debugging playbook as a skill

MemLedger also has a Claude Code skill, `.claude/skills/memledger-debug/SKILL.md`, for when something breaks. It opens with a method: "Follow these in order. Don't skip to editing code."

1. Reproduce in rehearsal mode first (no key, no Docker, deterministic).
2. Find the layer, using a table that maps each layer to its files, tests and design doc.
3. Look at the graph, not just the code.
4. Fix at the lowest layer that's wrong.
5. Add or adjust a test that would have caught it.
6. Record it.

It states the expected suite result exactly ("150 passed, 1 skipped, 3 xfailed"), names the skipped test and each expected failure, and marks the xfails as strict, so a fix that lands shows up as a failure until someone removes the marker. It repeats the test rule in stronger form: "**Never** edit a test's expected value just to make it pass without understanding why it changed."

One row in its symptom table is about quoting numbers. Local tests use embedded FalkorDB 4.18.3 and Docker pulls 6.x, so numbers can differ: "rerun bench and eval on the real DB before quoting numbers."

## What the files push back onto me

Across these files, I need to be able to check the agent's claims without trusting the agent:

- Metrics come from files on disk, with the run directory named.
- Tests have an expected count written down, so "tests pass" can be compared with a number.
- "Done" is two commands I can rerun.
- Test expectations are not something an agent may edit to get green.

## How the repos disclose AI use

The two hackathon repos handle attribution differently.

For HazeBusters, one of the hard rules in `CLAUDE.md` is:

> **List AI coding tools used** in the writeup (Claude Code etc.) even though commits carry no AI trailer. Credit everything not written by us.

The no-trailer part is a rule too ("Never add `Co-Authored-By` trailers or AI attribution to commits/PRs", and commit attribution is turned off in my Claude Code settings). The disclosure lives in the README credits instead: "**AI tools:** Claude Code and Claude chat were used for code, experiments and docs". The writeup splits it further: "Claude Code (code, experiments, docs) and Claude chat (planning, review)."

MemLedger records it in the commits. Most of my commits there carry a `Co-Authored-By` trailer for Claude, and the repo includes an `AI_DISCLOSURE.md` because GraphHacks rule 11 says "AI coding assistants are allowed, but their use must be disclosed."

## What I take from it

An instruction file is worth updating every time an agent gets something wrong, so the next session starts with the correction. It also helps to write down what "done" looks like as commands and numbers, so checking takes a minute. And say who wrote what in the place the event or reader will look, whether that's commit trailers, a README credit line or a disclosure file.
