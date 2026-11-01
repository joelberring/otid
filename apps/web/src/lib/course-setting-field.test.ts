import { describe, expect, it } from "vitest";
import { symbolsForBox, type CourseSettingDocument } from "@o-tid/course-setting";
import { clearBackup, G_CHOICES, gChoiceOf, gSymbolId, readBackup, withFieldDescription, writeBackup } from "./course-setting-field";

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

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); }, map };
}

describe("osparade ändringar i webbläsaren", () => {
  const document = { courses: [], controls: {} } as unknown as CourseSettingDocument;

  it("skrivs, läses och tas bort per tävling", () => {
    const storage = memoryStorage();
    expect(writeBackup(storage, "a", { baseVersion: 3, savedAt: "2026-11-01T12:00:00Z", document })).toBe(true);
    expect(readBackup(storage, "a")).toEqual({ formatVersion: 1, baseVersion: 3, savedAt: "2026-11-01T12:00:00Z", document });
    expect(readBackup(storage, "b")).toBeUndefined();
    clearBackup(storage, "a");
    expect(readBackup(storage, "a")).toBeUndefined();
  });

  it("trasig eller blockerad lagring fäller inget", () => {
    const storage = memoryStorage();
    storage.map.set("otid:course-setting-unsaved:a", "{inte json");
    expect(readBackup(storage, "a")).toBeUndefined();
    const blocked = { getItem: () => { throw new Error("blockerad"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("x"); } };
    expect(readBackup(blocked, "a")).toBeUndefined();
    expect(writeBackup(blocked, "a", { baseVersion: 1, savedAt: "x", document })).toBe(false);
    expect(() => clearBackup(blocked, "a")).not.toThrow();
    expect(writeBackup(undefined, "a", { baseVersion: 1, savedAt: "x", document })).toBe(false);
  });
});
