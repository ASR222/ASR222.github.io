---
title: Reading a 10-second clip
description: How AQI Vision turns a short phone clip into JSON on a CPU, using frame sampling, a quality gate, windowed averaging, YOLO11n with ByteTrack, and a worker process to fix a segfault.
date: 2026-10-30
kind: technical
tags: [Computer vision, Python, Video]
project: aqi-vision
draft: false
---

The phase-1 model in AQI Vision classifies one photo. A phone clip has many frames, and they vary: some frames are dark or blurred, some point at the ground, and the same truck can sit in thirty frames in a row. Predictions made one frame at a time also flicker.

So phase 2 keeps the model and builds a pipeline around it. `/predict-video` in `app.py` takes a short clip (about 10 seconds) and returns JSON. The sections below follow a frame through it in order.

## Two branches

The docstring of `aqivision/video/pipeline.py` has the whole shape:

```text
frames (OpenCV) ──┬─ sample ~2 fps ─> quality gate ─> 3-stream CNN per frame ─> sliding-window aggregate
                  └─ every frame ───> YOLO11n + ByteTrack ─> unique objects, peak counts, heavy-vehicle share
```

The two branches are independent, and the same docstring says so: "detections never change the AQI estimate". Either branch can be switched off by passing `classifier=None` or `tracker=None`, and the CLI has `--no-aqi` and `--no-track` for the same reason.

## Frame sampling

The two branches want different frames. A tracker needs consecutive frames to follow an object. The classifier is slower and gets frames about 0.5 seconds apart.

Phones record variable frame rate, so a frame's index is not a reliable clock. `aqivision/video/frames.py` takes the timestamp from the container when it has one:

```python
while cap.grab():
    if idx % stride == 0:
        ms = cap.get(cv2.CAP_PROP_POS_MSEC)
        ok, bgr = cap.retrieve()
        if ok:
            t = ms / 1000 if (ms > 0 or idx == 0) else idx / fps
            yield Frame(idx, t, bgr)
            # ...
    idx += 1
```

`sample()` walks those frames and keeps one each time the timestamp passes the next half-second mark, up to 120 frames. A test writes a 2-second synthetic clip at 30 fps and checks that exactly four frames come back, at least 0.49 seconds apart.

## The quality gate

The image model was trained on daytime outdoor photos with visible sky. Frames that are dark, blurred or show no sky are out of distribution, so the pipeline drops them instead of classifying them.

`aqivision/video/quality.py` downscales each frame to 320 pixels wide and computes three numbers: mean luma, sharpness and a sky fraction. Sharpness is the tricky one, because plain sky has almost no texture, so whole-frame Laplacian variance would call a sharp sky shot blurred. The gate splits the frame into a 4×4 grid and takes the 80th percentile of the tile variances. A sharp frame with a lot of sky still has some sharp tiles; a really blurred frame is soft in every tile:

```python
lap = cv2.Laplacian(grey, cv2.CV_64F)
th, tw = max(1, lap.shape[0] // TILES), max(1, lap.shape[1] // TILES)
tiles = [lap[i * th : (i + 1) * th, j * tw : (j + 1) * tw].var() for i in range(TILES) for j in range(TILES)]
sharpness = float(np.percentile(tiles, PCT))
```

The sky check looks at the top 40% of the frame and counts pixels that are bright and low-saturation (overcast or haze) or in the blue hue range. The thresholds are 40 for luma, 10 for sharpness and 0.08 for sky. The module says these are starting values and have not been calibrated on a labelled set yet.

If fewer than 3 frames pass, there is no AQI estimate. The response carries a caveat instead: "point the camera at the sky outdoors in daylight." Every sampled frame's luma, sharpness, sky value and reject reasons go into the output too, so a rejected clip can be explained.

## Smoothing over time

Single-frame predictions flicker when a car passes or the camera tilts. `aqivision/video/temporal.py` averages the per-frame class probabilities over sliding windows of 8 frames with a stride of 4, adds one extra window to cover the tail when the stride leaves frames out, and takes the clip probability as the mean of the windows.

The number to watch is `stability`: the share of windows whose top class matches the clip's top class. The pipeline flags anything below 0.6:

```python
if agg["stability"] < 0.6:
    out.setdefault("caveats", []).append("Frame-level predictions disagree across the clip; treat the AQI class as low confidence.")
```

For live streams there is also an exponential moving average, which only looks backwards. A test checks that it is causal.

## Counting unique objects

The AQI is a property of the scene, but the causes you can see on camera are objects: traffic, heavy vehicles, people outdoors. `aqivision/video/tracking.py` runs YOLO11n, pretrained on COCO, with ByteTrack, limited to people, cars, motorcycles, buses and trucks.

Counting boxes per frame would count the same truck 30 times. The tracker counts unique track IDs per class instead, and ignores tracks seen in fewer than 3 frames as flicker. The summary also reports peak objects in a single frame, dwell time per track, and the heavy-vehicle share (buses and trucks over all vehicles). It runs at about 12 frames per second on a single CPU thread, and the summary reports its own `processing_fps` for each clip.

After each video the tracker resets its predictor, so the next clip starts with fresh tracker state.

## The segfault

Running both branches in one Python process can crash it. The AQI model is Keras, so it loads TensorFlow. Ultralytics loads PyTorch. The docstring of `IsolatedTracker` records the combination: tensorflow-cpu 2.21 with torch 2.14 segfaulted in either import order.

The fix was to keep the two frameworks out of the same interpreter. `IsolatedTracker` has the same interface as `Tracker`, but runs YOLO in a separate worker process, from `aqivision/video/tracking.py`:

```python
self._pool = ProcessPoolExecutor(
    max_workers=1,
    mp_context=mp.get_context("spawn"),  # fresh interpreter: never inherits TensorFlow
    initializer=_init_worker,
    initargs=(tracker_kwargs,),
)
```

`spawn` matters because a forked child would start as a copy of a process that already has TensorFlow loaded. The initializer loads the YOLO model once in the worker, and every later call reuses it. The API creates the tracker lazily and closes the pool on shutdown, and the CLI only uses the isolated version when the AQI model is also running.

## Tests

There are 16 pytest tests. Fourteen run on synthetic data with no model files: clips drawn with OpenCV (a light-blue sky over textured ground with a moving block, or an almost black frame), fake classifiers that return fixed probabilities, and the grouped-split helpers from the [evaluation post](/writing/random-splits-lie).

The other two need real weights and a real clip, and skip unless `YOLO_WEIGHTS` and `DEMO_CLIP` are set. One of them is the regression test for the crash: it builds a small Keras model in the test process, runs the full pipeline with `IsolatedTracker`, and checks that it finishes with an AQI result and at least one tracked object.

## What's still open

From the roadmap in the README:

- Calibrate the quality gate on a labelled set of my own clips.
- Fine-tune YOLO for smoke, fire and dust plumes, so detections cover pollution sources and not only vehicles.
- Line-crossing counts for fixed cameras.
- ONNX or INT8 export for on-device use.

I built this under Dr. Afaque Azam, my research supervisor at BIT Mesra. The code is in the `semester-2-video-pipeline` branch of [AQI_project](https://github.com/ASR222/AQI_project).
