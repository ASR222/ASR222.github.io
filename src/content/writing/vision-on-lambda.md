---
title: Vision on Lambda without PyTorch
description: How HazeBusters fits a quality gate, a smoke/fire classifier with CAM heatmaps and a YOLO11n vehicle count into one CPU-only Lambda container using ONNX Runtime and NumPy.
date: 2026-10-22
kind: technical
tags: [AWS Lambda, ONNX, Computer vision]
project: hazebusters
draft: false
---

A teacher films 10 seconds of sky and uploads it. The clip lands in S3, an event fires, and one Lambda function has a few seconds to decide whether the clip is usable, whether there is possible smoke or fire in it, where the model was looking, and how many vehicles are in view.

Lambda has no GPU, and we kept PyTorch out of the image. For the models, the runtime got ONNX Runtime and NumPy and nothing else.

## Where it sits

![HazeBusters architecture on AWS](/img/hazebusters.jpg)

The phone asks a small CreateJob Lambda for a presigned S3 URL and uploads the clip straight to `uploads/`. That prefix triggers the processor, a container image on ECR. It samples about one frame per second, runs the vision steps below, fetches the air data, gets advice from Amazon Bedrock and audio from Amazon Polly, and writes the result to DynamoDB. The phone polls a GetJob Lambda for it. Everything is in ap-south-1, deployed with AWS SAM.

The processor in `infra/template.yaml` gets `MemorySize: 3008`, `Timeout: 300` and 2,048 MB of ephemeral storage. Its pip requirements, from `infra/processor/requirements.txt`:

```text
opencv-python-headless>=4.10
numpy>=2.0
onnxruntime==1.31.0  # same version the ML export was verified with (export_report.json)
Pillow>=11
```

OpenCV decodes the video and does the quality-gate maths, Pillow resizes and writes JPEGs, and ONNX Runtime runs both models. The image came out at about 1.26 GB.

## Step 1: a quality gate

The smoke model is trained on outdoor scenes, so an indoor or night clip would just produce noise. `infra/processor/quality.py` rejects each sampled frame, after downscaling it to 320 px wide, for one of three reasons:

| Reason | Feature | Reject when |
| --- | --- | --- |
| `dark` | mean luminance | below 40 |
| `blur` | Laplacian variance, 80th percentile over a 4x4 tile grid | below 10 |
| `no_sky` | share of sky-like pixels in the top 40% | below 0.08 |

The tiles are there because whole-frame Laplacian variance called sharp sky shots "blurred": a plain sky has almost no texture. A frame that really is blurred is soft in every tile, while a sharp sky shot still has a crisp horizon or building somewhere.

A clip needs at least 3 passing frames, or the cause models are skipped and the result says "Couldn't check what's in this clip". The thresholds came from a grid search over 24 of our own clips: 21 of 216 settings kept every outdoor clip and rejected the indoor one. The margins are thin, though. The indoor clip keeps 2 frames where 3 are needed, and a bright room with white walls can still pass as overcast sky. It's listed as a known limitation, and a learned indoor/outdoor classifier would fix it.

## Step 2: smoke and fire, exported with its features

The classifier is EfficientNet-B0 with two sigmoid outputs, smoke and fire, fine-tuned on D-Fire. For the heatmap I needed more than logits, so the export wraps the model to return the final conv feature map too. From `ml/src/hazeml/export_onnx.py`:

```python
class FeaturesAndLogits(nn.Module):
    """EfficientNet-B0 -> (final conv feature map, logits)."""

    def __init__(self, model: nn.Module):
        super().__init__()
        self.model = model

    def forward(self, x):
        f = self.model.features(x)
        return f, self.model.classifier(torch.flatten(self.model.avgpool(f), 1))
```

The ONNX file is 15.3 MB, opset 17, with outputs `features` (1280x7x7) and `logits`. On 64 D-Fire test images, the largest difference from PyTorch was 2.1e-4 on the logits. The classifier's weights and bias are saved separately in `head.npz`.

## Step 3: CAM in NumPy, no gradients

Grad-CAM needs a backward pass, and ONNX Runtime inference doesn't give you one. This head, though, is global average pooling followed by one linear layer, and for that shape the plain class activation map (Zhou et al. 2016) is exact: the logit for a class is the mean of the classifier weights times the feature map, plus the bias. The map is that product taken before the mean. From `infra/processor/cam.py`:

```python
def cam_raw(features: np.ndarray, weight: np.ndarray, label: int) -> np.ndarray:
    """(C,H,W) features, (L,C) weight -> (H,W) un-normalised CAM for `label`."""
    return np.tensordot(weight[label], features, axes=([0], [0]))


def cam(features: np.ndarray, weight: np.ndarray, label: int) -> np.ndarray:
    """CAM clipped at 0 and scaled to [0, 1] (all zeros if nothing is positive)."""
    m = np.maximum(cam_raw(features, weight, label), 0)
    return m / m.max() if m.max() > 0 else m
```

The export script checks that identity: the mean of the raw CAM plus the bias reproduces the ONNX logits to within 5.7e-6. The same file has a small bilinear resize and a red-to-yellow overlay, also in NumPy.

Per clip, a label counts as present when at least 2 frames clear its threshold. If something is present, the best frame's overlay, at most 640 px wide, goes to `overlays/{job_id}.jpg` and not to `uploads/`, since writing there would trigger the function again. The model itself takes about 0.2 to 0.4 s for 10 frames.

## Step 4: YOLO11n with our own post-processing

Vehicles come from pretrained YOLO11n on the COCO classes car, motorcycle, bus and truck, exported to ONNX at 640 px. Ultralytics isn't in the image, so `infra/processor/vehicles.py` reimplements the pre- and post-processing in NumPy: letterbox to 640 with padding value 114, decode the 84x8400 output, keep vehicle classes above 0.35, then greedy per-class NMS at IoU 0.5. The clip's count is the median of the per-frame counts.

`ml/src/hazeml/yolo_export.py` runs our code and Ultralytics side by side on 20 TRAQID frames and records whether the per-class counts match. They matched on all 20. On Lambda it costs about 150 ms per frame, roughly 1.5 s for a 10-frame clip.

YOLO11n is AGPL-3.0, so shipping it means the HazeBusters repo stays open source under AGPL-3.0.

## The 10-second init limit

Loading the smoke/fire ONNX model at cold start, in one fresh environment, pushed init past Lambda's 10-second limit. Lambda re-ran init inside the invocation, and the job took 13.3 s instead of a few. Loading lazily on the first request fixed it. From `infra/processor/causes.py`:

```python
def load(model_dir: Path | None = None) -> None:
    """Load the ONNX session + CAM head into the module cache. Called lazily by detect() on the first invocation
    (not at import: a slow cold start inside Lambda's 10 s init phase timed out and forced a re-init). A failure
    is kept, reported per clip, and retried on the next invocation."""
    global _session, _head, _load_error
    # ...
        _session = ort.InferenceSession(str(model_dir / "smokefire.onnx"), opts, providers=["CPUExecutionProvider"])
```

Init dropped to about 1.3 s. The two models also fail independently. If the smoke model can't load, the result says "Smoke check unavailable for this clip", and if YOLO fails, the vehicle count is null with its own caveat. Either way the air reading and advice still arrive.

## Timing

With everything in, a warm processor run takes about 5 to 6 s, of which Bedrock is about 1 to 1.5 s. From upload to result on a phone it's about 10 seconds.

## What it doesn't solve

The smoke classifier scored AP 0.979 on D-Fire's test split, yet in our real-clip test it flagged 5 of 13 no-smoke clips, with the heatmap sitting on ordinary city haze. So the card says "experimental" and "Possible", the advice line about smoke is hedged and written in code, and causes never change the AQI. When the model gets it wrong, the heatmap at least shows where it was looking.

## What I'd reuse

- Export the feature map along with the logits. For a GAP plus linear head, CAM is then one `tensordot` and needs no gradients.
- Verify every port: ONNX against PyTorch, NumPy CAM against ONNX logits, our NMS against Ultralytics. Each check is a few lines, and it's what lets you trust code you rewrote by hand.
- Load models lazily on Lambda if init gets anywhere near 10 seconds.
- Let each model fail on its own, with a caveat the user can read.
