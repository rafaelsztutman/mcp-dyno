import { describe, it, expect } from "vitest";
import { pairedPermutationP, bootstrapCI, pairedCompare } from "../src/stats/paired.js";

describe("pairedPermutationP (exact sign-flip)", () => {
  it("matches a hand-computed exact p-value", () => {
    // diffs [1,2,3], obs |sum|=6. Of 8 sign assignments only +++ and --- reach |6| → 2/8.
    expect(pairedPermutationP([1, 2, 3])).toBeCloseTo(0.25, 10);
  });

  it("is 1.0 when all differences are zero", () => {
    expect(pairedPermutationP([0, 0, 0, 0])).toBe(1);
  });

  it("is small for a strong, consistent effect", () => {
    expect(pairedPermutationP([5, 6, 7, 5, 6, 8, 7, 6])).toBeLessThan(0.01);
  });
});

describe("bootstrapCI", () => {
  it("is reproducible with a fixed seed and brackets the mean", () => {
    const xs = [10, 12, 9, 11, 13, 8, 10, 12];
    const a = bootstrapCI(xs, { seed: 42 });
    const b = bootstrapCI(xs, { seed: 42 });
    expect(a).toEqual(b);
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(a[0]).toBeLessThanOrEqual(m);
    expect(a[1]).toBeGreaterThanOrEqual(m);
  });
});

describe("pairedCompare exposes a permutation p", () => {
  it("adds permutationP in [0,1] without disturbing the t-test fields", () => {
    const r = pairedCompare([100, 120, 140, 130], [90, 100, 150, 110]);
    expect(r.permutationP).toBeGreaterThanOrEqual(0);
    expect(r.permutationP).toBeLessThanOrEqual(1);
    expect(typeof r.p).toBe("number"); // t-based p still present
  });
});
