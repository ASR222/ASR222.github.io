---
title: CAMS vs 59 ground stations
description: Before showing a modelled AQI where there is no monitor, we checked CAMS against two years of station data, found it reads about 0.8x, and now scale it by 1.25 on purpose.
date: 2026-10-17
kind: technical
tags: [Air quality, Validation, Python]
project: hazebusters
draft: false
---

Ranchi has no official air-quality monitor. The nearest official station is Jamshedpur, about 110 km away, and when we checked on 11 Oct it wasn't reporting to WAQI either. Big cities go dark too: all 9 WAQI stations in Hyderabad last reported on 23 Jun 2026.

For a lot of users, then, HazeBusters has no measurement to show, only a model: CAMS, the Copernicus atmospheric model, available through the Open-Meteo air-quality API on a grid of about 45 km. Before putting a model value in front of a school deciding on outdoor PE, we wanted to know how far off it runs.

## What we compared

The script is `ml/validate_cams.py`. It compares daily PM2.5 for 2023 and 2024 in three cities that have ground stations: Delhi, Hyderabad and Patna.

Ground truth comes from the Kaggle "India AQI 2010–2024" stations dataset (CC BY-SA 4.0). Each station's 15-minute PM2.5 becomes a station-day mean, kept only if at least 18 distinct hours have data, and the city-day value is the mean over that city's stations.

The CAMS side is hourly PM2.5 from the Open-Meteo API with `domains=cams_global` (0.4°) at the mean station location, averaged to a day under the same 18-hour rule.

Both sides go through the same shared CPCB-style AQI function, on PM2.5 only, to get bands. The station side, from `ml/validate_cams.py`:

```python
def station_daily(path: Path) -> pd.Series:
    df = pd.read_csv(path, usecols=["pm2.5", "timestamp"], parse_dates=["timestamp"])
    df = df[(df["timestamp"] >= START) & (df["timestamp"] < pd.Timestamp(END) + pd.Timedelta(days=1))]
    df = df[df["pm2.5"].notna() & (df["pm2.5"] > 0)]
    if df.empty:
        return pd.Series(dtype=float)
    day = df["timestamp"].dt.normalize()
    hours = df.groupby(day)["timestamp"].agg(lambda s: s.dt.hour.nunique())
    mean = df.groupby(day)["pm2.5"].mean()
    return mean[hours >= MIN_HOURS]
```

The score we cared about most was how many of the station's Very Poor or Severe days CAMS also put in that band. Those are the days a school most needs to hear "no".

## What CAMS got right and wrong

731 days per city:

| City | Stations | Same 3-band | Median CAMS/station | Pearson r | Median PM2.5 station / CAMS |
| --- | --- | --- | --- | --- | --- |
| Delhi | 43 | 56.2% | 0.78 | 0.79 | 70 / 55 |
| Hyderabad | 12 | 94.8% | 0.79 | 0.71 | 33 / 27 |
| Patna | 4 | 62.5% | 0.81 | 0.79 | 68 / 49 |

- CAMS follows the day-to-day ups and downs (correlation of 0.71 to 0.79), but it reads low, about 0.8x the stations, and that ratio is close in all three cities.
- It misses most of the worst days. Of the station days that were Very Poor or Severe, CAMS put 67 of 201 in that band in Delhi (33%) and 46 of 133 in Patna (35%). It almost never over-calls.
- Hyderabad's 94.8% says little about skill. 97.1% of its days are in the cleanest band, so "always say clean" would score higher. That one taught me to look at base rates before quoting an agreement number.

![Smog at New Delhi railway station, 2017](/img/delhi-smog.jpg)

Delhi's bad-day row in the confusion matrix shows where the misses go: of 201 station days in Very Poor/Severe, CAMS called 15 Good/Satisfactory, 119 Moderate/Poor and 67 Very Poor/Severe.

## The correction

For a school, the costs are not symmetric. Missing a severe day sends children out into bad air, while calling a borderline day "limit" costs a shorter PE period. So we chose to bias the modelled number upwards, roughly undoing the 0.8 ratio, and to say so on screen.

From `backend/src/air/combine.py`:

```python
# CAMS daily PM2.5 ran ~0.8x the ground stations: median CAMS/station ratio 0.78 (Delhi), 0.79 (Hyderabad),
# 0.81 (Patna), 2023-24 (ml/runs/cams_validation/summary.json, from ml/validate_cams.py; ml/RESULTS.md §2).
CAMS_CORRECTION = 1.25
```

It only applies when the answer is modelled: no station reading, or the station is more than 25 km away or at least 3 hours old. In `air_for`, in the same file:

```python
scale = 1.0 if station_usable(measured, now) else CAMS_CORRECTION  # i.e. whenever `used` will be modelled
```

The scaled PM2.5 and PM10 feed the AQI, the outdoor decision and the 3-hour forecast. The decision rule stays the same: AQI up to 100 is "yes", 101 to 200 is "limit", above 200 is "no".

## What the correction catches, and what it costs

We re-ran the validation with CAMS raw and CAMS x1.25 on the same days and stations:

| City | CAMS | Same 3-band | Very Poor/Severe caught | False alarms | Median bias (µg/m³) |
| --- | --- | --- | --- | --- | --- |
| Delhi | raw | 56.2% | 67 / 201 | 1 | -17.2 |
| Delhi | x1.25 | 63.2% | 125 / 201 | 10 | -2.4 |
| Patna | raw | 62.5% | 46 / 133 | 8 | -10.6 |
| Patna | x1.25 | 67.6% | 80 / 133 | 20 | +0.3 |
| Hyderabad | raw | 94.8% | 0 / 2 | 0 | -6.9 |
| Hyderabad | x1.25 | 86.3% | 0 / 2 | 0 | -0.3 |

In Delhi the correction nearly doubles the bad days caught, 67 to 125. In Patna it goes from 46 to 80. Band agreement rises by 7.0 and 5.1 points, and the median bias moves to about zero in all three cities.

It also costs something:

- Hyderabad gets worse. Band agreement falls from 94.8% to 86.3%, and 90 of its 710 Good/Satisfactory days are now called Moderate/Poor, up from 21. In a clean city, x1.25 pushes borderline days over the AQI-100 line and turns "yes" into "limit".
- Polluted cities get more false alarms. Very Poor/Severe false alarms go from 1 to 10 in Delhi and 8 to 20 in Patna. In Delhi, Good/Satisfactory days called Moderate/Poor rise from 44 to 104.

When the answer is modelled, the first caveat on the result page names the nearest station and why it wasn't used, then says the estimate uses CAMS with PM2.5/PM10 scaled x1.25 because CAMS read about 0.8x ground stations in Delhi, Hyderabad and Patna.

## Limitations

- It's in-sample. The factor was chosen from these same three cities' ratios, so the corrected numbers flatter it, and it hasn't been checked on any other city.
- The check covers three cities and PM2.5 only. Applying the same factor to PM10 is an assumption.
- City-day means smooth over hotspots. Stations sit in cities, while a 45 km CAMS cell mixes in cleaner surroundings, which explains part of the low bias.
- Station counts are thin. Hyderabad and Patna have a median of 9 and 4 stations per day, with minimums of 2 and 1.
- The AQI is only "CPCB-style". We compute it from PM, not the official 24-hour, three-or-more-pollutant AQI.

A city-dependent or level-dependent correction would probably do better than one constant, but it would need more cities than we had.

## What I'd keep from this

- If you can't predict a number honestly, validate a source that already exists. This came straight after [the image model failed](/writing/model-scored-89-percent).
- Score the error that matters to your user. "Bad days caught" told us more than any accuracy figure.
- When errors cost more in one direction, bias on purpose, measure the cost and print it where the user can see it.
