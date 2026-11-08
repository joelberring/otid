import { ISOM_COLORS, ISOM_SYMBOLS } from "./isom-2017-2";
import { stroke, type SymbolDef, type SymbolSetDef } from "./symbol-def";

/**
 * ADR-0219 (K1): O-Tids symbolset efter ISSprOM 2019-2 (sprintkartor), mått i mm vid 1:4 000; 1:3 000 använder samma mått
 * (normens regel). Bygger på skogsnormens symboler med sprintnormens skillnader: grövre murar och oöverstigliga linjer,
 * byggnad med kantlinje, trappor och broar. Ska kontrolleras mot normen före skarpt tryck.
 */
const tick = (width: number, length: number) => [stroke("black", width, [0, length / 2], [0, -length / 2])];

const OVERRIDES: readonly SymbolDef[] = [
  { code: "103", name: "Hjälpkurva", kind: "line", color: "brown", width: 0.14, dash: [2.5, 0.25] },
  { code: "513", name: "Mur", kind: "line", color: "black", width: 0.25 },
  { code: "515", name: "Oöverstiglig mur", kind: "line", color: "black", width: 0.6 },
  { code: "518", name: "Oöverstigligt staket", kind: "line", color: "black", width: 0.6 },
  { code: "529", name: "Speciellt oöverstigligt linjeföremål", kind: "line", color: "black", width: 0.6 }
];

const ADDITIONS: readonly SymbolDef[] = [
  { code: "512.1", name: "Bro", kind: "line", color: "black", width: 0.14, border: { color: "black", width: 0.14 } },
  { code: "512.2", name: "Gångbro", kind: "line", color: "black", width: 0.25 },
  { code: "532", name: "Trappa", kind: "line", color: "black", width: 0.14, mid: { elements: tick(0.14, 1.0), spacing: 0.5 } }
];

/** Skogssymboler som inte finns i sprintnormen. */
const NOT_IN_SPRINT = new Set(["202.1", "411", "508", "601.1"]);

export const ISSPROM_2019_2: SymbolSetDef = {
  id: "ISSPROM2019-2",
  name: "ISSprOM 2019-2",
  scales: [{ scale: 4000, factor: 1 }, { scale: 3000, factor: 1 }],
  colors: ISOM_COLORS,
  symbols: [
    ...ISOM_SYMBOLS.filter(symbol => !NOT_IN_SPRINT.has(symbol.code))
      .map(symbol => OVERRIDES.find(override => override.code === symbol.code) ?? symbol),
    ...ADDITIONS
  ].sort((a, b) => Number(a.code) - Number(b.code))
};
