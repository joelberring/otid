import { describe, expect, it } from "vitest";
import { hiddenByDefault, hiddenLayers, loadOrder, withChoices } from "./map-project-layer-visibility";

/** Ägaren 2026-11-14: reglagens bilder är släckta från början, egna val gäller, och det som visas hämtas först. */
describe("underlagens synlighet och hämtordning", () => {
  const layers = [{ layerId: "karta", name: "Karttapullautin hela kartan", sort: 0 }, { layerId: "djup", name: "Karttapullautin hela kartan – fuktdjup", sort: 1 },
    { layerId: "skugga", name: "Karttapullautin hela kartan – etapp 2 av 3 – terrängskuggning", sort: 2 }, { layerId: "berg", name: "Karttapullautin hela kartan – etapp 2 av 3 – berg", sort: 3 }];
  it("släcker reglagens bilder från början, också i en etapp", () => {
    expect(["Laser – fuktdjup", "Laser – vegetationsklasser", "Laser – etapp 1 av 2 – berg", "Laser – fuktighet", "Laser – relief", "Ortofoto 2024", "berg"].map(hiddenByDefault))
      .toEqual([true, true, true, false, false, false, false]);
    expect([...hiddenLayers(layers, {})]).toEqual(["djup", "berg"]);
  });
  it("låter egna val gå före förvalet och glömmer val för underlag som tagits bort", () => {
    const choices = withChoices({ borta: false }, ["djup", "karta"], true, layers.map(layer => layer.layerId));
    expect(choices).toEqual({ djup: true, karta: true });
    expect([...hiddenLayers(layers, withChoices(choices, ["karta"], false, layers.map(layer => layer.layerId)))]).toEqual(["karta", "berg"]);
  });
  it("hämtar det som visas först, det översta först, och de släckta sist", () => {
    expect(loadOrder(layers, hiddenLayers(layers, {})).map(layer => layer.layerId)).toEqual(["skugga", "karta", "berg", "djup"]);
  });
});
