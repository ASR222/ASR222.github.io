---
title: When 0.98 AP became a hint
description: HazeBusters' smoke model scored AP 0.979 in-domain, fell below chance on an external test and flagged 5 of 13 clean real clips, so the app calls it a possible hint.
date: 2026-10-25
kind: technical
tags: [Computer vision, Evaluation, Data leakage]
project: hazebusters
draft: false
---

[HazeBusters](/work/hazebusters) started with the idea that a phone camera could read air quality. On days the model hadn't seen, it scored 32% against a 47.5% majority baseline, so I took image-to-AQI out of the product. That story is in [The 89% model that scored 32%](/writing/model-scored-89-percent). The AQI now comes from the nearest live station or from the CAMS model, and the camera got a smaller job it could at least attempt: explaining causes. Is something visibly burning near the person filming?

This post follows the smoke and fire model behind that job, from a test score that looked finished to the cautious wording it carries in the app today.

## The model and its in-domain score

The classifier is EfficientNet-B0 with two sigmoid outputs, one for smoke and one for fire, trained on D-Fire, a CC0 dataset of 21,527 images. Before splitting, I grouped near-duplicate images with perceptual hashes so that no group could end up on both sides of the split.

On D-Fire's test split it scored AP 0.979 for smoke and 0.982 for fire. On that number alone, the model looked done.

## An external test on Pyro-SDIS

Pyro-SDIS is a dataset from wildfire cameras, released under Apache-2.0. On it, the D-Fire model's smoke recall was 13.4% and its false-positive rate was 20.5%. Its AP was 0.845, below the 0.868 base rate, which means it ranked smoke images worse than a random ordering would.

I wanted to know why before deciding anything, so I checked the explanations that would have been cheap to fix. Moving the threshold could not help: at every threshold, recall roughly equalled the false-positive rate. Resolution was not the main cause either, because running at 448 px only lifted AP to chance level.

The diagnosis also turned up a second split leak. The first was in the AQI work, where frames from the same day landed in both train and test (I wrote that up in [Random splits lied by 30 points](/writing/random-splits-lie)). This one is in Pyro-SDIS itself: its own validation set shares 83 of its 84 cameras with training. A validation score on that split says little about a camera the model has never seen, and a phone in Ranchi is exactly that.

## 23 real clips

Public datasets only go so far, so the test that mattered used clips like the ones the app actually receives: 23 ten-second clips. 15 were filmed on phones around campus. The other 8 are free stock clips, for the fire and smoke that couldn't be filmed safely. I report the two groups separately.

| At threshold 0.60 | Own clips | Stock clips | All |
|---|---|---|---|
| Smoke clips flagged | 5 of 5 | 1 of 2 | 6 of 7 |
| Fire clips flagged | none filmed | 2 of 2 | 2 of 2 |
| No-smoke clips wrongly flagged | 4 of 9 | 1 of 4 | 5 of 13 |
| Indoor clip rejected by the quality gate | 1 of 1 | none | 1 of 1 |

One duplicated clip is excluded. The threshold had started at 0.359, where 6 of the 13 no-smoke clips were flagged, and raising it to 0.60 brought that down by one.

The model caught 6 of 7 smoke clips and both fire clips. The false alarms were worst on the phone footage: 4 of 9 clean clips filmed on campus were flagged as smoke. Those are the clips closest to what a teacher would actually upload.

## Three fixes that didn't work

I tried a hard-negative fine-tune, suppressing detections on bright sun glare, and requiring 50% of a clip's frames to agree before flagging it. None of them removed the false alarms without also losing a real smoke hit.

The false alarms scored between 0.96 and 1.0, and on those clips the CAM heatmap sat on ordinary urban haze. With scores that high, no threshold fixes it. It needs training data that has Indian city haze labelled as a negative.

![A hazy morning at the New Delhi station entry, with cars and auto-rickshaws in grey air](/img/delhi-smog.jpg)

Ordinary city haze like this is what the model kept reading as smoke.

## How the app words it

The smoke card is labelled experimental and says "Possible (model score xx%)", never "Detected". The 6 of 7 and 5 of 13 figures are printed right under it, so anyone looking at the card can see how often it is wrong. The cause models never change the AQI.

When smoke is flagged, the advice gets one extra line, added by code:

> Our camera check suggests possible smoke in your clip (experimental). If you can see a smoke source nearby, move away from it.

That sentence is true whether the model is right or wrong. If there is a visible source, moving away is correct, and if there isn't, the line asks nothing of the reader.

Amazon Nova on Bedrock writes the rest of the advice in English and Hindi. When I asked it to include the smoke result, it kept leaving it out, so now it never sees the smoke result at all, and any smoke wording in its output is rejected. The rest of the checks on that output are in [the post on the LLM that only phrases numbers](/writing/llm-that-only-phrases-numbers).

## Running it on Lambda

The model runs on CPU in a Lambda container with no PyTorch. It is exported to ONNX with the final 1280×7×7 feature map as a second output, so the heatmap is plain CAM computed in NumPy, and it reproduces the ONNX logits to within 5.7e-6. A rule-based quality gate drops dark, blurred and sky-less frames first, and YOLO11n counts vehicles in the same function. The code and the cold-start fix are in [Vision on Lambda without PyTorch](/writing/vision-on-lambda).

## What I'd keep

An in-domain AP of 0.979 told me how well the model fit D-Fire and nothing about a phone pointed at a hazy skyline. The order that worked was an external dataset first, then data I collected myself, and the phone clips taught me more about this model than both public datasets together. Next time I'd film them on day one, and count the unique cameras, days and places in a dataset before trusting any split, including the one it ships with.

The heatmap earns its place even when the model is wrong, because it shows where the model was looking, and for the false alarms that was the haze. A custom smoke detector was cut from this build, and the next step for the model is a training set with Indian city haze as a negative.

[Live app](https://main.dxwuap9t49si3.amplifyapp.com) · [Code on GitHub (AGPL-3.0)](https://github.com/ASR222/hazebusters)
