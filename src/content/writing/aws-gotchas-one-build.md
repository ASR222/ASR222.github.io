---
title: AWS gotchas from one build
description: Twelve AWS problems I hit shipping HazeBusters on Lambda, S3, Bedrock and Amplify, and the fix for each.
date: 2026-10-30
kind: journey
tags: [AWS, Serverless, Lessons]
project: hazebusters
draft: false
---

HazeBusters worked end to end. Then one job took 13 seconds. Loading the smoke/fire ONNX model at cold start had pushed Lambda's init phase past its 10-second limit, and Lambda quietly re-ran the init inside the request.

That was one of many AWS surprises while I built [HazeBusters](/work/hazebusters), a phone web app that tells a school whether PE can go outdoors today, even where there's no air monitor. This post is the architecture and the twelve problems that cost me time, each with the fix. The model side of the Lambda work (the ONNX export, the CAM heatmap in NumPy and the YOLO post-processing) is in [Vision on Lambda without PyTorch](/writing/vision-on-lambda), and the day-by-day story is in [Building HazeBusters in 4 days](/writing/building-hazebusters).

## The architecture

![HazeBusters architecture on AWS](/img/hazebusters.jpg)

Everything runs in ap-south-1 (Mumbai) and deploys with AWS SAM.

1. Amplify Hosting serves the PWA: plain HTML, CSS and JS, with no framework and no build step.
2. An HTTP API on API Gateway calls a CreateJob Lambda. It validates the location and profile, writes a `pending` row to DynamoDB and returns a presigned S3 PUT URL.
3. The phone uploads the clip straight to S3, so the video never passes through API Gateway.
4. The S3 event triggers the processor Lambda, a container image on ECR with Python 3.12, 3 GB of memory and ONNX Runtime, about 1.26 GB in all. It samples about one frame per second, runs a quality gate, the smoke/fire model with its heatmap and a YOLO vehicle count, then fetches WAQI and CAMS air data, picks the source and computes the decision. Amazon Bedrock (Amazon Nova 2 Lite) writes the advice in English and Hindi, Amazon Polly reads it aloud with the neural Hindi voice Kajal (plus English) and saves the audio to S3, and the result goes to DynamoDB.
5. The phone polls GetJob, which returns the result with presigned links to the audio and the heatmap.

From upload to advice takes about 10 seconds on a phone. A warm processor run is 5 to 6 s, and Bedrock accounts for about 1 to 1.5 s of that.

Before any of it existed I wrote the result contract, a `contract.json` with every field the frontend would read. ML, backend and frontend were built against it in parallel, and integration took minutes instead of an evening.

## Uploads and the SAM template

Presigned S3 uploads from the browser failed CORS. Sign the URL with the same `Content-Type` the browser will send. Outside us-east-1, also force SigV4 with virtual-host addressing, or new buckets can redirect and break CORS. The signing code:

```python
s3 = boto3.client("s3", region_name=REGION,
                  config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}))
url = s3.generate_presigned_url("put_object", ExpiresIn=300,
          Params={"Bucket": BUCKET, "Key": key, "ContentType": content_type})
```

Then SAM refused to deploy because of a circular dependency between the bucket, its event notification and the function's policy. The fix is to give the bucket an explicit name, such as `!Sub "${AWS::StackName}-uploads-${AWS::AccountId}"`, and reference that string in the policy in place of `!Ref`.

## Lambda itself

The 13-second job came from the init limit. Lambda gives the init phase 10 seconds, and when init runs past that, it reruns init inside the invocation. Loading the model lazily on the first request brought init down to about 1.3 s. Here is the pattern, in a simplified form:

```python
_session = None
def session():
    global _session
    if _session is None:
        _session = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
    return _session
```

The real loader also caches the CAM head and keeps a load failure so each clip can report it; it's quoted in [Vision on Lambda without PyTorch](/writing/vision-on-lambda).

I kept PyTorch out of the container. ONNX Runtime plus NumPy covers inference and the heatmap, because for this model the class activation map is the classifier weights times the final feature map, with no gradients needed.

New AWS accounts can have a Lambda concurrency limit of 10. Mine did, and it can't be raised through Service Quotas below 1,000. Every upload starts a processor run, so I throttled the API to a burst of 10 and 5 requests per second, which keeps a burst of requests from starving the processor.

## Bedrock and DynamoDB

Bedrock model access took more than ticking a box in the console. Anthropic models needed an AWS Marketplace subscription permission my IAM user didn't have, so the app uses Amazon Nova 2 Lite. Nova has to be called through its inference profile ID, `global.amazon.nova-2-lite-v1:0`, and the bare model ID fails. If you need models from other providers, check the Marketplace permissions on day one.

DynamoDB rejects Python floats. I store the whole result as a JSON string in a `result_json` attribute, which is simpler than converting every number to `Decimal`.

## Time zones and third-party APIs

Lambda runs in UTC and my users are in India. The forecast logic was correctly in IST, but two fallback paths silently used UTC, and at 6 PM IST one of them would have said "today" instead of "tomorrow". The fix is to test with a UTC "now" on purpose.

Third-party error messages need reading literally. WAQI returns `"can not connect"` for a location when there is no station, and also when stations exist but are offline. I added a bundled index of official stations, so the caveat in the app can say "the nearest station, X km away, last reported 109 days ago" instead of guessing.

External APIs also time out exactly when you demo. One Open-Meteo call took over 10 s and a job failed. One retry plus logging fixed it.

## The front end and deploys

Service workers cache yesterday's bug. The PWA uses network-first for its own files, never intercepts API or S3 requests, and bumps a cache version on every deploy.

Amplify manual deploys can get stuck at "Deploy pending" if the upload didn't finish, and every later deploy queues behind the stuck one. The way out is to stop the stuck jobs and deploy from the CLI: `aws amplify create-deployment`, upload the zip to the URL it returns, then `aws amplify start-deployment`.

## What I check first now

On a new AWS build I start with the account's Lambda concurrency limit, presigned uploads signed with the same Content-Type over SigV4 and virtual addressing, models loaded lazily with no torch in the image, and time-zone tests that run with a UTC clock. Every one of those cost me time on HazeBusters, and all of them are quick to check before the first deploy.

## What's next

HazeBusters hasn't been piloted with a school yet, so pilots with schools come first. After that come daily morning alerts for schools, where EventBridge and SES fit naturally into the same stack, and more Indian languages.

[Live app](https://main.dxwuap9t49si3.amplifyapp.com) · [Code](https://github.com/ASR222/hazebusters) · [Video](https://youtu.be/22mFX22fPbI)
