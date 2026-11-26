/**
 * Etapp 5B (OCAD Steg 3): konverterar valfri inläst `ParsedMap` (t.ex. från `.omap`/`.xmap`) till en giltig
 * OCAD 12 `.ocd`-fil + strukturerad formatgapsrapport (`MapConversionReport`). 100 % clean-room-kod.
 */
import { normalizeAngle, openRing } from "../../geometry";
import type {
  AreaSymbol, CombinedSymbol, LineSymbol, MapColor, MapGeoreference, MapObject, MapSymbol, ParsedMap, Path, PathCommand,
  Point, PointElement, StrokeStyle
} from "../../model";
import { OBJECT_TYPE, STATUS_NORMAL } from "../layout";
import { ConversionWarningCollector, type ConvertMapResult } from "./convert-report";
import { appendDefaultOcdViewStrings, createEmptyOcdV12Document } from "./new-ocd";
import { applyOcdColors, documentColors, updateOcdScalePar, type OcdColorAdd } from "./ocd-colors-write";
import { OBJ_INDEX, OBJ_STATUS, type RawOcdObject } from "./ocd-document";
import { packOcdDocument } from "./ocd-pack";
import {
  angleUnits, buildOcdObjectRecord, clampOcd, computeOcdObjectRect, encodeOcdTextBytes, MAX_TEXT_WORDS,
  OCD_COORD_LIMIT, symbolPrimaryColor, textBoxPoints, V12_OBJ, type RawPt
} from "./ocd-record";
import { allocateHelperBorderNumber, allocateOcdSymbolNumber, encodeOcdSymbol, parseOcdSymbolNumber } from "./ocd-symbols-encode";

export interface ConvertToOcdOptions {
  /** Valfri ISO-tidsstämpel för OCAD v12 `CreationDate`/`ModificationDate`. */
  readonly at?: string | undefined;
  /** Antal `<part>` i en Mapper-källfil (om `> 1` läggs formatgapsvarningen `MULTIPLE_PARTS_MERGED` till). */
  readonly sourcePartCount?: number | undefined;
}

interface MappedTarget {
  readonly ocdNumber: number;
  readonly symbol: MapSymbol;
  /** För sammansatta symboler där en yta också ska rita en separat linjedel: omvandla ytans ringar till slutna linjer. */
  readonly areaToClosedLine?: boolean;
}

const GAP_X = (gap: number) => ((gap & 1) !== 0 ? 8 : 0) | ((gap & 2) !== 0 ? 4 : 0);
const GAP_Y = (gap: number) => ((gap & 4) !== 0 ? 4 : 0);

function remapPointElement(el: PointElement, colorMap: ReadonlyMap<number, number>): PointElement {
  const color = colorMap.get(el.color) ?? el.color;
  return { ...el, color };
}

function remapStrokes(strokes: readonly StrokeStyle[], colorMap: ReadonlyMap<number, number>): StrokeStyle[] {
  return strokes.map(s => ({ ...s, color: colorMap.get(s.color) ?? s.color }));
}

function remapSymbolColors(symbol: MapSymbol, colorMap: ReadonlyMap<number, number>): MapSymbol {
  const col = (id: number) => colorMap.get(id) ?? id;
  switch (symbol.kind) {
    case "POINT":
      return { ...symbol, elements: symbol.elements.map(el => remapPointElement(el, colorMap)) };
    case "LINE":
      return {
        ...symbol,
        strokes: remapStrokes(symbol.strokes, colorMap),
        ...(symbol.repeated ? { repeated: { ...symbol.repeated, elements: symbol.repeated.elements.map(el => remapPointElement(el, colorMap)) } } : {}),
        ...(symbol.between ? { between: { ...symbol.between, elements: symbol.between.elements.map(el => remapPointElement(el, colorMap)) } } : {}),
        ...(symbol.corner ? { corner: { ...symbol.corner, elements: symbol.corner.elements.map(el => remapPointElement(el, colorMap)) } } : {}),
        ...(symbol.start ? { start: { elements: symbol.start.elements.map(el => remapPointElement(el, colorMap)) } } : {}),
        ...(symbol.end ? { end: { elements: symbol.end.elements.map(el => remapPointElement(el, colorMap)) } } : {})
      };
    case "AREA":
      return {
        ...symbol,
        ...(symbol.fill !== undefined ? { fill: col(symbol.fill) } : {}),
        hatches: symbol.hatches.map(h => ({ ...h, color: col(h.color) })),
        ...(symbol.pattern ? { pattern: { ...symbol.pattern, elements: symbol.pattern.elements.map(el => remapPointElement(el, colorMap)) } } : {}),
        ...(symbol.border ? { border: remapStrokes(symbol.border, colorMap) } : {}),
        ...(symbol.borderDecorations
          ? {
              borderDecorations: {
                ...(symbol.borderDecorations.repeated ? { repeated: { ...symbol.borderDecorations.repeated, elements: symbol.borderDecorations.repeated.elements.map(el => remapPointElement(el, colorMap)) } } : {}),
                ...(symbol.borderDecorations.between ? { between: { ...symbol.borderDecorations.between, elements: symbol.borderDecorations.between.elements.map(el => remapPointElement(el, colorMap)) } } : {}),
                ...(symbol.borderDecorations.corner ? { corner: { ...symbol.borderDecorations.corner, elements: symbol.borderDecorations.corner.elements.map(el => remapPointElement(el, colorMap)) } } : {}),
                ...(symbol.borderDecorations.start ? { start: { elements: symbol.borderDecorations.start.elements.map(el => remapPointElement(el, colorMap)) } } : {}),
                ...(symbol.borderDecorations.end ? { end: { elements: symbol.borderDecorations.end.elements.map(el => remapPointElement(el, colorMap)) } } : {})
              }
            }
          : {})
      };
    case "TEXT":
      return {
        ...symbol,
        color: col(symbol.color),
        ...(symbol.framing ? { framing: { ...symbol.framing, color: col(symbol.framing.color) } } : {})
      };
    case "COMBINED":
      return symbol;
  }
}

/** Plockar ut alla bladsymboler ur en (möjligen nästlad) `COMBINED`-symbol. */
function flattenCombinedParts(
  combined: CombinedSymbol,
  symbols: ReadonlyMap<string, MapSymbol>,
  depth = 0
): Exclude<MapSymbol, CombinedSymbol>[] {
  if (depth >= 8) return [];
  const out: Exclude<MapSymbol, CombinedSymbol>[] = [];
  for (const partId of combined.parts) {
    const part = symbols.get(partId);
    if (!part) continue;
    if (part.kind === "COMBINED") out.push(...flattenCombinedParts(part, symbols, depth + 1));
    else out.push(part);
  }
  return out;
}

/** Kontrollerar om två rasterlinjer kan rymmas i samma OCAD `TAreaSym` (`hatchMode = 2`: samma färg, bredd, avstånd). */
function compatibleSecondHatch(a: AreaSymbol["hatches"][number], b: AreaSymbol["hatches"][number]): boolean {
  return a.color === b.color && Math.abs(a.width - b.width) < 0.005 && Math.abs(a.spacing - b.spacing) < 0.005;
}

function splitPathSubparts(path: Path): Path[] {
  const parts: Path[] = [];
  let current: PathCommand[] = [];
  for (const cmd of path) {
    if (cmd.type === "M" && current.length > 0) {
      if (current.length > 1) parts.push(current);
      current = [];
    }
    current.push(cmd);
  }
  if (current.length > 1) parts.push(current);
  return parts;
}

function closeRingAsLinePath(ring: Path): Path {
  const opened = openRing(ring);
  const first = opened[0];
  if (!first || opened.length < 2) return opened;
  return [...opened, { type: "L", x: first.x, y: first.y }];
}

/**
 * Konverterar valfri `ParsedMap` till en giltig OCAD 12 `.ocd`-fil + `MapConversionReport`.
 * Hanterar färger (inkl. dekorfärger och övertryck), symboler (inkl. `COMBINED` → `BorderSym` eller delade objekt),
 * georeferens (inkl. `mapRefPoint`-skift till `(0,0)`), kurvor, hål, styrpunkter och texter.
 */
export function convertMapToOcd(map: ParsedMap, options: ConvertToOcdOptions = {}): ConvertMapResult {
  const warnings = new ConversionWarningCollector();
  const at = options.at ?? new Date().toISOString();
  const doc = createEmptyOcdV12Document();

  if (options.sourcePartCount !== undefined && options.sourcePartCount > 1) {
    warnings.add("MULTIPLE_PARTS_MERGED", options.sourcePartCount);
  }

  // 1. Färgtabell i exakt rangordning (rank 0 överst). Stabila positiva OCAD-färgnummer (`>= 1`).
  const sortedColors = [...map.colors].sort((a, b) => a.rank - b.rank);
  const colorIdMap = new Map<number, number>();
  const usedColorIds = new Set<number>();
  let nextFreeColorId = 1;
  const colorAdds: OcdColorAdd[] = [];
  for (const color of sortedColors) {
    let ocdId: number;
    if (Number.isInteger(color.id) && color.id >= 1 && color.id <= 32767 && !usedColorIds.has(color.id)) {
      ocdId = color.id;
    } else {
      while (usedColorIds.has(nextFreeColorId)) nextFreeColorId += 1;
      ocdId = nextFreeColorId++;
    }
    usedColorIds.add(ocdId);
    colorIdMap.set(color.id, ocdId);
    colorAdds.push({
      kind: "add",
      id: ocdId,
      name: color.name,
      cmyk: color.cmyk,
      overprint: color.overprint,
      opacity: color.opacity,
      spot: color.spot
    });
  }
  if (colorAdds.length > 0) applyOcdColors(doc, colorAdds);
  const ocdColors: MapColor[] = documentColors(doc);

  // 2. Georeferens: OCAD har alltid mapRefPoint = (0, 0). Om källan har offset förskjuts objektkoordinaterna motsvarande.
  let shiftX = 0;
  let shiftY = 0;
  let adjustedGeoref: MapGeoreference | null = null;
  if (map.georeference) {
    const g = map.georeference;
    if (Math.abs(g.mapRefPoint.x) > 1e-6 || Math.abs(g.mapRefPoint.y) > 1e-6) {
      shiftX = -g.mapRefPoint.x;
      shiftY = -g.mapRefPoint.y;
      warnings.add("MAP_REF_SHIFTED", 1);
    }
    if (Math.abs(g.combinedScaleFactor - 1) > 1e-6) {
      warnings.add("AUXILIARY_SCALE_FACTOR", 1);
    }
    if (g.crs.kind === "UNKNOWN") {
      warnings.add("CRS_UNKNOWN", 1);
    }
    adjustedGeoref = { ...g, mapRefPoint: { x: 0, y: 0 }, combinedScaleFactor: 1 };
  }
  updateOcdScalePar(doc, adjustedGeoref, map.scale);

  // 3. Symboler: identifiera privata Mapper-subsymboler som bara ingår i COMBINED så de inte dubbleras som toppsymboler.
  const privateSubIds = new Set<string>();
  const directObjectSymIds = new Set(map.objects.map(obj => obj.symbol));
  for (const sym of map.symbols.values()) {
    if (sym.kind !== "COMBINED") continue;
    for (const partId of sym.parts) {
      if (partId.startsWith(`${sym.id}.`) && !directObjectSymIds.has(partId)) {
        privateSubIds.add(partId);
      }
    }
  }

  const encodeAndAddSymbol = (
    sym: Exclude<MapSymbol, CombinedSymbol>,
    preferredCode: string,
    statusOverride?: number
  ): { ocdNumber: number; encodedSymbol: MapSymbol } => {
    const remapped = remapSymbolColors(sym, colorIdMap) as Exclude<MapSymbol, CombinedSymbol>;
    const desired = parseOcdSymbolNumber(preferredCode);
    const taken = new Set(doc.symbols.map(s => s.number));
    const ocdNumber = allocateOcdSymbolNumber(doc, preferredCode);
    if (desired === null && sym.code.main > 0) warnings.add("SYMBOL_CODE_REMAPPED", 1);
    else if (desired !== null && taken.has(desired)) warnings.add("SYMBOL_CODE_REMAPPED", 1);

    let normalized: Exclude<MapSymbol, CombinedSymbol> = remapped;
    let borderSymNumber: number | undefined;

    if (normalized.kind === "AREA") {
      // Kontrollera hatch-begränsning i OCAD (max 2 vinklar med identisk färg/bredd/avstånd).
      if (normalized.hatches.length > 2 || (normalized.hatches.length === 2 && !compatibleSecondHatch(normalized.hatches[0]!, normalized.hatches[1]!))) {
        warnings.add("MULTIPLE_HATCHES_TRUNCATED", 1);
        const kept = normalized.hatches.length >= 2 && compatibleSecondHatch(normalized.hatches[0]!, normalized.hatches[1]!)
          ? normalized.hatches.slice(0, 2)
          : normalized.hatches.slice(0, 1);
        normalized = { ...normalized, hatches: kept };
      }
      if (normalized.border && normalized.border.length > 0) {
        borderSymNumber = allocateHelperBorderNumber(doc, ocdNumber);
        const helperLine: LineSymbol = {
          id: String(borderSymNumber),
          code: { text: `${Math.floor(borderSymNumber / 1000)}.${borderSymNumber % 1000}`, main: Math.floor(borderSymNumber / 1000), sub: borderSymNumber % 1000 },
          name: `${normalized.name || preferredCode} (kant)`,
          hidden: true,
          kind: "LINE",
          strokes: normalized.border,
          ...(normalized.borderDecorations ?? {})
        };
        doc.symbols.push(encodeOcdSymbol(helperLine, { number: borderSymNumber, variant: doc.variant, colors: ocdColors, status: 2 }));
      }
    }

    const encoded = encodeOcdSymbol(normalized, {
      number: ocdNumber,
      variant: doc.variant,
      colors: ocdColors,
      status: statusOverride ?? (normalized.hidden ? 2 : 0),
      rotatable: normalized.kind === "POINT" || normalized.kind === "TEXT",
      borderSymbolNumber: borderSymNumber
    });
    doc.symbols.push(encoded);
    return { ocdNumber, encodedSymbol: normalized };
  };

  const symbolTargets = new Map<string, MappedTarget[]>();

  // Pass A: vanliga symboler (icke-COMBINED, ej privata subsymboler).
  for (const sym of map.symbols.values()) {
    if (sym.kind === "COMBINED" || privateSubIds.has(sym.id)) continue;
    const codeStr = sym.code.main > 0 ? (sym.code.sub ? `${sym.code.main}.${sym.code.sub}` : String(sym.code.main)) : "999";
    const { ocdNumber, encodedSymbol } = encodeAndAddSymbol(sym, codeStr);
    symbolTargets.set(sym.id, [{ ocdNumber, symbol: encodedSymbol }]);
  }

  // Pass B: COMBINED-symboler (yta + kantlinje → inbyggd BorderSym; övriga → delade symboler/objekt).
  for (const sym of map.symbols.values()) {
    if (sym.kind !== "COMBINED") continue;
    const leaves = flattenCombinedParts(sym, map.symbols);
    if (leaves.length === 0) {
      warnings.add("COMBINED_UNSUPPORTED", 1);
      continue;
    }
    const codeStr = sym.code.main > 0 ? (sym.code.sub ? `${sym.code.main}.${sym.code.sub}` : String(sym.code.main)) : "999";
    const areaParts = leaves.filter((leaf): leaf is AreaSymbol => leaf.kind === "AREA");
    const lineParts = leaves.filter((leaf): leaf is LineSymbol => leaf.kind === "LINE");

    // Optimalt fall: exakt 1 ytdel (utan egen kant) + 1 linjedel → en enda OCAD TAreaSym med BorderSym!
    if (leaves.length === 2 && areaParts.length === 1 && lineParts.length === 1 && !areaParts[0]!.border?.length) {
      const areaLeaf = areaParts[0]!;
      const lineLeaf = lineParts[0]!;
      const hasDec = Boolean(lineLeaf.repeated || lineLeaf.between || lineLeaf.corner || lineLeaf.start || lineLeaf.end);
      const mergedArea: AreaSymbol = {
        ...areaLeaf,
        id: sym.id,
        code: sym.code,
        name: sym.name || areaLeaf.name,
        hidden: sym.hidden,
        border: lineLeaf.strokes,
        ...(hasDec
          ? {
              borderDecorations: {
                ...(lineLeaf.repeated ? { repeated: lineLeaf.repeated } : {}),
                ...(lineLeaf.between ? { between: lineLeaf.between } : {}),
                ...(lineLeaf.corner ? { corner: lineLeaf.corner } : {}),
                ...(lineLeaf.start ? { start: lineLeaf.start } : {}),
                ...(lineLeaf.end ? { end: lineLeaf.end } : {})
              }
            }
          : {})
      };
      const { ocdNumber, encodedSymbol } = encodeAndAddSymbol(mergedArea, codeStr);
      symbolTargets.set(sym.id, [{ ocdNumber, symbol: encodedSymbol }]);
      continue;
    }

    // Generellt fall: flera delar → separata OCAD-symboler (återanvänd om delen redan är en publik toppsymbol).
    const targets: MappedTarget[] = [];
    const hasArea = areaParts.length > 0;
    for (const leaf of leaves) {
      const existing = symbolTargets.get(leaf.id)?.[0];
      if (existing && !privateSubIds.has(leaf.id)) {
        targets.push({ ...existing, ...(hasArea && leaf.kind === "LINE" ? { areaToClosedLine: true } : {}) });
      } else {
        const subCode = leaf.code.main > 0
          ? (leaf.code.sub ? `${leaf.code.main}.${leaf.code.sub}` : String(leaf.code.main))
          : codeStr;
        const { ocdNumber, encodedSymbol } = encodeAndAddSymbol(
          { ...leaf, name: leaf.name || sym.name, hidden: sym.hidden || leaf.hidden },
          subCode
        );
        targets.push({ ocdNumber, symbol: encodedSymbol, ...(hasArea && leaf.kind === "LINE" ? { areaToClosedLine: true } : {}) });
      }
    }
    if (targets.length > 1) warnings.add("COMBINED_SPLIT", 1);
    if (targets.length > 0) symbolTargets.set(sym.id, targets);
    else warnings.add("COMBINED_UNSUPPORTED", 1);
  }

  // 4. Objekt: konvertera med avrundningsdetektering, klampning, multi-part-hantering och fullständiga rc-rektanglar.
  let skippedObjects = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const trackBounds = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  const toOcdCoord = (mm: number, roundedRef: { rounded: boolean }): number => {
    const scaled = mm * 100;
    const rounded = Math.round(scaled);
    if (Math.abs(scaled - rounded) > 1e-4) roundedRef.rounded = true;
    if (Math.abs(rounded) > OCD_COORD_LIMIT) {
      warnings.add("COORD_CLAMPED", 1);
      return clampOcd(rounded);
    }
    return rounded === 0 ? 0 : rounded;
  };

  const pathPartsToRawPts = (parts: readonly Path[], area: boolean, roundedRef: { rounded: boolean }): RawPt[] => {
    const out: { x: number; y: number; xf: number; yf: number }[] = [];
    parts.forEach((rawPart, ringIndex) => {
      const part = area ? openRing(rawPart) : rawPart;
      if (part.length < 2) return;
      let anchor = -1;
      const push = (mmX: number, mmY: number, xf = 0, yf = 0) => {
        const sx = mmX + shiftX;
        const sy = mmY + shiftY;
        trackBounds(sx, sy);
        out.push({ x: toOcdCoord(sx, roundedRef), y: toOcdCoord(sy, roundedRef), xf, yf });
        return out.length - 1;
      };
      const marks = (cmd: PathCommand) => (cmd.corner ? 1 : 0) | (cmd.dash ? 8 : 0);
      for (const cmd of part) {
        if (cmd.type === "M") {
          anchor = push(cmd.x, cmd.y, 0, marks(cmd) | (area && ringIndex > 0 ? 2 : 0));
          continue;
        }
        if (cmd.gap && anchor >= 0) {
          out[anchor]!.xf |= GAP_X(cmd.gap);
          out[anchor]!.yf |= GAP_Y(cmd.gap);
        }
        if (cmd.type === "C") {
          push(cmd.x1, cmd.y1, 1);
          push(cmd.x2, cmd.y2, 2);
        }
        anchor = push(cmd.x, cmd.y, 0, marks(cmd));
      }
      if (area) {
        const closing = part[0]!.gap ?? 0;
        if (closing && anchor >= 0) {
          out[anchor]!.xf |= GAP_X(closing);
          out[anchor]!.yf |= GAP_Y(closing);
        }
      }
    });
    return out;
  };

  const pushObject = (
    ocdNumber: number,
    targetSym: MapSymbol,
    obj: MapObject,
    type: number,
    points: readonly RawPt[],
    textBytes: Uint8Array,
    angleDeg: number
  ) => {
    const angle = type === OBJECT_TYPE.line || type === OBJECT_TYPE.rectangle ? 0 : angleUnits(angleDeg);
    const primaryColor = symbolPrimaryColor(targetSym);
    const header = primaryColor !== 0 ? new Uint8Array(doc.variant.object.coords) : undefined;
    if (header) new DataView(header.buffer).setInt32(V12_OBJ.color, primaryColor, true);
    const record = buildOcdObjectRecord(doc.variant, header, ocdNumber, type, angle, points, textBytes, at, true);
    const indexEntry = new Uint8Array(OBJ_INDEX.size);
    const view = new DataView(indexEntry.buffer);
    indexEntry.set(computeOcdObjectRect(points, targetSym, obj, type), OBJ_INDEX.rect);
    view.setInt32(OBJ_INDEX.symbol, ocdNumber, true);
    view.setUint8(OBJ_INDEX.type, type);
    view.setUint8(OBJ_INDEX.status, STATUS_NORMAL);
    view.setInt16(OBJ_INDEX.color, primaryColor, true);
    const rawObj: RawOcdObject = {
      key: doc.nextObjectKey++,
      originalIndex: null,
      originalLocator: null,
      indexEntry,
      record,
      symbol: ocdNumber,
      type,
      status: OBJ_STATUS.normal,
      encrypted: false
    };
    doc.objects.push(rawObj);
  };

  const shiftPoint = (pt: Point): Point => ({ x: pt.x + shiftX, y: pt.y + shiftY });

  for (const obj of map.objects) {
    const targets = symbolTargets.get(obj.symbol);
    if (!targets || targets.length === 0) {
      skippedObjects += 1;
      warnings.add("OBJECT_SKIPPED", 1);
      continue;
    }

    const roundedRef = { rounded: false };
    let emittedForObj = 0;

    for (const target of targets) {
      if (obj.kind === "point" && target.symbol.kind === "POINT") {
        const pt = shiftPoint(obj.at);
        trackBounds(pt.x, pt.y);
        const rawPt: RawPt = { x: toOcdCoord(pt.x, roundedRef), y: toOcdCoord(pt.y, roundedRef), xf: 0, yf: 0 };
        pushObject(target.ocdNumber, target.symbol, { ...obj, at: pt }, OBJECT_TYPE.point, [rawPt], new Uint8Array(0), obj.angle);
        emittedForObj += 1;
      } else if (obj.kind === "text" && target.symbol.kind === "TEXT") {
        const pt = shiftPoint(obj.at);
        trackBounds(pt.x, pt.y);
        const rawAnchor: RawPt = { x: toOcdCoord(pt.x, roundedRef), y: toOcdCoord(pt.y, roundedRef), xf: 0, yf: 0 };
        const normalizedText = obj.text.replace(/\r\n?/g, "\n");
        let textBytes = encodeOcdTextBytes(normalizedText);
        if (textBytes.length / 8 > MAX_TEXT_WORDS) {
          textBytes = encodeOcdTextBytes(normalizedText.slice(0, 32_000));
        }
        const pts = textBoxPoints(rawAnchor, target.symbol, normalizedText, obj.angle);
        pushObject(target.ocdNumber, target.symbol, { ...obj, at: pt, text: normalizedText }, OBJECT_TYPE.text, pts, textBytes, obj.angle);
        emittedForObj += 1;
      } else if (obj.kind === "line" && target.symbol.kind === "LINE") {
        const subparts = splitPathSubparts(obj.path);
        if (subparts.length === 0) continue;
        if (subparts.length > 1) warnings.add("MULTIPLE_PARTS_MERGED", subparts.length - 1);
        const objType = target.symbol.rectangle ? OBJECT_TYPE.rectangle : OBJECT_TYPE.line;
        for (const sub of subparts) {
          const pts = pathPartsToRawPts([sub], false, roundedRef);
          if (pts.length < 2) continue;
          pushObject(target.ocdNumber, target.symbol, { kind: "line", symbol: String(target.ocdNumber), path: sub }, objType, pts, new Uint8Array(0), 0);
          emittedForObj += 1;
        }
      } else if (obj.kind === "area" && target.symbol.kind === "AREA") {
        const pts = pathPartsToRawPts(obj.rings, true, roundedRef);
        if (pts.length < 3) continue;
        pushObject(target.ocdNumber, target.symbol, obj, OBJECT_TYPE.area, pts, new Uint8Array(0), normalizeAngle(obj.angle));
        emittedForObj += 1;
      } else if (obj.kind === "area" && target.symbol.kind === "LINE" && target.areaToClosedLine) {
        const objType = target.symbol.rectangle ? OBJECT_TYPE.rectangle : OBJECT_TYPE.line;
        for (const ring of obj.rings) {
          const closedPath = closeRingAsLinePath(ring);
          const pts = pathPartsToRawPts([closedPath], false, roundedRef);
          if (pts.length < 2) continue;
          pushObject(target.ocdNumber, target.symbol, { kind: "line", symbol: String(target.ocdNumber), path: closedPath }, objType, pts, new Uint8Array(0), 0);
          emittedForObj += 1;
        }
      }
    }

    if (emittedForObj === 0) {
      skippedObjects += 1;
      warnings.add("OBJECT_SKIPPED", 1);
    } else if (roundedRef.rounded) {
      warnings.add("PRECISION_ROUNDED", 1);
    }
  }

  // 5. Visnings- och utskriftssträngar centrerade på kartans faktiska utbredning.
  const centerX = Number.isFinite(minX) && Number.isFinite(maxX) ? (minX + maxX) / 2 : 0;
  const centerY = Number.isFinite(minY) && Number.isFinite(maxY) ? (minY + maxY) / 2 : 0;
  appendDefaultOcdViewStrings(doc, { scale: map.scale, centerX, centerY, zoom: 2 });

  const packed = packOcdDocument(doc);
  return {
    bytes: packed.bytes,
    report: {
      sourceFormat: map.format,
      targetFormat: "OCD",
      colors: ocdColors.length,
      symbols: doc.symbols.length,
      objects: doc.objects.length,
      skippedObjects,
      warnings: warnings.list()
    }
  };
}
