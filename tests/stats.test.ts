import { describe, it, expect } from "vitest";
import { pairedCompare, tCdf, normPpf } from "../src/stats/paired.js";

/**
 * Parity check: these reference values were produced by an independent reference
 * implementation on the same inputs, so this guards against numerical drift.
 */
describe("pairedCompare parity with stats.py", () => {
  const off = [100, 120, 140, 130];
  const on = [90, 100, 150, 110];
  const r = pairedCompare(off, on);

  it("matches the Python reference", () => {
    expect(r.meanDiff).toBeCloseTo(-10, 6);
    expect(r.sdDiff).toBeCloseTo(14.142136, 5);
    expect(r.pairedSe).toBeCloseTo(7.071068, 5);
    expect(r.t).toBeCloseTo(-1.414214, 5);
    expect(r.p).toBeCloseTo(0.252215, 5);
    expect(r.cohenDz).toBeCloseTo(-0.707107, 5);
    expect(r.ci95[0]).toBeCloseTo(-32.503294, 4);
    expect(r.ci95[1]).toBeCloseTo(12.503294, 4);
    expect(r.mde).toBeCloseTo(28.454454, 4);
    expect(r.requiredN).toBe(18);
    expect(r.resolvable).toBe(false);
    expect(r.unpairedSe).toBeCloseTo(15.679073, 4);
  });
});

describe("distribution functions parity", () => {
  it("matches t_cdf and norm_ppf reference values", () => {
    expect(tCdf(1.5, 3)).toBeCloseTo(0.884708, 5);
    expect(normPpf(0.8)).toBeCloseTo(0.841621, 5);
  });
});
