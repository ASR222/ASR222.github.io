---
title: Building HazeBusters in 4 days
description: What changed, what got cut and what I learned building an air-quality app for places with no monitor, in four days.
date: 2026-10-29
kind: journey
tags: [AWS, Air quality, Lessons]
project: hazebusters
draft: false
---

I study at BIT Mesra, near Ranchi. When I looked up Ranchi on the World Air Quality Index, there was no station. The nearest official one, Jamshedpur, is about 110 km away, and it wasn't reporting either.

That became HazeBusters, a phone web app that tells you how far your nearest real reading is, what's visibly polluting the air around you, and what to do today, in Hindi. The hero user was a school deciding whether today's PE and assembly can go outdoors.

I built it in four days, from Thursday 8 October to Sunday 11 October. Here are those days as the repo saw them.

## Thursday: the pitch breaks

I started with one big idea: a phone camera that estimates AQI anywhere. By Thursday night that idea was gone.

The image model scored 89% on the days it trained on and 32% on days it hadn't seen, against a 47.5% majority baseline. Cheaper probes that evening confirmed no image signal carried over to unseen dates or cities. I wrote the full story in [The 89% model that scored 32%](/writing/model-scored-89-percent).

That was the most useful result of the weekend, because it forced the question: if the camera can't give the number, where does the number come from?

## Friday: a source I could defend

I decided to use what already exists and check it. Friday went into validating CAMS, the Copernicus atmospheric model, against two years of daily PM2.5 from 59 ground stations in Delhi, Hyderabad and Patna. CAMS followed the ups and downs but read about 0.8x the stations, and it missed about two thirds of the worst days in Delhi and Patna. So when the app falls back to CAMS, it scales PM by 1.25 and says so. Details are in [CAMS vs 59 ground stations](/writing/cams-vs-ground-stations).

The same day, the camera got a new job: explaining causes instead of measuring AQI. I trained a smoke/fire classifier on D-Fire and exported it to ONNX. By Friday night the AWS skeleton was deployed in ap-south-1: API Gateway, Lambda, S3, DynamoDB, and a container-image processor.

## Saturday: real phones and real clips

- A phone test broke the station lookup. WAQI's "can not connect" turned out to mean two things: no station (Ranchi), or stations that exist but stopped reporting. All 9 WAQI stations in Hyderabad had last reported on 23 June 2026. I added a bundled index of 552 official stations, so the app can say which station is nearest, how far it is and how long ago it last reported.
- A quality gate went in front of the models. It drops frames that are too dark, blurred or show no sky, and I calibrated it on 24 of my own clips.
- YOLO11n started counting vehicles, with NumPy post-processing checked against Ultralytics. I wrote up the Lambda side in [Vision on Lambda without PyTorch](/writing/vision-on-lambda).

## Sunday: freeze and hedge

The smoke model had scored AP 0.979 on D-Fire. On my real-clip test it flagged 6 of 13 no-smoke clips, on city haze and bright sky. On Sunday I raised the smoke threshold from 0.359 to 0.600, which still flagged 5 of 13. I also took the clip results out of what Bedrock sees entirely and wrote the smoke line in code: "Our camera check suggests possible smoke in your clip (experimental). If you can see a smoke source nearby, move away from it." That line is true whether the model is right or wrong.

Then came feature freeze, the demo video and the write-up.

## What got cut

The plan in my project notes had more in it than what shipped. Each cut made the app smaller and, I think, better.

| Planned | What happened |
| --- | --- |
| AQI estimated from the camera | Dropped after the out-of-sample test |
| YOLO fine-tuned for smoke/fire boxes | Not done; the boxes field stays empty, vehicles only |
| Seasonal line ("a typical November day here") | Not wired; the field is null |
| Optional report-burning draft | Cut |
| Anthropic models on Bedrock | Blocked by a Marketplace permission; the app uses Amazon Nova 2 Lite |
| React and shadcn/ui, per the design notes | Shipped as plain HTML, CSS and JS with no build step |

## How I built it

I ran three Claude Code sessions in separate git worktrees, one each for ML, infra and web, with a Claude chat acting as planner and reviewer. Two rules mattered most:

- One shared `CLAUDE.md` with the rules, the AQI table, the decisions and the current status, which every session read first.
- "Only report numbers read from files on disk." Every number a session reported had to point to a file in `ml/runs/`.

Writing the API contract first also saved time. `backend/contract.json` listed every field the frontend would read, so ML, backend and frontend were built against it in parallel.

## The AWS bits that cost time

A lot of the AWS time went on platform problems: presigned uploads failing CORS, a circular dependency in the SAM template, Lambda's 10-second init limit, a new account's concurrency cap of 10 and fallback paths that silently ran on UTC. All twelve, with the fixes, are in [AWS gotchas from one build](/writing/aws-gotchas-one-build).

## What I learned

- Your most impressive result might be a bug. Before celebrating 89%, ask what the model could be memorising.
- Pick the hero user before the model. "Can PE go outdoors?" shaped every decision, and image-to-AQI didn't serve it.
- Test on a real phone early. On Android, the camera-capture input hides the gallery entirely. I only found that out on a real phone, and after that the app got two buttons, "Record clip" and "Choose from gallery".
- Collect your own data on day one. A handful of phone clips taught me more about the smoke model than two public datasets did.
- Make the wording match the evidence. "Possible smoke (experimental)" and "low confidence" in amber are less exciting than "Smoke detected", but I can defend them in front of a teacher.
- Make AI sessions show their sources. They were most useful once every claim had to point to a file.

## What's next

I haven't piloted HazeBusters with a school yet. That's the first step: put it in front of two or three teachers near campus and watch them use it without help. After that comes the data. Every clip filmed near a live station is a labelled example, which is exactly the honest dataset image-to-AQI was missing. Daily alerts for schools and more Indian languages are on the list too.
