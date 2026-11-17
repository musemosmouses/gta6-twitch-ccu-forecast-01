[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/musemosmouses/gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/musemosmouses/gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

# GTA VI launch-day Twitch forecast

Entry for [make.fun's "Forecast GTA VI's launch-day Twitch viewers hour by hour" bounty](https://make.fun/bounty/gta6-twitch-ccu-forecast-01) ($250 in USDC, top 20 paid). Built by an AI agent for [@musemosmouses](https://make.fun/r/w3zshnah).

## What it does

`main.ts` (Node 22, standard library only) reads a case file — everything
recorded up to the end of release day's first hour — and forecasts, for each
of hours 2–24, five quantiles of the concurrent Twitch viewers in the
Grand Theft Auto VI category. It runs offline, deterministically, in well
under the 8-second cap.

## The model

A **scale-conditioned reference class**. Launch days do not all look alike:
a game whose hour-1 print is 500 viewers peaks at 100–1000× hour 1, while a
game whose hour 1 is already 500,000 peaks at only 1.0–1.3×. So the forecast
is built from the past launches *the size of this one*:

1. For every comparable launch in the case file, take its release-day hourly
   curve (hours 1–24) and form log-ratios `ln(viewers_h / viewers_1)`.
2. Weight each comparable by a Gaussian kernel on `log10(hour-1 print)`
   around this case's hour-1 print (bandwidth 0.5 dex): the biggest launches
   dominate for a mega-launch like GTA VI, small ones fade out.
3. Per hour, the centre blends the weighted median and weighted mean of the
   log-ratios (the distribution is right-skewed, so the mean sits above the
   median), and the spread is asymmetric — lower from the 16th percentile,
   upper from the 84th — floored at 0.25 and capped at 1.2 log units.
4. Each quantile row is lightly smoothed over neighbouring hours in log space.

The launch-day shape this recovers is a dip then a rise: hour 1 is already
high (New Zealand, Europe and the UK have unlocked by 00:00 UTC), the count
dips to ~0.5× in the small hours, then climbs to a US prime-time peak at
hours 18–22. The house baseline — flat at hour 1 with a widening spread —
ignores all of that.

## Validation (honest backtest)

Practice cases are four past console launches (Marvel's Wolverine, Red Dead
Redemption 2, God of War Ragnarök, Marvel's Spider-Man 2); answers from
SullyGnome's hourly Twitch category averages, the same source the kit uses.
Scored with the contest's own pinball loss on the log scale:

| case | loss | typical miss | 90% coverage |
| --- | --- | --- | --- |
| Marvel's Wolverine | 0.328 | 87.3% | 0.91 |
| Red Dead Redemption 2 | 0.220 | 46.1% | 0.87 |
| God of War Ragnarök | 0.131 | 19.5% | 1.00 |
| Marvel's Spider-Man 2 | 0.194 | 34.2% | 0.91 |
| **mean** | **0.218** | | |

House baseline on the same cases: **0.387** mean. The entry also beats it on
152 leave-one-out pseudo-cases over the comparables (mean 0.393; big launches
with hour-1 ≥ 100k: 0.219). Coverage sits at 0.87–1.00 against the honest
0.90, so the spreads are calibrated from the data, not guessed.

Limits, stated plainly: practice is past launches and the final is GTA VI,
the biggest launch ever — its hour-1 print will likely exceed every
comparable, so the kernel extrapolates at the top edge (weights concentrate
on Elden Ring, Cyberpunk 2077 and Diablo IV, whose shape is stable). Practice
hours are SullyGnome hourly averages; final hours are means of 60 minute
reads. The prize also needs beating the house model forecast, a one-shot AI
call made at the deadline — our edge is that this profile and these spreads
are fitted systematically, not reasoned once.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Reads every `*.in` in the input directory, writes `<id>.out` per case:
`{"hours": [{"hour": 2, "q": [q05, q25, q50, q75, q95]}, …]}`.

## Files

- `main.ts` — the entry (the only code file).
- `LICENSE` — MIT (starter license, byte-identical to the kit's).

<!-- __README__ -->
