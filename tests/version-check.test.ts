import { describe, expect, it } from "vitest";
import { compareVersions } from "../src/cli/version-check.js";

describe("compareVersions", () => {
  it("treats equal versions as zero, ignoring v-prefix", () => {
    expect(compareVersions("v0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("v1.2.3", "v1.2.3")).toBe(0);
  });

  it("orders patch versions", () => {
    expect(compareVersions("v0.1.1", "v0.1.0")).toBeGreaterThan(0);
    expect(compareVersions("v0.1.0", "v0.1.1")).toBeLessThan(0);
  });

  it("orders minor and major versions", () => {
    expect(compareVersions("v0.2.0", "v0.1.99")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.0", "v0.9.9")).toBeGreaterThan(0);
  });

  it("compares numerically, not lexicographically", () => {
    expect(compareVersions("v0.1.10", "v0.1.2")).toBeGreaterThan(0);
    expect(compareVersions("v0.1.100", "v0.1.99")).toBeGreaterThan(0);
  });

  it("treats missing components as zero", () => {
    expect(compareVersions("v1", "v1.0.0")).toBe(0);
    expect(compareVersions("v1.0", "v1.0.0")).toBe(0);
    expect(compareVersions("v1.1", "v1.0.5")).toBeGreaterThan(0);
  });

  it("strips pre-release suffix when comparing", () => {
    // We deliberately treat -beta as equal to release; this keeps the
    // notifier from telling pre-release testers to "downgrade."
    expect(compareVersions("v1.0.0-beta.1", "v1.0.0")).toBe(0);
    expect(compareVersions("v1.0.1-rc.1", "v1.0.0")).toBeGreaterThan(0);
  });

  it("survives garbage components without throwing", () => {
    expect(compareVersions("v0.1.x", "v0.1.0")).toBe(0); // x → 0
    expect(compareVersions("0.1.0", "")).toBeGreaterThan(0);
  });
});
