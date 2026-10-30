---
title: Random splits lied by 30 points
description: On HazeBusters' TRAQID dashcam frames a random split scored 63.3% and a date hold-out 33.5%, so in AQI Vision we built grouped-split tooling.
date: 2026-10-26
kind: technical
tags: [Machine learning, Evaluation, Data leakage]
project: hazebusters
draft: false
---

In [HazeBusters](/work/hazebusters) I tested whether a dashcam frame can tell which AQI band its day was in. With the same frozen features and the same classifier, a random 5-fold split over frames scored 63.3%. Holding out one whole date at a time scored 33.5%, and always guessing the training fold's most common band scored 33.7%. The split was the only thing that changed between the two runs, so about 30 points of that accuracy came from leakage.

![Smog over Gurgaon seen from a tower block, 2016](/img/gurgaon-smog.jpg)

## Why frames from one date leak

TRAQID is IIIT Hyderabad's dashcam dataset with co-located PM2.5 and PM10 readings (Kathalkar et al., ICVGIP 2024). After keeping daytime, front-view frames, it has 13,789 frames from only 17 calendar dates. The frames are 5 seconds apart, so every frame from one drive shares the same light, route and weather, and mostly the same AQI band. By the numbers in `ml/RESULTS.md`, 65% of the band variance sits between dates, which leaves roughly 17 independent samples.

Split those frames at random and the test set fills up with near-copies of training frames. A model can then score well by recognising the day.

## The numbers

The probe is logistic regression on frozen EfficientNet-B0 embeddings, standardised, with balanced class weights and a fixed C, predicting three CPCB-style bands. In `ml/src/hazeml/probes.py` both runs call the same function and differ only in the fold ids they pass in:

```python
    save("p3_traqid_lodo_emb", both_tasks(ftq["emb"], band_tq, dates, dates, C_EMB))
    # ...
    rnd = np.empty(len(tq), dtype=int)
    for i, (_, te) in enumerate(StratifiedKFold(5, shuffle=True, random_state=0).split(ftq["emb"], band_tq)):
        rnd[te] = i
    save("p5_traqid_random5fold_emb", both_tasks(ftq["emb"], band_tq, rnd, dates, C_EMB))
```

Passing `dates` as the folds holds out one whole date per fold. Passing `rnd` deals the frames into five shuffled folds, so frames from one date can land in both train and test.

| Split | Accuracy | Majority baseline |
| --- | --- | --- |
| Random 5-fold over frames | 63.3% | 47.3% |
| Leave one date out | 33.5% | 33.7% |

The baseline is the majority class of each training fold, and the leave-one-date-out run sits right on it. Scored per date by majority vote, the random split reached 100% on all 17 dates. Leave-one-date-out got 41.2% per date against a 47.1% baseline.

A fully fine-tuned EfficientNet-B0 told the same story: 89.0% on its own training dates, 32.0% on five held-out dates, below the 47.5% majority baseline ([that story](/writing/model-scored-89-percent) is its own post). On the India/Nepal image dataset with one city held out, the predictions came out inverted, because each city is nearly one AQI band and the model learned the city. These results are why HazeBusters does not estimate AQI from images.

## What we built in AQI Vision

[AQI Vision](/work/aqi-vision) is our minor project in the ECE department at BIT Mesra, supervised by Dr. Afaque Azam. We took the HazeBusters finding into its phase 2 and wrote evaluation tooling so our own numbers come from grouped splits. The docstring at the top of `aqivision/evaluation.py` states the problem:

```python
"""Leak-free evaluation helpers.

Image AQI datasets are made of bursts: many frames of the same place at the same time share one
label (TRAQID: dashcam frames 5 s apart on 17 dates; India/Nepal: 12,240 images from 115
location+date+hour moments). A random image-level split puts near-duplicates of the same moment
in train and test, so the model can score well by recognising the moment instead of the haze.
# ...
"""
```

The module has four small pieces: `group_split`, `leave_one_group_out`, a `leakage` report and `metrics`, which always reports the majority-class baseline next to accuracy and macro-F1. Here is the grouped split from `aqivision/evaluation.py`. It shuffles the distinct groups and sends whole groups to the test side:

```python
def group_split(groups, test_frac: float = 0.2, seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """Index arrays (train, test) such that no group appears on both sides."""
    groups = np.asarray(groups)
    uniq = np.unique(groups)
    rng = np.random.default_rng(seed)
    rng.shuffle(uniq)
    n_test = max(1, int(round(len(uniq) * test_frac)))
    test_groups = set(uniq[:n_test].tolist())
    is_test = np.array([g in test_groups for g in groups])
    return np.flatnonzero(~is_test), np.flatnonzero(is_test)
```

A group can be a date, a location, or a moment. The usage note in the same docstring builds a moment from location, date and hour:

```python
groups = df["location"] + "_" + df["date"] + "_" + df["hour"].astype(str)
train, test = group_split(groups, test_frac=0.2, seed=0)
print(leakage(groups, train, test))   # must be 0 shared groups
```

`leakage` returns how many groups appear on both sides and how many test rows fall in those shared groups. The comment in the usage note sets the rule at zero shared groups. `random_split` is still in the module, but its docstring says it is "for comparison only: leaks when frames come in groups".

One test in `tests/test_evaluation.py` builds a "model" that only memorises which label each group had, then scores it both ways:

```python
def test_memorising_groups_looks_perfect_on_random_split_only():
    # every group has one label; a "model" that memorises group -> label
    rng = np.random.default_rng(0)
    groups = np.repeat(np.arange(30), 20)
    label_of = rng.integers(0, 3, 30)
    y = label_of[groups]
    # ...
    tr, te = ev.random_split(len(y))
    assert ev.metrics(y[te], memoriser(tr, te))["accuracy"] == 1.0
    tr, te = ev.group_split(groups)
    assert ev.metrics(y[te], memoriser(tr, te))["accuracy"] < 1.0
```

A lookup table with no idea what haze looks like gets 100% on a random split. Another test checks that a random split over 20 groups of 30 rows shares more than 15 groups between train and test.

The model this tooling has to check is our phase-1 classifier, which takes three views of the same photo: the RGB image, a saturation-equalised version and a SLIC superpixel version. The preprocessing lives in `aqivision/image_model.py`:

```python
def create_saturation(img: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    hsv[:, :, 1] = cv2.equalizeHist(hsv[:, :, 1])
    return cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)


def create_superpixel(img: np.ndarray) -> np.ndarray:
    segments = slic(img, n_segments=30, compactness=5)
    sp_img = label2rgb(segments, img, kind="avg")
    return (sp_img * 255).astype(np.uint8)
```

The photo is resized to 224×224 before the two extra views are made, and each stream is scaled to [-1, 1] before it reaches the Keras model. Phase 1 was evaluated with a random image-level split. Our roadmap has the three-stream model re-evaluated with `group_split` by date and location, on paired clips we collect ourselves in Ranchi (phone video plus the nearest station reading). In phase 2 we also use the camera as a source of context, meaning what is visibly polluting (traffic, heavy vehicles, smoke), and of temporally smoothed estimates.

## What I took from it

- If your data comes in bursts (video, dashcam drives, photos taken minutes apart), a random split rewards a model for memorising the bursts.
- Report the baseline next to every accuracy. 33.5% only means something next to 33.7%.
- Make leakage a number your code prints, and make zero the only acceptable value.

The probes and every number above are in `ml/RESULTS.md` in the [HazeBusters repo](https://github.com/ASR222/hazebusters). The AQI Vision code is in the `semester-2-video-pipeline` branch of [AQI_project](https://github.com/ASR222/AQI_project).
