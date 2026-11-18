import { describe, expect, it } from "vitest";
import { hiddenByDefault, hiddenLayers, loadOrder, withChoices } from "./map-project-layer-visibility";

/** Ägaren 2026-11-19: alla underlag är släckta från början, egna val gäller, det som visas hämtas först och de släckta bara på begäran. */
describe("underlagens synlighet och hämtordning", () => {
  const layers = [{ layerId: "karta", name: "Karttapullautin hela kartan", sort: 0 }, { layerId: "djup", name: "Karttapullautin hela kartan – fuktdjup", sort: 1 },
    { layerId: "skugga", name: "Karttapullautin hela kartan – etapp 2 av 3 – terrängskuggning", sort: 2 }, { layerId: "berg", name: "Karttapullautin hela kartan – etapp 2 av 3 – berg", sort: 3 }];
  it("släcker alla underlag från början, också ortofoto och terrängskuggning", () => {
    expect(hiddenByDefault()).toBe(true);
    expect([...hiddenLayers(layers, {})].sort()).toEqual(["berg", "djup", "karta", "skugga"]);
  });
  it("låter egna val gå före förvalet och glömmer val för underlag som tagits bort", () => {
    const choices = withChoices({ borta: false }, ["djup", "karta"], true, layers.map(layer => layer.layerId));
    expect(choices).toEqual({ djup: true, karta: true });
    expect([...hiddenLayers(layers, withChoices(choices, ["karta"], false, layers.map(layer => layer.layerId)))].sort()).toEqual(["berg", "karta", "skugga"]);
  });
  it("hämtar det som visas först, det översta först, och de släckta sist", () => {
    const shown = hiddenLayers(layers, { karta: true, skugga: true });
    expect(loadOrder(layers, shown).map(layer => layer.layerId)).toEqual(["skugga", "karta", "berg", "djup"]);
  });
  it("hämtar inte de släckta förrän de behövs", () => {
    expect(loadOrder(layers, hiddenLayers(layers, { karta: true }), false).map(layer => layer.layerId)).toEqual(["karta"]);
    expect(loadOrder(layers, hiddenLayers(layers, {}), false)).toEqual([]);
  });
});
