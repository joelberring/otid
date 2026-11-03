import { describe, expect, it } from "vitest";
import type { CourseForking } from "@o-tid/domain";
import { planForkingSave } from "../src/course-forking";

/** ADR-0198: tävlingens baneditor tar aldrig tillbaka varianter som banläggningen valt bort. */
const forking: CourseForking = { items: [{ kind: "CONTROL", code: 31 }, { kind: "FORK", branches: [[41], [42]] },
  { kind: "FORK", branches: [[43], [44]] }, { kind: "CONTROL", code: 32 }] };
const current = [{ code: "AC", controlCodes: [31, 41, 43, 32] }, { code: "AD", controlCodes: [31, 41, 44, 32] },
  { code: "BC", controlCodes: [31, 42, 43, 32] }];
const bd = { code: "BD", controlCodes: [31, 42, 44, 32] };

describe("planForkingSave med bortvalda varianter", () => {
  it("en struktur som ger en bortvald variant sparar den inte", () => {
    const plan = planForkingSave(current, forking, [bd])!;
    expect(plan.variants.map(variant => variant.code)).toEqual(["AC", "AD", "BC"]);
    expect(plan.excludedCodes).toEqual(["BD"]);
    expect(plan.staleExcludedCodes).toEqual([]);
    expect(plan.removedCodes).toEqual([]);
    // Utan bortval kommer BD med.
    expect(planForkingSave(current, forking)!.variants.map(variant => variant.code)).toEqual(["AC", "AD", "BC", "BD"]);
  });

  it("ett bortval som inte längre stämmer (andra kontroller) sägs och gäller inte", () => {
    const changed: CourseForking = { items: [{ kind: "CONTROL", code: 31 }, { kind: "FORK", branches: [[41], [42]] },
      { kind: "FORK", branches: [[43], [45]] }, { kind: "CONTROL", code: 32 }] };
    const plan = planForkingSave(current, changed, [bd])!;
    expect(plan.variants.map(variant => variant.code)).toEqual(["AC", "AD", "BC", "BD"]);
    expect(plan.excludedCodes).toEqual([]);
    expect(plan.staleExcludedCodes).toEqual(["BD"]);
  });

  it("minst en variant blir kvar; en struktur utan gafflingar gör alla bortval inaktuella", () => {
    const all = ["AC", "AD", "BC", "BD"].map(code => ({ code, controlCodes: [31, code[0] === "A" ? 41 : 42, code[1] === "C" ? 43 : 44, 32] }));
    expect(planForkingSave(current, forking, all)!.variants).toHaveLength(4);
    const plain = planForkingSave(current, { items: [{ kind: "CONTROL", code: 31 }, { kind: "CONTROL", code: 32 }] }, [bd])!;
    expect(plain.staleExcludedCodes).toEqual(["BD"]);
  });
});
