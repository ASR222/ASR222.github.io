---
title: Building HazeBusters in 4 days
description: What changed, what got cut and what I learned building an air-quality app for places with no monitor, at WeMakeDevs x AWS Environmental Hacks 2026.
date: 2026-10-29
kind: journey
tags: [Hackathon, AWS, Lessons]
project: hazebusters
draft: false
---

I study at BIT Mesra, near Ranchi. When I looked up Ranchi on the World Air Quality Index, there was no station. The nearest official one, Jamshedpur, is about 110 km away, and it wasn't reporting either.

That became our entry for the Air track of WeMakeDevs x AWS Environmental Hacks 2026: a phone web app that tells you how far your nearest real reading is, what's visibly polluting the air around you, and what to do today, in Hindi. The hero user was a school deciding whether today's PE and assembly can go outdoors.

The clock started on Thursday 8 October and submissions closed on Sunday 11 October. Here are those four days as the repo saw them.

## Thursday: the pitch breaks

We came in with one big idea: a phone camera that estimates AQI anywhere. By Thursday night that idea was gone.

The image model scored 89% on the days it trained on and 32% on days it hadn't seen, against a 47.5% majority baseline. Cheaper probes that evening confirmed no image signal carried over to unseen dates or cities. I wrote the full story in [The 89% model that scored 32%](/writing/model-scored-89-percent).

That was the most useful result of the weekend, because it forced the question: if the camera can't give the number, where does the number come from?

## Friday: a source we could defend

We decided to use what already exists and check it. Friday went into validating CAMS, the Copernicus atmospheric model, against two years of daily PM2.5 from 59 ground stations in Delhi, Hyderabad and Patna. CAMS followed the ups and downs but read about 0.8x the stations, and it missed about two thirds of the worst days in Delhi and Patna. So when the app falls back to CAMS, it scales PM by 1.25 and says so. Details are in [CAMS vs 59 ground stations](/writing/cams-vs-ground-stations).

The same day, the camera got a new job: explaining causes instead of measuring AQI. We trained a smoke/fire classifier on D-Fire and exported it to ONNX. By Friday night the AWS skeleton was deployed in ap-south-1: API Gateway, Lambda, S3, DynamoDB, and a container-image processor.

## Saturday: real phones and real clips

- A phone test broke the station lookup. WAQI's "can not connect" turned out to mean two things: no station (Ranchi), or stations that exist but stopped reporting. All 9 WAQI stations in Hyderabad had last reported on 23 June 2026. We added a bundled index of 552 official stations, so the app can say which station is nearest, how far it is and how long ago it last reported.
- A quality gate went in front of the models. It drops frames that are too dark, blurred or show no sky, and we calibrated it on 24 of our own clips.
- YOLO11n started counting vehicles, with NumPy post-processing checked against Ultralytics. I wrote up the Lambda side in [Vision on Lambda without PyTorch](/writing/vision-on-lambda).

## Sunday: freeze and hedge

The smoke model had scored AP 0.979 on D-Fire. On our real-clip test it flagged 6 of 13 no-smoke clips, on city haze and bright sky. On Sunday we raised the smoke threshold from 0.359 to 0.600, which still flagged 5 of 13. We also took the clip results out of what Bedrock sees entirely and wrote the smoke line in code: "Our camera check suggests possible smoke in your clip (experimental). If you can see a smoke source nearby, move away from it." That line is true whether the model is right or wrong.

Then came feature freeze, the demo video and the write-up.

## What got cut

The plan in our project notes had more in it than what shipped. Each cut made the app smaller and, I think, better.

| Planned | What happened |
| --- | --- |
| AQI estimated from the camera | Dropped after the out-of-sample test |
| YOLO fine-tuned for smoke/fire boxes | Not done; the boxes field stays empty, vehicles only |
| Seasonal line ("a typical November day here") | Not wired; the field is null |
| Optional report-burning draft | Cut |
| Anthropic models on Bedrock | Blocked by a Marketplace permission; we used Amazon Nova 2 Lite |
| React and shadcn/ui, per the design notes | Shipped as plain HTML, CSS and JS with no build step |

## What we built with

I ran three Claude Code sessions in separate git worktrees, one each for ML, infra and web, with a Claude chat acting as planner and reviewer. Two rules mattered most:

- One shared `CLAUDE.md` with the rules, the AQI table, the decisions and the current status, which every session read first.
- "Only report numbers read from files on disk." Every number a session reported had to point to a file in `ml/runs/`.

Writing the API contract first also saved time. `backend/contract.json` listed every field the frontend would read, so ML, backend and frontend were built against it in parallel.

## The AWS bits that cost time

- Presigned uploads failed CORS. Sign with the same `Content-Type` the browser sends, and force SigV4 with virtual-host addressing outside us-east-1.
- SAM hit a circular dependency between the bucket, its event and the function's policy. Give the bucket an explicit name and reference that string.
- Lambda has a 10-second init limit. Load the ONNX models lazily on the first request.
- A new account's Lambda concurrency limit is 10. We throttled the API to a burst of 10 and 5 requests per second.
- Lambda runs in UTC. Two fallback paths silently used UTC; at 6 PM IST one would have said "today" instead of "tomorrow".
- External APIs time out when it matters. One Open-Meteo call took over 10 s and failed a job. One retry plus logging fixed it.

## What I learned

- Your most impressive result might be a bug. Before celebrating 89%, ask what the model could be memorising.
- Pick the hero user before the model. "Can PE go outdoors?" shaped every decision, and image-to-AQI didn't serve it.
- Test on a real phone early. On Android, the camera-capture input hides the gallery entirely. We only found that out on a real phone, and after that the app got two buttons, "Record clip" and "Choose from gallery".
- Collect your own data on day one. A handful of phone clips taught us more about the smoke model than two public datasets did.
- Make the wording match the evidence. "Possible smoke (experimental)" and "low confidence" in amber are less exciting than "Smoke detected", but I can defend them in front of a teacher.
- Make AI sessions show their sources. They were most useful once every claim had to point to a file.

## What's next

We haven't piloted HazeBusters with a school yet. That's the first step: put it in front of two or three teachers near campus and watch them use it without help. After that comes the data. Every clip filmed near a live station is a labelled example, which is exactly the honest dataset image-to-AQI was missing. Daily alerts for schools and more Indian languages are on the list too.
