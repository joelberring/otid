import { describe, expect, it } from "vitest";
import { choiceSettings, cliffChoicesOf, choicesOf, DEFAULT_CHOICES, typedOf } from "./map-project-laser-choices";

describe("enkla val för Karttapullautin", () => {
  it("förvalen ger inga värden; fler branter sänker trösklarna, slätare kurvor höjer utjämningen", () => {
    expect(choiceSettings(DEFAULT_CHOICES)).toEqual({ settings: {}, cliffs: undefined });
    const chosen = choiceSettings({ ...DEFAULT_CHOICES, cliffs: "more", contours: "less", green: "less" });
    expect(chosen.settings).toEqual({ cliff1: 0.95, cliff2: 1.7, smoothing: 1.2, curviness: 0.9, greenscale: 1.5, denseshare: 0.12 });
    expect(chosen.cliffs).toEqual({ minDrop: 1, impassableDrop: 3.5, impassableLength: 20 });
    expect(choiceSettings({ ...DEFAULT_CHOICES, cliffs: "less" }).cliffs).toEqual({ minDrop: 1.8, impassableDrop: 5.5, impassableLength: 20 });
  });

  it("handskrivna värden går före valen, och ett jobb ger tillbaka sina val och sina handskrivna värden", () => {
    const choices = { ...DEFAULT_CHOICES, knolls: "more" as const, cliffs: "less" as const };
    const { settings } = choiceSettings(choices, { cliff1: 1.1, greenhigh: 3 });
    expect(settings).toEqual({ cliff1: 1.1, cliff2: 2.4, knolls: 0.35, knollshare: 0.7, greenhigh: 3 });
    // cliff1 är handskrivet, så branterna stämmer inte längre med «färre» och blir förval; knollarna känns igen.
    expect(choicesOf(settings)).toEqual({ ...DEFAULT_CHOICES, knolls: "more" });
    expect(typedOf(settings, choicesOf(settings), ["cliff1", "cliff2", "knolls", "greenhigh"])).toEqual({ cliff1: "1,1", cliff2: "2,4", greenhigh: "3" });
  });
  it("brantvalen: Gömmarens sätt ger lägre gräns och kortare minsta längd; taggar följer med; kör om läser tillbaka dem", () => {
    expect(choiceSettings(DEFAULT_CHOICES).cliffs).toBeUndefined();
    expect(choiceSettings(DEFAULT_CHOICES, {}, "most").cliffs).toEqual({ minDrop: 1.3, impassableDrop: 3.5, impassableLength: 10 });
    expect(choiceSettings({ ...DEFAULT_CHOICES, cliffs: "less" }, {}, "most", true).cliffs).toEqual({ minDrop: 1.8, impassableDrop: 4.5, impassableLength: 10, tags: true });
    expect(choiceSettings(DEFAULT_CHOICES, {}, "few", true).cliffs).toEqual({ minDrop: 1.3, impassableDrop: 4.5, impassableLength: 20, tags: true });
    expect(cliffChoicesOf(null)).toEqual({ level: "default", style: "few", tags: false });
    expect(cliffChoicesOf({ minDrop: 1, impassableLength: 10, tags: true })).toEqual({ level: "more", style: "most", tags: true });
    // Äldre jobb har ingen minsta längd: de räknas som «few».
    expect(cliffChoicesOf({ minDrop: 1.8 })).toEqual({ level: "less", style: "few", tags: false });
  });
  it("valen för gult, grönt, kullar och berg i dagen blir geo-arbetarens egna trösklar", () => {
    expect(choiceSettings({ ...DEFAULT_CHOICES, open: "more", green: "less", knolls: "more", rock: "more" }).settings)
      .toEqual({ openshare: 0.35, greenscale: 1.5, denseshare: 0.12, knolls: 0.35, knollshare: 0.7, rock: 2 });
    expect(choiceSettings({ ...DEFAULT_CHOICES, rock: "less" }).settings).toEqual({ rock: 0 });
    expect(choicesOf({ openshare: 0.65, rock: 2, knolls: 0.85, knollshare: 0.9 })).toMatchObject({ open: "less", rock: "more", knolls: "less", green: "default" });
  });
});
