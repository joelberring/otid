/**
 * Nivåstödet (ADR-0212): vägvalsmotorn och nivåstödets mätning tillsammans, som i vägvalens Worker. Sträckan längs en stig
 * är Grön eller Vit; sträckan där det lönar sig att gena över en stigbåge är Gul eller svårare.
 */
import { judgeLeg, legFeatures, prepareLevelMap } from "@o-tid/course-setting";
import { describe, expect, it } from "vitest";
import { analyseLeg, buildCostModel } from "../src";
import { forest, m } from "./synthetic";

function judged(map: ReturnType<ReturnType<typeof forest>["build"]>, from: [number, number], to: [number, number]) {
  const analysis = analyseLeg(buildCostModel(map), { key: "k", from: m(...from), to: m(...to), follow: true });
  const features = legFeatures(prepareLevelMap(map), { key: "k", from: "a", to: "b", best: analysis.best?.points, followRatio: analysis.following?.timeRatio })!;
  return { features, verdict: judgeLeg(features) };
}

describe("nivåstödet med vägvalsmotorn", () => {
  it("en sträcka längs en stig är Grön eller Vit", () => {
    const map = forest().line("505", 0.25, [0, 0], [200, 0], [400, 100]).build();
    const { features, verdict } = judged(map, [0, 0], [400, 100]);
    expect(features.handrailShare).toBeGreaterThan(0.9);
    expect(verdict.rank).toBeLessThanOrEqual(1);
  });

  it("en sträcka där det lönar sig att gena över stigens båge är Gul eller svårare", () => {
    const map = forest().line("505", 0.25, [0, 0], [100, 150], [300, 150], [400, 0]).build();
    const { features, verdict } = judged(map, [0, 0], [400, 0]);
    expect(features.shortcutGain).toBeGreaterThan(0.1);
    expect(verdict.rank).toBeGreaterThanOrEqual(2);
  });
});
