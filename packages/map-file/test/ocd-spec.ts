/** Testkartan som OCAD-testerna delar: färger, georeferens, fem symboler och nio objekt (version 12:s layout). */
import { concat, element, ocdCoord, symbolBody, type OcdSpec } from "./ocd-builder";

export const COLORS = [
  { type: 10, value: "Purple\tn0\tv1\tc35.0\tm85.0\ty0.0\tk0.0" },
  { type: 9, value: "Lila\tn54\tc35\tm85\ty0\tk0\to0\tt100\tsPurple\tp100" },
  { type: 9, value: "Svart\tn2\tc0\tm0\ty0\tk100\to1\tt100" },
  { type: 9, value: "Gul 50%\tn34\tm14\ty40\tk0\tt50\tsPurple\tp0\tsOkänd\tp50" }
];

export const GEOREF = { type: 1039, value: "\tm15000.000000\tg50.0000\tr1\tx675000\ty6570000\ta4.90000000\td250.00\te3006\ti13002" };

/** Linje 101.0 med bredd 0,14 mm i färg 2. */
export const contour = { number: 101000, type: 2, body: symbolBody(80, { 796: 2, 798: 14, 800: 1 }) };
/** Punkt 105.100: svart prick, diameter 0,5 mm. */
export const dot = {
  number: 105100, type: 1,
  body: (() => { const el = element(4, 2, 0, 50, [ocdCoord(0, 0)]); return concat(symbolBody(4, { 796: el.length / 8 }), el); })()
};
/** Yta 406.0 med fyllning i färg 34 och raster 90°. */
export const forest = {
  number: 406000, type: 3,
  body: symbolBody(40, { 800: 34, 802: 1, 804: 2, 806: 40, 808: 150, 810: 900 }, view => view.setUint8(814 - 796, 1))
};
/** Text 902.0, 8 pt Arial. */
export const label = {
  number: 902000, type: 4,
  body: symbolBody(60, { 828: 2, 830: 80, 832: 700 }, view => { view.setUint8(0, 5); "Arial".split("").forEach((c, i) => view.setUint8(1 + i, c.charCodeAt(0))); })
};

export const SPEC: OcdSpec = {
  strings: [...COLORS, GEOREF],
  symbols: [contour, dot, forest, label, { number: 999000, type: 9 }],
  objects: [
    // Linje: (0,0) – kurva med styrpunkter (100,0) och (200,100) till (200,200) – (300,200). Enhet 0,01 mm.
    { symbol: 101000, type: 2, coords: [ocdCoord(0, 0), ocdCoord(100, 0, 1), ocdCoord(200, 100, 2), ocdCoord(200, 200), ocdCoord(300, 200)] },
    { symbol: 105100, type: 1, angle: 900, coords: [ocdCoord(500, 600)] },
    // Yta 10×10 mm med ett hål 2×2 mm.
    {
      symbol: 406000, type: 3, coords: [
        ocdCoord(0, 0), ocdCoord(1000, 0), ocdCoord(1000, 1000), ocdCoord(0, 1000),
        ocdCoord(200, 200, 0, 2), ocdCoord(400, 200), ocdCoord(400, 400)
      ]
    },
    { symbol: 902000, type: 4, coords: [ocdCoord(10, 20)], text: "Djurgården\r\nnorra" },
    { symbol: 101000, type: 2, status: 2, coords: [ocdCoord(0, 0), ocdCoord(1, 1)] },
    { symbol: 101000, type: 2, status: 3, coords: [ocdCoord(0, 0), ocdCoord(1, 1)] },
    { symbol: -2, type: 3, coords: [ocdCoord(0, 0), ocdCoord(1, 1), ocdCoord(1, 0)] },
    { symbol: 555000, type: 2, coords: [ocdCoord(0, 0), ocdCoord(1, 1)] },
    { symbol: 101000, type: 9, coords: [ocdCoord(0, 0)] }
  ]
};

