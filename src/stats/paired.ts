/**
 * Pure-TypeScript paired-difference statistics. Implements the methods from Anthropic's "Adding Error Bars to
 * Evals" (arXiv 2411.00640): paired-difference test, minimum-detectable-effect
 * (MDE), and required-n power analysis. The t-distribution CDF/PPF use the
 * regularized incomplete beta function, evaluated by the modified Lentz
 * continued fraction (Lentz 1976; DLMF §8.17 — public-domain mathematics), so
 * small-n p-values are exact rather than a normal approximation.
 */

// ---- normal + t distributions ---------------------------------------------

/** Inverse standard-normal CDF (Acklam's algorithm; abs err < 1.2e-9). */
export function normPpf(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error("p must be in (0,1)");
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}

/**
 * Continued-fraction factor of the regularized incomplete beta, evaluated with
 * the modified Lentz algorithm (Lentz 1976). Implemented directly from the
 * standard recurrence for I_x(a,b) (DLMF §8.17.22) — public-domain mathematics,
 * not derived from any licensed source. The CF terms are, for step k≥1:
 *   even (k=2m):   d_k =  m(b-m)x / ((a+2m-1)(a+2m))
 *   odd  (k=2m+1): d_k = -(a+m)(a+b+m)x / ((a+2m)(a+2m+1))
 */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const MAX_ITER = 200;
  const EPS = 3e-12;
  const TINY = 1e-30;
  const aPlusB = a + b;
  const aPlus1 = a + 1;
  const aMinus1 = a - 1;

  const guard = (v: number): number => (Math.abs(v) < TINY ? TINY : v);

  let c = 1;
  let d = 1 / guard(1 - (aPlusB * x) / aPlus1);
  let frac = d;

  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    // even term
    let term = (m * (b - m) * x) / ((aMinus1 + m2) * (a + m2));
    d = 1 / guard(1 + term * d);
    c = guard(1 + term / c);
    frac *= d * c;
    // odd term
    term = -((a + m) * (aPlusB + m) * x) / ((a + m2) * (aPlus1 + m2));
    d = 1 / guard(1 + term * d);
    c = guard(1 + term / c);
    const delta = d * c;
    frac *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return frac;
}

/** Regularized incomplete beta I_x(a,b). */
export function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betaContinuedFraction(a, b, x)) / a;
  return 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Lanczos approximation of ln(Γ(z)). */
function lgamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = c[0]!;
  for (let i = 1; i < g + 2; i++) x += c[i]! / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Student-t CDF. */
export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const ib = betai(df / 2, 0.5, x);
  return t > 0 ? 1 - 0.5 * ib : 0.5 * ib;
}

/** Inverse Student-t CDF via bisection on tCdf. */
export function tPpf(p: number, df: number): number {
  let lo = -100;
  let hi = 100;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---- paired comparison + power --------------------------------------------

export interface PairedResult {
  n: number;
  meanDiff: number;
  sdDiff: number;
  pairedSe: number;
  t: number;
  df: number;
  p: number;
  cohenDz: number;
  ci95: [number, number];
  mde: number;
  requiredN: number;
  resolvable: boolean;
  unpairedSe: number;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Paired-difference test over matched task-instances off[i], on[i] (per-task
 * epoch means). MDE + required-n per the Anthropic error-bars paper.
 */
export function pairedCompare(
  off: number[],
  on: number[],
  opts: { alpha?: number; power?: number; unpairedOff?: number[]; unpairedOn?: number[] } = {},
): PairedResult {
  const alpha = opts.alpha ?? 0.05;
  const power = opts.power ?? 0.8;
  if (off.length !== on.length || off.length < 2) {
    throw new Error("need matched lists of length >= 2");
  }
  const diffs = off.map((o, i) => on[i]! - o);
  const n = diffs.length;
  const md = mean(diffs);
  const sd = stdev(diffs);
  const se = n ? sd / Math.sqrt(n) : 0;
  const df = n - 1;
  const t = se > 0 ? md / se : md === 0 ? 0 : Math.sign(md) * Infinity;
  const p = Number.isFinite(t) ? 2 * (1 - tCdf(Math.abs(t), df)) : 0;
  const dz = sd > 0 ? md / sd : 0;
  const tcrit = tPpf(1 - alpha / 2, df);
  const ci95: [number, number] = [md - tcrit * se, md + tcrit * se];
  const zbeta = normPpf(power);
  const mde = (tcrit + zbeta) * se;

  let requiredN = n;
  if (sd > 0 && md !== 0) {
    requiredN = 999;
    for (let cand = 2; cand < 1000; cand++) {
      const seC = sd / Math.sqrt(cand);
      const tc = tPpf(1 - alpha / 2, cand - 1);
      if ((tc + zbeta) * seC <= Math.abs(md)) {
        requiredN = cand;
        break;
      }
    }
  }

  const uoff = opts.unpairedOff ?? off;
  const uon = opts.unpairedOn ?? on;
  const unpairedSe = Math.sqrt(
    stdev(uoff) ** 2 / Math.max(uoff.length, 1) + stdev(uon) ** 2 / Math.max(uon.length, 1),
  );

  return {
    n,
    meanDiff: md,
    sdDiff: sd,
    pairedSe: se,
    t,
    df,
    p,
    cohenDz: dz,
    ci95,
    mde,
    requiredN,
    resolvable: p < alpha,
    unpairedSe,
  };
}
