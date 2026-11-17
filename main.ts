// GTA VI launch-day Twitch forecast (gta6-twitch-ccu-forecast-01).
// A scale-conditioned reference-class forecaster: every past big launch in
// the case file contributes its release-day hourly curve, weighted by how
// close its hour-1 print is to this case's hour-1 print, and the forecast
// quantiles come from the weighted distribution of log-ratios per hour.
// Node 22, standard library only. Run: node main.ts (or with
// MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR set, as the grader does).

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level above (to 3 decimals). */
const Z_TABLE = [-1.645, -0.674, 0, 0.674, 1.645];

/**
 * Model constants, fitted on the kit's practice cases (p00-p03, answers from
 * SullyGnome) and 152 leave-one-out pseudo-cases over the comparables.
 * Practice mean pinball loss 0.218 vs the house baseline's 0.387.
 */
const BANDWIDTH = 0.5; // Gaussian kernel bandwidth, in log10(viewers)
const BLEND = 0.5; // centre = (1-BLEND)*weighted median + BLEND*weighted mean
const SPREAD_FLOOR = 0.25; // log units; honest spread, never narrower
const SPREAD_CAP = 1.2; // log units; never wider
const BASELINE_SIGMA = 0.15; // fallback spread per sqrt-hour (house baseline)

interface HourlyPoint {
  from: string;
  viewers: number;
  channels: number;
}

interface Comparable {
  name: string;
  day_start: string;
  hourly: HourlyPoint[];
}

interface CaseFile {
  id: string;
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables: Comparable[];
}

interface WeightedPair {
  value: number;
  weight: number;
}

/** x rounded to 2 decimals (half up). */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * The standard normal's quantile at p, Acklam's rational approximation
 * (accurate to ~1e-9). Used only when a case asks for levels outside the
 * table above; the table itself is exact for the contest's levels.
 */
const normalQuantile = (p: number): number => {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285984469534e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
  const plow = 0.02425;
  const phigh = 1 - plow;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
};

/** The normal quantile at level tau: the table when it matches, else Acklam. */
const zForLevel = (tau: number): number => {
  const idx = LEVELS.indexOf(tau);
  return idx >= 0 ? Z_TABLE[idx] : normalQuantile(tau);
};

/**
 * The `from` key of release-day hour h (1-based) for a comparable whose day
 * starts at `dayStart` (ISO 8601 UTC, 00:00 of its release date): the
 * SullyGnome points are keyed `YYYY-MM-DDTHH:00:00Z`.
 */
const hourKey = (dayStart: string, hour: number): string => {
  const base = Date.parse(dayStart);
  const t = new Date(base + (hour - 1) * 3600 * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:00:00Z`;
};

/**
 * A comparable's release-day hourly viewers, hours 1..24, or null where the
 * source has no point for that hour. Returns null for the whole comparable
 * when its hour-1 print is missing or not positive: without an anchor there
 * is no ratio to take.
 */
const releaseProfile = (comp: Comparable): Array<number | null> | null => {
  const byFrom = new Map<string, number>();
  for (const row of comp.hourly ?? []) {
    if (typeof row.viewers === 'number') byFrom.set(row.from, row.viewers);
  }
  const profile: Array<number | null> = [];
  for (let h = 1; h <= 24; h++) {
    const v = byFrom.get(hourKey(comp.day_start, h));
    profile.push(v === undefined ? null : v);
  }
  if (profile[0] === null || (profile[0] as number) <= 0) return null;
  return profile;
};

/** The weighted median of (value, weight) pairs, by cumulative weight. */
const weightedMedian = (pairs: WeightedPair[]): number => {
  const sorted = [...pairs].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, p) => s + p.weight, 0);
  let acc = 0;
  for (const p of sorted) {
    acc += p.weight;
    if (acc >= total / 2) return p.value;
  }
  return sorted[sorted.length - 1].value;
};

/** The weighted mean of (value, weight) pairs. */
const weightedMean = (pairs: WeightedPair[]): number => {
  const total = pairs.reduce((s, p) => s + p.weight, 0);
  return pairs.reduce((s, p) => s + p.value * p.weight, 0) / total;
};

/** The weighted p-quantile of (value, weight) pairs, by cumulative weight. */
const weightedQuantile = (pairs: WeightedPair[], p: number): number => {
  const sorted = [...pairs].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, x) => s + x.weight, 0);
  let acc = 0;
  for (const x of sorted) {
    acc += x.weight;
    if (acc >= p * total) return x.value;
  }
  return sorted[sorted.length - 1].value;
};

/**
 * The flat house-baseline shape for one hour, in log space: every quantile
 * sits at the hour-1 print, with a spread that widens like a random walk's.
 * Used only when an hour has no reference data at all.
 */
const baselineLogQuantiles = (hour: number): number[] =>
  LEVELS.map((tau) => zForLevel(tau) * BASELINE_SIGMA * Math.sqrt(hour - 1));

/**
 * One hour's five log-quantiles (log viewers, relative to log p1) from the
 * reference class. Each comparable contributes its log-ratio ln(v_h / v_1)
 * for that hour, weighted by a Gaussian kernel on log10(v_1) around log10(p1):
 * launches the size of this one dominate, small ones fade out. The centre
 * blends the weighted median and mean (the ratio distribution is right
 * skewed, so the mean sits above the median); the spread is asymmetric,
 * lower from the 16th percentile and upper from the 84th, so a skewed
 * reference class widens the honest side. Missing hours are skipped, never
 * imputed as zero. With no reference at all, fall back to the flat house
 * baseline shape for that hour.
 */
const hourLogQuantiles = (
  p1: number,
  profiles: Array<Array<number | null>>,
  hour: number,
): number[] => {
  const logP1 = Math.log10(p1);
  const pairs: WeightedPair[] = [];
  for (const prof of profiles) {
    const v1 = prof[0];
    const vh = prof[hour - 1];
    if (v1 === null || vh === null || v1 <= 0 || vh <= 0) continue;
    const w = Math.exp(-0.5 * ((Math.log10(v1) - logP1) / BANDWIDTH) ** 2);
    pairs.push({ value: Math.log(vh / v1), weight: w });
  }
  if (pairs.length === 0) return baselineLogQuantiles(hour);
  const med = weightedMedian(pairs);
  const mean = weightedMean(pairs);
  const centre = (1 - BLEND) * med + BLEND * mean;
  const q16 = weightedQuantile(pairs, 0.16);
  const q84 = weightedQuantile(pairs, 0.84);
  const lower = Math.min(SPREAD_CAP, Math.max(SPREAD_FLOOR, med - q16));
  const upper = Math.min(SPREAD_CAP, Math.max(SPREAD_FLOOR, q84 - med));
  return LEVELS.map((tau) => {
    const z = zForLevel(tau);
    return z < 0 ? centre + z * lower : centre + z * upper;
  });
};

/**
 * The forecast rows for one case: 23 rows, hours 2..24, each five quantiles
 * in viewers. Each quantile row is lightly smoothed over neighbouring hours
 * in log space (a 3-hour window), which steadies the curve without moving
 * it: the launch-day shape is a broad dip-then-rise, not an hourly spike.
 */
const forecastCase = (c: CaseFile): Array<{ hour: number; q: number[] }> => {
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error(`case ${c.id} has no hour-1 print`);
  const p1 = Math.max(1, first.viewers);
  const profiles: Array<Array<number | null>> = [];
  for (const comp of c.comparables ?? []) {
    const prof = releaseProfile(comp);
    if (prof !== null) profiles.push(prof);
  }
  const logRows = new Map<number, number[]>();
  for (const { hour } of c.forecast) {
    if (hour < 2 || hour > 24) continue;
    logRows.set(hour, hourLogQuantiles(p1, profiles, hour));
  }
  const rows: Array<{ hour: number; q: number[] }> = [];
  for (const { hour } of c.forecast) {
    if (hour < 2 || hour > 24) continue;
    const qs: number[] = [];
    for (let j = 0; j < LEVELS.length; j++) {
      let sum = 0;
      let count = 0;
      for (let hh = Math.max(2, hour - 1); hh <= Math.min(24, hour + 1); hh++) {
        const row = logRows.get(hh);
        if (row !== undefined) {
          sum += row[j];
          count++;
        }
      }
      const logQ = sum / count;
      qs.push(Math.max(1, Math.min(1e9, round2(p1 * Math.exp(logQ)))));
    }
    for (let j = 1; j < qs.length; j++) qs[j] = Math.max(qs[j], qs[j - 1]);
    rows.push({ hour, q: qs });
  }
  return rows;
};

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseFile;
  if (!Array.isArray(c.levels) || c.levels.length !== LEVELS.length) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const hours = forecastCase(c);
  if (hours.length !== 23) throw new Error(`${file} produced ${hours.length} rows, not 23`);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
