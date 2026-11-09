import { describe, expect, it } from "vitest";
import { backLines, backValues } from "./map-back-lines";

const clock = (instant: string | null) => instant ? instant.slice(11, 16) : "";
describe("baksidan ur banläggningen", () => {
  it("fyller i löparens variabler och hoppar över tomma rader", () => {
    const texts = [{ text: "{startnummer}", sizeMm: 18, bold: true, align: "right" as const }, { text: "{namn}", sizeMm: 8, bold: true, align: "right" as const },
      { text: "{klubb}", sizeMm: 5, bold: false, align: "right" as const }, { text: "{starttid}", sizeMm: 5, bold: false, align: "right" as const }];
    const runner = backValues({ kind: "RUNNER", courseName: "Lång", variantCode: "ACEG", item: { kind: "RUNNER", number: 3, entryId: "e", name: "Erik Eklöv",
      club: null, className: "Hyperion herr", startTime: "2026-12-09T18:31:00Z" } }, clock);
    expect(backLines(texts, runner).map(line => line.line)).toEqual(["3", "Erik Eklöv", "18:31"]);
    // Varianten står bara där baksidan har {variant}.
    expect(backLines([{ text: "{variant} · {klass}", sizeMm: 5, bold: false, align: "left" }], runner)[0]!.line).toBe("ACEG · Hyperion herr");
    const reserve = backValues({ kind: "RESERVE", courseName: "Lång", variantCode: "B", index: 0 }, clock);
    expect(backLines(texts, reserve).map(line => line.line)).toEqual(["Reserv"]);
  });
});
