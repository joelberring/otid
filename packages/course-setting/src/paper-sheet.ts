/** Papperet (ADR-0197): elementen på arket (storlek, delar, förankring) och klippningen av kartan och markeringarna. */
import type { Point } from "@o-tid/map-file";
import { anchorToPaper, type PaperRect } from "./paper-anchor";
import type { TrainingMapPass } from "./training-types";
import type { CourseSettingDocument, MapRect } from "./types";
import { shapeParts, shapeSize } from "./paper-shapes";
import { effectivePaper, ownPartLayout, type PaperAlign, type PaperClip, type PaperItem, type PaperItemKind, type PaperSource } from "./paper-items";
import { expandPaperText, type PaperTextFrame } from "./paper-text";

/** Delarna som förhandsvisningen (SVG) och PDF:en ritar, i papperets mm (y nedåt). Svart och vitt; bilden med täckning. */
export type PaperPart =
  | { readonly kind: "rect"; readonly x: number; readonly y: number; readonly width: number; readonly height: number;
      readonly fill?: "WHITE" | "BLACK" | undefined; readonly stroke?: number | undefined;
      /** Rektangelns färger (#rrggbb, ADR-0211 beslut 8) i stället för svart och vitt, och rundade hörn. */
      readonly fillColor?: string | undefined; readonly strokeColor?: string | undefined; readonly radius?: number | undefined }
  | { readonly kind: "line"; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly width: number; readonly color: string }
  | { readonly kind: "polygon"; readonly points: readonly { readonly x: number; readonly y: number }[]; readonly fill: "WHITE" | "BLACK";
      readonly stroke?: number | undefined }
  | { readonly kind: "text"; readonly text: string; readonly at: { readonly x: number; readonly y: number }; readonly heightMm: number;
      readonly bold: boolean; readonly align: PaperAlign }
  | { readonly kind: "image"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly image: string;
      readonly mediaType: string; readonly opacity: number };

/** Ett element på arket: var det står, varifrån det kommer och delarna. */
export interface SheetPaperItem {
  readonly id: string;
  readonly kind: PaperItemKind;
  readonly course: string;
  readonly frame: number;
  readonly rect: PaperRect;
  readonly source: PaperSource;
  readonly relativeTo: "FRAME" | "PAGE";
  readonly parts: readonly PaperPart[];
  /** Låst i lagerlistan: ritas men markeras och flyttas inte på arket. */
  readonly locked?: boolean | undefined;
}

export const PAPER_TEXT_LINE = 1.2;
const TEXT_PAD_MM = 0.8;
const SCALE_BAR = { bar: 1.5, label: 2.5, gap: 0.6, pad: 1 } as const;

/** Skalstockens längd: största 1, 2 eller 5 gånger en tiopotens (meter) som ryms i `maxMm` i skalan. */
export function scaleBarLength(maxMm: number, printScale: number): { meters: number; mm: number; segments: number } {
  const maxMeters = maxMm * printScale / 1000;
  if (!(maxMeters > 0)) return { meters: 0, mm: 0, segments: 1 };
  const power = 10 ** Math.floor(Math.log10(maxMeters));
  const lead = [5, 2, 1].find(step => step * power <= maxMeters + 1e-9) ?? 1;
  const meters = lead * power;
  return { meters, mm: meters * 1000 / printScale, segments: lead === 2 ? 4 : 5 };
}

const metersText = (meters: number) => meters >= 1000 ? `${String(meters / 1000).replace(".", ",")} km` : `${meters} m`;

/** Elementets storlek på papperet (mm). */
export function paperItemSize(item: PaperItem, text?: string): { width: number; height: number } {
  switch (item.kind) {
    case "TEXT": {
      const lines = Math.max(1, (text ?? item.text).split("\n").length);
      return { width: item.widthMm, height: lines * item.sizeMm * PAPER_TEXT_LINE + (item.background ? 2 * TEXT_PAD_MM : 0) };
    }
    case "IMAGE": return { width: item.widthMm, height: item.widthMm / item.aspect };
    case "SCALE_BAR": return { width: item.widthMm + (item.background ? 2 * SCALE_BAR.pad : 0),
      height: SCALE_BAR.label * PAPER_TEXT_LINE + SCALE_BAR.gap + SCALE_BAR.bar + (item.background ? 2 * SCALE_BAR.pad : 0) };
    case "NORTH_ARROW": return { width: item.sizeMm * 0.6, height: item.sizeMm };
    case "RECT": case "LINE": return shapeSize(item);
  }
}

/** Delarna för ett element med övre vänstra hörnet i `at`. */
export function paperItemParts(item: PaperItem, at: { x: number; y: number }, context: { text?: string; printScale: number }): PaperPart[] {
  const size = paperItemSize(item, context.text);
  switch (item.kind) {
    case "TEXT": {
      const parts: PaperPart[] = item.background ? [{ kind: "rect", x: at.x, y: at.y, width: size.width, height: size.height, fill: "WHITE" }] : [];
      const pad = item.background ? TEXT_PAD_MM : 0;
      const align = item.align ?? "left";
      const x = align === "left" ? at.x + pad : align === "right" ? at.x + size.width - pad : at.x + size.width / 2;
      (context.text ?? item.text).split("\n").forEach((line, index) => {
        if (line.trim() === "") return;
        // Baslinjen: radens topp + 0,95 em (versalerna ryms ovanför, nedstaplarna under).
        parts.push({ kind: "text", text: line, at: { x, y: at.y + pad + index * item.sizeMm * PAPER_TEXT_LINE + item.sizeMm * 0.95 },
          heightMm: item.sizeMm, bold: item.bold === true, align });
      });
      return parts;
    }
    case "IMAGE":
      return [{ kind: "image", x: at.x, y: at.y, width: size.width, height: size.height, image: item.image, mediaType: item.mediaType, opacity: item.opacity ?? 1 }];
    case "SCALE_BAR": {
      const pad = item.background ? SCALE_BAR.pad : 0;
      const bar = scaleBarLength(item.widthMm, context.printScale);
      const parts: PaperPart[] = item.background ? [{ kind: "rect", x: at.x, y: at.y, width: size.width, height: size.height, fill: "WHITE" }] : [];
      const left = at.x + pad, top = at.y + pad + SCALE_BAR.label * PAPER_TEXT_LINE + SCALE_BAR.gap;
      const step = bar.mm / bar.segments;
      for (let i = 0; i < bar.segments; i += 1) {
        parts.push({ kind: "rect", x: left + i * step, y: top, width: step, height: SCALE_BAR.bar, fill: i % 2 === 0 ? "BLACK" : "WHITE", stroke: 0.15 });
      }
      const baseline = top - SCALE_BAR.gap - 0.15 * SCALE_BAR.label;
      parts.push({ kind: "text", text: "0", at: { x: left, y: baseline }, heightMm: SCALE_BAR.label, bold: false, align: "left" });
      parts.push({ kind: "text", text: metersText(bar.meters), at: { x: left + bar.mm, y: baseline }, heightMm: SCALE_BAR.label, bold: false, align: "right" });
      return parts;
    }
    case "NORTH_ARROW": {
      const w = size.width, h = size.height;
      return [
        { kind: "polygon", points: [{ x: at.x + w / 2, y: at.y }, { x: at.x + w, y: at.y + 0.68 * h }, { x: at.x + w / 2, y: at.y + 0.54 * h },
          { x: at.x, y: at.y + 0.68 * h }], fill: "BLACK" },
        { kind: "text", text: "N", at: { x: at.x + w / 2, y: at.y + h }, heightMm: 0.28 * h, bold: true, align: "center" }
      ];
    }
    case "RECT": case "LINE": return shapeParts(item, at);
  }
}

/** En ram på arket som elementen förankras i. */
export interface PaperFrameRef extends PaperTextFrame {
  readonly clip: PaperRect;
}

/**
 * Banans element på ett ark: förankrade i ramen (eller arket, bara för första ramen på arket), variablerna ifyllda för
 * ramens bana. En text som blir tom efter ifyllningen står inte på arket.
 */
export function sheetPaperItems(document: CourseSettingDocument, frame: PaperFrameRef, frameIndex: number,
  options: { readonly page: PaperRect; readonly date?: string | undefined; readonly pageItems?: boolean | undefined;
    /** ADR-0213: löparens variabler som platshållare när ramen inte har någon löpare. */
    readonly runnerPlaceholders?: boolean | undefined;
    /** false = en senare sida av en bana på flera sidor: bara elementen med `pages: "ALL"`. */
    readonly firstPage?: boolean | undefined }): SheetPaperItem[] {
  const out: SheetPaperItem[] = [];
  const partOwn = new Set(frame.part !== undefined ? (ownPartLayout(document, frame.course, frame.part).items ?? []).map(item => item.id) : []);
  for (const { item, source } of effectivePaper(document, frame.course, frame.part).items) {
    if (options.firstPage === false && item.pages !== "ALL") continue;
    if (item.hide) continue;
    // Kartbyten (ADR-0203): "Alla sidor" är alla delar; en senare del har annars bara sina egna element.
    if (frame.part !== undefined && frame.part > 0 && item.pages !== "ALL" && !partOwn.has(item.id)) continue;
    if (item.relativeTo === "PAGE" && options.pageItems === false) continue;
    const placed = placePaperItem(document, item, source, frame, frameIndex, options);
    if (placed) out.push(placed);
  }
  return out;
}

/**
 * Ett element på arket med variablerna ifyllda (för ramens bana och löpare). En text som blir tom står inte på arket.
 * `course` på resultatet säger vems element det är (banans id, eller baksidans, ADR-0213).
 */
export function placePaperItem(document: CourseSettingDocument, item: PaperItem, source: PaperSource, frame: PaperFrameRef, frameIndex: number,
  options: { readonly page: PaperRect; readonly date?: string | undefined; readonly runnerPlaceholders?: boolean | undefined; readonly course?: string | undefined })
  : SheetPaperItem | undefined {
  const onPage = item.relativeTo === "PAGE";
  const text = item.kind === "TEXT" ? expandPaperText(item.text, document, options.runnerPlaceholders ? { ...frame, runnerPlaceholders: true } : frame, options.date) : undefined;
  if (item.kind === "TEXT" && text === "") return undefined;
  const size = paperItemSize(item, text);
  const at = anchorToPaper(item.at, size, onPage ? options.page : frame.clip);
  return { id: item.id, kind: item.kind, course: options.course ?? frame.course, frame: frameIndex, rect: { ...at, ...size }, source, relativeTo: onPage ? "PAGE" : "FRAME",
    ...(item.locked ? { locked: true } : {}),
    parts: paperItemParts(item, at, { ...(text !== undefined ? { text } : {}), printScale: frame.printScale }) };
}

// ── Klippningen ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Klippningens hörn i ramens mm. */
export function paperClipPoints(clip: PaperClip): { x: number; y: number }[] {
  if (clip.shape === "POLYGON") return clip.points.map(p => ({ x: p.x, y: p.y }));
  const r = clip.rect;
  return [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];
}

/** Klippningen som ring i kartans mm för ramen (spegelvänd karta: kring ramens lodräta mittlinje, som kartbilden). */
export function paperClipRing(clip: PaperClip, frame: { readonly clip: PaperRect; readonly transform: { scale: number; translateX: number; translateY: number };
  readonly mapArea: MapRect; readonly mirror?: boolean | undefined }): Point[] {
  const t = frame.transform;
  const axis = (frame.mapArea.minX + frame.mapArea.maxX) / 2;
  return paperClipPoints(clip).map(p => {
    const x = (frame.clip.x + p.x - t.translateX) / t.scale, y = -(frame.clip.y + p.y - t.translateY) / t.scale;
    return { x: frame.mirror ? 2 * axis - x : x, y };
  });
}

/** Specialobjekten som är punktsymboler: står helt eller inte alls (efter sin punkt), klipps aldrig mitt itu. */
export const POINT_MARKINGS: ReadonlySet<string> = new Set(["first-aid", "water", "optional-crossing-point", "forbidden-route", "registration-mark"]);

function inside(point: { x: number; y: number }, polygon: readonly { x: number; y: number }[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Markeringarnas klippning på ett ark: polygonen i papperets mm och specialobjekten (id) som ritas klippta till den. */
export interface MarkingClip {
  readonly polygon: readonly { readonly x: number; readonly y: number }[];
  readonly refs: readonly string[];
}

/**
 * Banläggningens markeringar vid klippningen (ägaren 2026-11-03): banans figurer står kvar hela; en punktsymbol (vätska,
 * sjukvård, passage …) vars punkt ligger utanför tas bort; övriga specialobjekt (förbjudet område, gräns, text, bild …)
 * ritas klippta till polygonen (`refs`), så att ett område som delvis ligger innanför syns där. `mirror`: figurerna är
 * redan speglade kring ramens mitt (träningens spegelvända karta).
 */
export function clipMarkings<F extends { readonly role: string; readonly ref?: string | undefined; readonly kind: string }>(document: CourseSettingDocument,
  frame: { readonly clip: PaperRect; readonly transform: { scale: number; translateX: number; translateY: number }; readonly mapArea: MapRect;
    readonly figures: readonly F[] }, clip: PaperClip, mirror = false): { figures: F[]; markingClip: MarkingClip } {
  const polygon = paperClipPoints(clip).map(p => ({ x: frame.clip.x + p.x, y: frame.clip.y + p.y }));
  const t = frame.transform;
  const axis = (frame.mapArea.minX + frame.mapArea.maxX) / 2;
  const specials = new Map(document.specialObjects.map(special => [special.id, special]));
  const dropped = new Set<string>(), clipped = new Set<string>();
  for (const figure of frame.figures) {
    if (figure.role !== "SPECIAL" || figure.ref === undefined || figure.kind === "description") continue;
    const special = specials.get(figure.ref);
    if (special && POINT_MARKINGS.has(special.kind) && special.points[0]) {
      const p = special.points[0];
      const x = mirror ? 2 * axis - p.x : p.x;
      if (!inside({ x: t.scale * x + t.translateX, y: -t.scale * p.y + t.translateY }, polygon)) dropped.add(figure.ref);
    } else clipped.add(figure.ref);
  }
  const figures = frame.figures.filter(figure => !(figure.role === "SPECIAL" && figure.ref !== undefined && dropped.has(figure.ref)));
  return { figures, markingClip: { polygon, refs: [...clipped] } };
}

/** Tonen utanför klippningen (andel mot vitt), som träningens tonade. */
export const PAPER_CLIP_FADE = 0.75;

/** Kartans pass med klippningen: innanför som förut, utanför vitt (inget ritas) eller tonat. */
export function clipMapPasses(passes: readonly TrainingMapPass[] | undefined, ring: readonly Point[], outside: "WHITE" | "FADED"): TrainingMapPass[] {
  const base: readonly TrainingMapPass[] = passes ?? [{ within: [], without: [], filters: [] }];
  const region = [ring];
  const inside = base.map(pass => ({ ...pass, within: [...pass.within, region] }));
  if (outside === "WHITE") return inside;
  return [...inside, ...base.map(pass => ({ ...pass, without: [...pass.without, region],
    lighten: Math.max(pass.lighten ?? 0, PAPER_CLIP_FADE) }))];
}
