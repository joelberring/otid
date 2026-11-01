import { describe, expect, it } from "vitest";
import { symbolsForBox } from "@o-tid/course-setting";
import { G_CHOICES, gChoiceOf, gSymbolId, withFieldDescription } from "./course-setting-field";

describe("ruta G med knappar", () => {
  it.each(["2004", "2018"] as const)("alla knappar finns som symboler i ruta G (%s)", standard => {
    const ids = new Set(symbolsForBox("G", standard).map(symbol => symbol.id));
    for (const row of G_CHOICES) {
      expect(ids.has(row.ref)).toBe(true);
      expect(gSymbolId(row.choice, standard)).toBe(row.ref);
    }
  });

  it("väderstrecken är sidorna (11.1), fot och topp", () => {
    expect(gSymbolId("SE", "2018")).toBe("11.1SE");
    expect(gSymbolId("NW", "2004")).toBe("11.1NW");
    expect(gSymbolId("FOOT", "2018")).toBe("11.13");
    expect(gSymbolId("TOP", "2018")).toBe("11.11");
    expect(gChoiceOf("11.1SW")).toBe("SW");
    expect(gChoiceOf("11.2SW")).toBeUndefined();
  });
});

describe("F och G sparas, övriga rutor behålls", () => {
  it("sätter F och G", () => {
    const boxes = withFieldDescription([{ box: "D", ref: "1.11" }, { box: "G", ref: "11.1N" }], "1,5", "11.1SE");
    expect(boxes).toEqual([{ box: "D", ref: "1.11" }, { box: "F", text: "1.5" }, { box: "G", ref: "11.1SE" }]);
  });

  it("tomt F och inget G tar bort rutorna", () => {
    expect(withFieldDescription([{ box: "D", ref: "1.11" }, { box: "F", text: "2" }, { box: "G", ref: "11.11" }], " ", null))
      .toEqual([{ box: "D", ref: "1.11" }]);
  });
});
