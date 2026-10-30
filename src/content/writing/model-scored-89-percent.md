---
title: The 89% model that scored 32%
description: My image-to-AQI model scored 89% on the days it trained on and 32% on days it hadn't seen, below a 47.5% baseline, so I traced the leak and dropped the model.
date: 2026-10-12
kind: technical
tags: [Machine learning, Evaluation, Data leakage]
project: hazebusters
draft: false
---

On the first evening of the hackathon, the first model came back with 89.0% accuracy. On the days it had never seen, the same checkpoint scored 32.0%. Always guessing the most common answer scores 47.5%.

So the model did worse than a constant, and it was confident about it: mean confidence on the test days was 0.80.

Here is how that happened, how I checked it wasn't a bug, and why image-to-AQI is not in HazeBusters.

## The idea

HazeBusters is for places with no air-quality monitor nearby. The pitch we arrived with was simple: point a phone at the street, get an AQI. If a camera could read haze, every phone would be a monitor.

![Smog over Gurgaon, 2016](/img/gurgaon-smog.jpg)

The training data was TRAQID, an IIIT Hyderabad dataset of dashcam frames labelled with PM2.5 and PM10. I kept only daytime, front-camera frames, since the app's quality gate rejects night frames anyway. I recomputed every label with our own CPCB-style AQI function and grouped them into three bands: Good/Satisfactory (0 to 100), Moderate/Poor (101 to 300) and Very Poor/Severe (301 and up).

That left 13,789 frames, which sounds like plenty until you count the calendar dates: 17. The frames are 5 seconds apart, so frames from the same drive look almost identical and share one AQI.

## Splitting by date, not by frame

Because of that, I never used a random split for this model. Every calendar date goes wholly into train, val or test. With only 17 dates, the split is a small exhaustive search for date sets that hit the target row fractions while keeping each split's band mix close to the overall mix. The result is frozen in `ml/splits/traqid_dates.json` so it can't drift after results are reported.

This is the part of `ml/src/hazeml/traqid.py` that applies it:

```python
def assign_split(df: pd.DataFrame, path: Path = SPLIT_FILE) -> pd.DataFrame:
    """Add a `split` column from the frozen date split."""
    split = json.loads(path.read_text())
    missing = set(df["date"]) - set(split)
    if missing:
        raise ValueError(f"dates not in {path.name}: {sorted(missing)}; regenerate the split")
    return df.assign(split=df["date"].map(split))
```

That gave 10 training dates (9,657 frames), 2 validation dates (1,361) and 5 test dates (2,771). I had to disclose one overlap: 21 Dec 2023 is in test while 22 and 23 Dec, from the same smog episode, are in train. They share no frames, but they share weather and light. Keeping the episode together left too little of the worst band in either train or test.

## The result

A fine-tuned EfficientNet-B0, seed 0:

| Split | Accuracy | Majority baseline | Macro-F1 |
| --- | --- | --- | --- |
| Its own train dates | 89.0% | 47.2% | 0.881 |
| Validation (2 dates) | 22.2% | 47.4% | 0.175 |
| Test (5 dates) | **32.0%** | **47.5%** | 0.312 |

Per test date the accuracy was 50.3%, 42.9%, 9.4%, 43.4% and 15.1%.

The 89% on the training dates rules out a broken pipeline: the model loads, the labels line up, the preprocessing works. It just learned each day's look instead of haze. Once that was clear I stopped seeds 1 and 2.

## Why it learns the day

65% of the band variance (70% of the AQI variance) is between dates, and within a date one band covers a median of about 78% of the frames. So the dataset has roughly 17 independent samples, not 13,789.

Time of day is also tangled with the label. The worst air, 21 to 23 Dec 2023, was filmed on morning drives, while most other frames are from late afternoon. Very Poor/Severe is 43% of frames before 11:00 and 9% from 15:00, so a CNN can learn "morning light means bad air".

## Was it the CNN?

I wanted to know whether any image signal survives to an unseen day, so I ran cheap probes: logistic regression on frozen EfficientNet-B0 embeddings, and on handcrafted haze features (dark channel, contrast, saturation, brightness). The baseline here is the majority class of each training fold.

The only difference between the honest probe and the leaky one is what defines a fold. From `ml/src/hazeml/probes.py`:

```python
save("p3_traqid_lodo_emb", both_tasks(ftq["emb"], band_tq, dates, dates, C_EMB))
# ...
rnd = np.empty(len(tq), dtype=int)
for i, (_, te) in enumerate(StratifiedKFold(5, shuffle=True, random_state=0).split(ftq["emb"], band_tq)):
    rnd[te] = i
save("p5_traqid_random5fold_emb", both_tasks(ftq["emb"], band_tq, rnd, dates, C_EMB))
```

In the first call each date is its own fold, so one date is left out at a time. In the second, folds are random over frames. Both use the same features and the same classifier:

| Probe (3 bands, per frame) | Accuracy | Baseline |
| --- | --- | --- |
| Frozen embeddings, leave-one-date-out | 33.5% | 33.7% |
| Handcrafted features, leave-one-date-out | 36.1% | 33.7% |
| Handcrafted + humidity, leave-one-date-out | 52.8% | 33.7% |
| Frozen embeddings, random 5-fold over frames | **63.3%** | 47.3% |

The random split inflates accuracy by about 30 points. Scored per date with a majority vote, it reaches 100%, which is a convincing result and a false one.

Humidity, a weather reading rather than an image feature, adds signal per frame. Per date, though, it lands exactly on the baseline (47.1%), and it finds no Very Poor/Severe day.

## A second dataset, inverted

I also tested on India/Nepal air-pollution images: 12,240 frames from 8 locations, but only 115 distinct location, date and hour moments. With one city left out at a time, the predictions came out inverted. Clean cities were called polluted and polluted ones clean, and Delhi scored 4.5%. Each city is nearly one band, so the model learned the city. Its 20% is below even plain three-class chance.

## Dropping it

Image-to-AQI became an experiment in `ml/RESULTS.md` instead of a feature. The camera stayed in the app for jobs it could at least attempt: flagging possible smoke or fire and counting vehicles. Those are marked experimental and never change the AQI.

The AQI now comes from sources we could check: the nearest WAQI station, or the CAMS atmospheric model when the station is too far or too old. Checking CAMS turned into its own piece of work, which I wrote up in [CAMS vs 59 ground stations](/writing/cams-vs-ground-stations).

## What I took from it

- Split by whatever repeats: day, place, camera, patient, user. A random split over frames would have handed me 63% and a story.
- Put the majority baseline next to every accuracy. 32% only reads as a failure next to 47.5%, and 89% only reads as a warning next to the test number.
- High training accuracy told me something too: the pipeline worked and the model was memorising, which is a different problem from a bug.
- Count your independent samples before training. Thirteen thousand frames from 17 days is 17 data points with a lot of copies.
- Write up the negative result. Doing it properly took real time, but shipping the model would have put a confident wrong number in front of a school.
