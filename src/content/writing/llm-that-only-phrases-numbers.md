---
title: An LLM that only phrases numbers
description: How HazeBusters has Amazon Nova 2 Lite word air-quality advice for schools in English and Hindi, checks every reply in code, and falls back to a template.
date: 2026-10-27
kind: technical
tags: [LLM, Amazon Bedrock, Validation]
project: hazebusters
draft: false
---

In [HazeBusters](/work/hazebusters), a teacher picks the School profile, films 10 seconds of sky and gets an answer in about 10 seconds: "Outdoors OK until 5 PM", "Limit outdoor time" or "Avoid outdoors, no good window today". Under that decision sits a short piece of advice in English and Hindi, with audio, and a Share button that turns it into a WhatsApp message for the parents' group.

That advice is the most human part of the app, and the riskiest. A model that writes "the air is safe" next to a number it made up, or states smoke as a fact, is worse than no advice at all. So the language model in HazeBusters has one job. It phrases numbers my code has already computed, and code checks everything it writes before anyone sees it.

## Who reads the advice

The people I built for are teachers and outdoor workers on mid-range Android phones, often on mobile data, and many of them are more comfortable in Hindi. The advice is written for them in both languages, and Amazon Polly reads it aloud with the neural Hindi voice "Kajal" (plus an English voice), so it works for someone who would rather listen than read. The audio is saved to S3 and the phone gets a presigned link to it.

The text also leaves the app. One tap on Share puts the English and Hindi message into the parents' WhatsApp group, so whatever the model writes can end up in front of people who never opened HazeBusters and can't see the caveats on the result screen. I wrote about the rest of the [phone side of the app](/writing/built-for-a-teachers-phone) separately.

## The numbers come from code

By the time the language model is called, every number on the screen is settled. The processor Lambda picks the AQI source first. A WAQI station counts if it is within 25 km and under 3 hours old, and that reading is high confidence. Otherwise the app uses the CAMS atmospheric model for that roughly 45 km grid cell, marked low confidence, with a caveat naming the nearest station and why it wasn't used. I checked CAMS against ground stations before trusting it, which is its own post: [CAMS vs 59 ground stations](/writing/cams-vs-ground-stations).

The decision is computed too, from the 3-hourly forecast over the profile's remaining hours. For a school that window is 7 AM to 5 PM, and for an outdoor worker it is 6 AM to 7 PM.

Only then does Amazon Bedrock come in. The model is Amazon Nova 2 Lite, called through its inference profile ID (`global.amazon.nova-2-lite-v1:0`), because the bare model ID fails. That and the other AWS surprises from the build are in [my post on the AWS gotchas](/writing/aws-gotchas-one-build). The model gets four things: the AQI, its band, the decision and the profile. It is asked for JSON with an `en` field and an `hi` field. On a warm run the processor takes 5 to 6 seconds, and Bedrock is about 1 to 1.5 seconds of that.

![HazeBusters architecture on AWS, with Bedrock and Polly called from the processor Lambda](/img/hazebusters.jpg)

## Every reply is checked before use

I treat the model's reply the way I would treat user input. Before the app uses it, the reply has to pass all of these checks:

- It parses as JSON, and both languages are present.
- The Hindi is actually written in Devanagari.
- The AQI it was given appears in the text.
- No number appears that my code didn't provide.
- It fits a sentence budget.
- The Hindi health sentences avoid definite-future phrasing.

Each check covers a specific way the advice could go wrong on a teacher's phone. A missing language breaks the bilingual share message and the Hindi audio. A field named `hi` says nothing about the script inside it, so the Devanagari check looks at the text itself.

The number checks matter most. Requiring the supplied AQI means the advice talks about the same reading the decision card shows. Rejecting any number I didn't supply is how a hallucinated number gets caught. Every number the model is given came from a station, from CAMS or from the forecast, so any other number in its output was invented, and the reply is thrown away.

The sentence budget keeps the advice short enough to sit under the decision card and to be read aloud by Polly. The last check is about tone in Hindi. A health sentence in the definite future states what will happen to the reader as a certainty, and the AQI behind it may be a low-confidence model estimate. The Hindi advice has to stay within what the numbers support.

## The template fallback

Anything that fails a check falls back to a template, so a bad reply never leaves the result screen without advice. The result records which path produced the text in `advice.source`, so every piece of advice the app has shown can be traced to either the model or the template.

The same idea runs through the rest of the processor. If the smoke model can't load, the result says "Smoke check unavailable for this clip", and if the vehicle model fails, the count is null with its own caveat. The air reading and the advice still arrive. I covered that side in [Vision on Lambda without PyTorch](/writing/vision-on-lambda).

## The smoke line is written in code

The clip also goes through an experimental smoke and fire classifier. At first I passed its result to Nova and asked it to mention smoke when the classifier flagged it. Nova kept leaving smoke out.

So I took the smoke result out of the prompt. The model never sees it now, and any smoke wording in its output is a validation failure, so that reply goes to the template. When the classifier does flag a clip, code appends this line:

> Our camera check suggests possible smoke in your clip (experimental). If you can see a smoke source nearby, move away from it.

The wording is hedged because the evidence is weak. The classifier scored AP 0.979 on its D-Fire test split, but on real clips it still flagged 5 of 13 no-smoke clips, with the heatmap sitting on ordinary city haze. The line above is true whether the model is right or wrong, and the result card says "Possible (model score xx%)", never "Detected". I wrote up [how that model became a hint](/writing/smoke-model-to-a-hint) in its own post.

Moving the line into code also made the safety-critical sentence fixed and reviewable. I can read it in the source and know exactly what a teacher will see.

## What I'd reuse on the next LLM feature

The pattern is small enough to copy. Compute every number in code and give the model only those. Ask for structured output with one field per language. Check the reply for structure, script, the required number, any extra numbers, length and certainty of tone, and fall back to a template on any failure, recording which path ran. Keep the sentences that carry safety weight, like the smoke line, out of the model's hands entirely.

That puts all the facts in HazeBusters advice in code and leaves the model to word them, in two languages, for a school deciding whether PE and assembly can go outdoors today. You can try it in the [live app](https://main.dxwuap9t49si3.amplifyapp.com), and the code is on [GitHub](https://github.com/ASR222/hazebusters).
