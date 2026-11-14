import { describe, expect, it } from "vitest";
import { layoutStateName, paperName, sheetLayoutName } from "./built-in-names";

describe("O-Tids egna namn på engelska", () => {
  it("färdiga arkmallar byter namn bara när namnet är O-Tids eget", () => {
    expect(sheetLayoutName({ id: "a4-two", name: "A4 liggande, två kartor" }, "en")).toBe("A4 landscape, two maps");
    expect(sheetLayoutName({ id: "a4-two", name: "A4 liggande, två kartor" }, "sv")).toBe("A4 liggande, två kartor");
    expect(sheetLayoutName({ id: "a4-two", name: "Klubbens mall" }, "en")).toBe("Klubbens mall");
    expect(sheetLayoutName({ id: "egen", name: "A4, en karta" }, "en")).toBe("A4, en karta");
  });
  it("läget från Purple Pen känns igen på källan, inte på namnet", () => {
    expect(layoutStateName({ name: "Från Purple Pen", source: "PPEN" }, "en")).toBe("From Purple Pen");
    expect(layoutStateName({ name: "From Purple Pen", source: "PPEN" }, "sv")).toBe("Från Purple Pen");
    expect(layoutStateName({ name: "Från Purple Pen" }, "en")).toBe("Från Purple Pen");
    expect(layoutStateName({ name: "Före tryck", source: "PPEN" }, "en")).toBe("Före tryck");
  });
  it("pappret", () => {
    expect(paperName("A4 liggande", "en")).toBe("A4 landscape");
    expect(paperName("A3 stående", "en")).toBe("A3 portrait");
    expect(paperName("100 × 150 mm", "en")).toBe("100 × 150 mm");
    expect(paperName("A4 liggande", "sv")).toBe("A4 liggande");
  });
});
