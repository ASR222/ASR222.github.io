---
title: Built for a teacher's phone
description: Who HazeBusters is for, what it tells a school with no nearby monitor each morning, and the choices that make it work on a mid-range Android phone on mobile data.
date: 2026-10-23
kind: journey
tags: [Product design, Accessibility, Mobile web]
project: hazebusters
draft: false
---

I study at BIT Mesra, near Ranchi. When I looked up Ranchi on the World Air Quality Index (WAQI), there was no station. In the 546-station India dataset I worked from, Jharkhand had exactly two official stations, Jamshedpur and Dhanbad, and neither is in Ranchi. Jamshedpur is about 110 km away, and when I checked live on 11 October it wasn't reporting to WAQI either.

Big cities go quiet as well. Hyderabad has 9 WAQI stations, and none of them had reported since 23 June 2026. A city can have a monitoring network on the map and still have no live number.

So a school in Ranchi asking "Can PE and assembly go outdoors today?" has nothing good to go on. A national AQI map shows a colour, but it doesn't say how far away that colour was measured, how old it is, or what a school should do about it. I built HazeBusters around that one decision, made by one kind of user every morning. The [project page](/work/hazebusters) covers the whole build.

## What a teacher gets back

A teacher opens the app, picks a profile (School, Outdoor worker or General), films 10 seconds of sky and gets a result in about 10 seconds. The screen is ordered by what that teacher needs to know first.

At the top is the decision: "Outdoors OK until 5 PM", "Limit outdoor time" or "Avoid outdoors, no good window today". The app computes it from the 3-hourly forecast over the hours left in that profile's day. For a school, the day runs from 7 AM to 5 PM.

Under the decision is the AQI and where it came from. If a WAQI station within 25 km has reported in the last 3 hours, the app shows that reading with high confidence. Otherwise it falls back to the CAMS atmospheric model for the roughly 45 km grid cell around the user, marks the number low confidence, and adds a caveat naming the nearest station and why it wasn't used. I checked CAMS against ground stations before trusting it, and I correct its low bias on purpose. That work is in [CAMS vs 59 ground stations](/writing/cams-vs-ground-stations).

Next is what's visible in the clip, labelled experimental: possible smoke or fire, a heatmap of where the model looked, and a vehicle count. The camera never estimates the AQI itself. I tried that first, and the image model that scored 89% on days it had trained on dropped to 32% on days it hadn't seen, below the 47.5% you get by always guessing the most common band ([the full story](/writing/model-scored-89-percent)). The smoke card says "possible" because the model raised false alarms on ordinary city haze, which I cover in [the smoke model post](/writing/smoke-model-to-a-hint).

Last comes the advice, in English and Hindi with audio for both, and a Share button that turns it into a WhatsApp message for the parents' group. An LLM writes the advice text, but it may only phrase numbers the app has already computed, and code checks every response before it reaches the screen. The rules are in [a separate post](/writing/llm-that-only-phrases-numbers).

## Before and after, for a school

| | Before | With HazeBusters |
|---|---|---|
| The number | A map colour from a station about 110 km away, or one that has stopped reporting | The nearest live reading if there is one, otherwise the model estimate for this area, labelled as such |
| Trust | No idea how far away or how old the number is | Source, distance, age and confidence on screen |
| The decision | Guess from the look of the sky | "Outdoors OK until 5 PM" or "No good window today", for school hours |
| Reaching parents | Type a message from scratch | One tap for a ready English and Hindi message for the parents' WhatsApp group |

The same flow serves an outdoor or gig worker, whose day runs from 6 AM to 7 PM, and a general user.

## Designed for a mid-range Android on mobile data

The people I had in mind are teachers and workers on mid-range Android phones, often on mobile data, and many of them more comfortable in Hindi than in English. Every UI choice came from that picture.

There is nothing to install and no login. HazeBusters is a web page that opens from a shared link and can be added to the home screen, so a teacher who gets the link in a WhatsApp group can use it straight away.

The decision card is the first thing on screen, then the AQI, then the details. Only the first caveat stays visible, and the rest fold under "Details".

Hindi is there as text and as audio. Amazon Polly reads the advice aloud with the neural Hindi voice Kajal, plus an English voice, so someone who would rather listen than read gets the same advice.

For location, the app uses GPS if the phone allows it and offers a city list if it doesn't.

The upload screen has two buttons, "Record clip" and "Choose from gallery". On Android, the camera-capture input hides the gallery entirely, which I only found during a test on a real phone. With a single button, anyone who had already filmed the sky would have had no way to pick that clip.

When something goes wrong, the app says what to do next. A clip that's too long gets a warning before upload. An indoor or dark clip gets "Couldn't check this clip. Point the camera at the sky or street outdoors", and every error has a Retry button. A quality gate on the server is what catches the dark and indoor clips, and it is rule based, so a bright white room can still pass as overcast sky. I list that as a known limitation.

I kept the page light for cheap phones and slow networks. It is plain HTML, CSS and JS with no framework to download and no build step. The sky background image is 139 KB, and phones get a 27 KB version. The video goes from the phone straight to S3 through a presigned URL instead of passing through the API, which only creates the job and hands back the result. [Vision on Lambda without PyTorch](/writing/vision-on-lambda) covers what happens to the clip after it lands.

The screen also has to be readable outdoors. I checked text contrast to WCAG AA even over the brightest part of the sky background. Colour is never the only signal: every AQI band shows its name and its number, and low confidence is shown in amber, because red already means bad air.

## Not tested with a school yet

I haven't piloted HazeBusters with a school. The design above comes from thinking hard about one user and from tests on a real phone, but no teacher has used it in a staff room yet. That is the first next step: put it in front of two or three teachers near campus and watch them use it without help.

After that comes data. Every clip filmed near a live station is a labelled example, so the app can collect the honest dataset that image-to-AQI was missing. A daily 6:30 AM alert for schools and more Indian languages are also on the list.

The app is live at [main.dxwuap9t49si3.amplifyapp.com](https://main.dxwuap9t49si3.amplifyapp.com), and the code is on [GitHub](https://github.com/ASR222/hazebusters) under AGPL-3.0. If you are somewhere with no monitor, try it and open an issue for whatever breaks.
