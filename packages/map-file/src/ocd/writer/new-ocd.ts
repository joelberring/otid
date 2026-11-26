/**
 * Etapp 5B (OCAD Steg 3): skapar en helt ny OCAD 12-kompatibel `.ocd`-fil direkt ur O-Tids `SymbolDef`-tabeller
 * (`ISOM 2017-2` 1:15 000 / 1:10 000 och `ISSprOM 2019-2` 1:4 000 / 1:3 000) — öppningsbar i OCAD 12, 2018, 2019, 2020+.
 *
 * Bygger dynamiskt ovanpå `SYMBOL_SETS` och `gridConvergenceDegrees` i `template/new-map.ts`, så alla mallförbättringar
 * ärvs automatiskt. 100 % clean-room-kod utan GPL/AGPL.
 */
import { gridConvergenceDegrees, NewMapError, SYMBOL_SETS, type NewMapOptions } from "../../template/new-map";
import type { SymbolSetDef } from "../../template/symbol-def";
import { HEADER, OCD_MARK, VARIANT_V12 } from "../layout";
import { applyOcdColors, documentColors, updateOcdScalePar, type OcdColorAdd } from "./ocd-colors-write";
import { encodeOcdString, HEADER_V12_SIZE, type OcdDocument, type RawOcdString } from "./ocd-document";
import { packOcdDocument } from "./ocd-pack";
import { allocateHelperBorderNumber, allocateOcdSymbolNumber, encodeOcdSymbol, symbolDefToMapSymbol } from "./ocd-symbols-encode";

/** OCAD parametersträngtyper för visning, utskrift och vy (kontrollerade mot OCAD 12/2018-filer). */
export const DISPLAY_STRING_TYPE = {
  displayPar: 1024,
  printPar: 1026,
  viewPar: 1030
} as const;

const SWEREF99TM = 3006;

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Skapar ett rent, tomt OCAD 12.0 `OcdDocument` med 60-byte `TFileHeader` (`OCD_MARK = 0x0cad`, `fileType = 0`, `version = 12`). */
export function createEmptyOcdV12Document(): OcdDocument {
  const header = new Uint8Array(HEADER_V12_SIZE);
  const view = new DataView(header.buffer);
  view.setUint16(HEADER.mark, OCD_MARK, true);
  view.setUint16(HEADER.fileType, 0, true);
  view.setUint16(HEADER.version, 12, true);
  view.setUint8(HEADER.subversion, 0);
  view.setUint8(HEADER.subsubversion, 0);
  view.setInt32(HEADER.offlineSyncSerial, 0, true);
  return {
    version: 12,
    subversion: 0,
    variant: VARIANT_V12,
    header,
    fileNameBytes: null,
    infoBytes: null,
    symbols: [],
    objects: [],
    strings: [],
    nextObjectKey: 1
  };
}

/**
 * Lägger till minimala `si_DisplayPar` (1024), `si_PrintPar` (1026) och `si_ViewPar` (1030) så att OCAD öppnar kartan
 * centrerad på `(centerX, centerY)` i skarpt normalläge direkt.
 */
export function appendDefaultOcdViewStrings(
  doc: OcdDocument,
  options: { readonly scale: number; readonly centerX?: number; readonly centerY?: number; readonly zoom?: number }
): void {
  const cx = Number.isFinite(options.centerX) ? options.centerX! : 0;
  const cy = Number.isFinite(options.centerY) ? options.centerY! : 0;
  const zoom = Number.isFinite(options.zoom) && options.zoom! > 0 ? options.zoom! : 4;
  const scale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 10000;

  // Layout bekräftad mot OCAD 12/2018-filer: vertikal symbolpalett, utskrift hela kartan (r0) och skarp anti-aliased vy (v2, m100, d0).
  const displayPar = "\ts6\tg-1\th27\tv160\tt0\tzVERT";
  const printPar = `\ta${scale.toFixed(2)}\tl0\tc0\tr0\ti100\tw100\tg0\td36`;
  const viewPar = `\tx${cx.toFixed(6)}\ty${cy.toFixed(6)}\tz${zoom.toFixed(6)}\tv2\tm100\tt100\tb50\tc50\th0\tk0\tp0\td0\ti0\tl0`;

  const entries: RawOcdString[] = [
    { recType: DISPLAY_STRING_TYPE.displayPar, raw: encodeOcdString(displayPar, doc.version), objKey: null },
    { recType: DISPLAY_STRING_TYPE.printPar, raw: encodeOcdString(printPar, doc.version), objKey: null },
    { recType: DISPLAY_STRING_TYPE.viewPar, raw: encodeOcdString(viewPar, doc.version), objKey: null }
  ];
  doc.strings.push(...entries);
}

/**
 * Skapar en helt ny OCAD 12-kompatibel `.ocd`-karta ur O-Tids symbolset (`ISOM2017-2` eller `ISSPROM2019-2`),
 * med full färgtabell i exakt IOF-ordning, georeferens i SWEREF 99 TM (`e3006`, `i13002`), missvisning/grivation,
 * minimala visnings-/utskriftssträngar samt alla normsymboler (inkl. automatiska dolda `BorderSym`-linjer för kantade ytor).
 */
export function newOcdFile(options: NewMapOptions): Uint8Array {
  const set: SymbolSetDef = SYMBOL_SETS[options.symbolSet];
  const scaleEntry = set.scales.find(entry => entry.scale === options.scale);
  if (!scaleEntry) throw new NewMapError("SCALE", `${set.name} har inte skalan 1:${options.scale}`);
  const { easting, northing } = options.refPoint;
  if (
    !Number.isFinite(easting) || !Number.isFinite(northing)
    || easting < 100_000 || easting > 1_000_000 || northing < 6_000_000 || northing > 7_800_000
  ) {
    throw new NewMapError("POINT", "Referenspunkten ligger inte i Sverige (SWEREF 99 TM)");
  }

  const doc = createEmptyOcdV12Document();

  // 1. Komplett färgtabell (`si_Color`, typ 9) i exakt IOF-ordning (rank 0 först). ID 1..N (0 reserverat för tomma Colors-platser).
  const colorKeyToId = new Map<string, number>();
  const colorAdds: OcdColorAdd[] = set.colors.map((color, index) => {
    const id = index + 1;
    colorKeyToId.set(color.key, id);
    const [c, m, y, k] = color.cmyk;
    return { kind: "add", id, name: color.name, cmyk: { c, m, y, k }, overprint: false, opacity: 1 };
  });
  applyOcdColors(doc, colorAdds);

  // 2. Georeferens (`si_ScalePar`, typ 1039): SWEREF 99 TM (e3006, i13002), referenspunkt och grivation (samma formel som newMapFile).
  const declination = options.declinationDegrees ?? 0;
  const grivation = round(declination - gridConvergenceDegrees(options.refPoint), 2);
  updateOcdScalePar(
    doc,
    {
      scale: options.scale,
      crs: { kind: "EPSG", code: SWEREF99TM },
      refPoint: { easting: round(easting, 2), northing: round(northing, 2) },
      mapRefPoint: { x: 0, y: 0 },
      grivationDegrees: grivation,
      combinedScaleFactor: 1
    },
    options.scale
  );

  // 3. Minimala visnings-, vy- och utskriftssträngar (1024/1026/1030).
  appendDefaultOcdViewStrings(doc, { scale: options.scale, centerX: 0, centerY: 0, zoom: 4 });

  // 4. Alla `SymbolDef` som OCAD v12-symbolposter + automatiska dolda `BorderSym`-linjer för kantade ytor.
  const colors = documentColors(doc);
  for (const def of set.symbols) {
    const symNum = allocateOcdSymbolNumber(doc, def.code);
    const { symbol, rotatable, staggered, borderLine } = symbolDefToMapSymbol(def, symNum, scaleEntry.factor, colorKeyToId);
    let borderSymNumber: number | undefined;
    if (borderLine) {
      borderSymNumber = allocateHelperBorderNumber(doc, symNum);
      const encodedBorder = encodeOcdSymbol(
        { ...borderLine, id: String(borderSymNumber) },
        { number: borderSymNumber, variant: doc.variant, colors, status: 2 }
      );
      doc.symbols.push(encodedBorder);
    }
    const encoded = encodeOcdSymbol(symbol, {
      number: symNum,
      variant: doc.variant,
      colors,
      rotatable,
      staggered,
      borderSymbolNumber: borderSymNumber
    });
    doc.symbols.push(encoded);
  }

  return packOcdDocument(doc).bytes;
}
