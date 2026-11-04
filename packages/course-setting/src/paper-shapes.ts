/**
 * Rektanglar, ramar och linjer på papperet (ADR-0211 beslut 8). Typerna står i `paper-items.ts`; här gränserna, storleken
 * och delarna som förhandsvisningen och PDF:en ritar.
 */
import type { PaperItem, PaperLine, PaperPart, PaperRectangle, PaperShape } from "./paper-items";
import { CourseSettingEditError } from "./types";

export const PAPER_SHAPE_LIMITS = { minMm: 0, maxMm: 1000, maxStrokeMm: 5, maxRadiusMm: 50 } as const;
/** Förval för en ny ram: 0,5 mm svart linje, ingen fyllning. */
export const PAPER_SHAPE_DEFAULTS = { strokeMm: 0.5, color: "#000000" } as const;

const COLOR = /^#[0-9a-f]{6}$/;
const invalid = (message: string) => new CourseSettingEditError("INVALID", `Papperet: ${message}`);
const within = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const color = (value: unknown, what: string) => {
  if (typeof value !== "string" || !COLOR.test(value.toLowerCase())) throw invalid(`${what} (#rrggbb)`);
  return value.toLowerCase();
};

type Base = Pick<PaperItem, "id" | "at" | "relativeTo" | "pages" | "locked" | "hide">;

export function validateShapeItem(item: PaperRectangle | PaperLine, base: Base): PaperRectangle | PaperLine {
  if (!within(item.widthMm, PAPER_SHAPE_LIMITS.minMm, PAPER_SHAPE_LIMITS.maxMm) || !within(item.heightMm, PAPER_SHAPE_LIMITS.minMm, PAPER_SHAPE_LIMITS.maxMm)
    || item.widthMm + item.heightMm <= 0) throw invalid("storleken");
  if (!within(item.strokeMm, 0, PAPER_SHAPE_LIMITS.maxStrokeMm)) throw invalid("linjens bredd");
  const stroke = color(item.color, "färgen");
  if (item.kind === "LINE") {
    if (!(item.strokeMm > 0)) throw invalid("linjens bredd");
    if (item.rising !== undefined && typeof item.rising !== "boolean") throw invalid("linjens riktning");
    return { ...base, kind: "LINE", widthMm: item.widthMm, heightMm: item.heightMm, strokeMm: item.strokeMm, color: stroke, ...(item.rising ? { rising: true } : {}) };
  }
  if (item.radiusMm !== undefined && !within(item.radiusMm, 0, PAPER_SHAPE_LIMITS.maxRadiusMm)) throw invalid("hörnens rundning");
  const fill = item.fill === undefined ? undefined : color(item.fill, "fyllningen");
  if (!(item.strokeMm > 0) && !fill) throw invalid("en ram behöver en linje eller en fyllning");
  return { ...base, kind: "RECT", widthMm: item.widthMm, heightMm: item.heightMm, strokeMm: item.strokeMm, color: stroke, ...(fill ? { fill } : {}),
    ...(item.radiusMm ? { radiusMm: item.radiusMm } : {}) };
}

export function shapeSize(item: PaperRectangle | PaperLine): { width: number; height: number } {
  return { width: item.widthMm, height: item.heightMm };
}

/** Linjen ritas mitt på rutans kanter: ramens linje ligger innanför rutan, så att ramen syns hel vid arkets kant. */
export function shapeParts(item: PaperRectangle | PaperLine, at: { x: number; y: number }): PaperPart[] {
  if (item.kind === "LINE") {
    const [y1, y2] = item.rising ? [at.y + item.heightMm, at.y] : [at.y, at.y + item.heightMm];
    return [{ kind: "line", x1: at.x, y1, x2: at.x + item.widthMm, y2, width: item.strokeMm, color: item.color }];
  }
  const inset = item.strokeMm / 2;
  return [{ kind: "rect", x: at.x + inset, y: at.y + inset, width: Math.max(0, item.widthMm - item.strokeMm), height: Math.max(0, item.heightMm - item.strokeMm),
    ...(item.fill ? { fillColor: item.fill } : {}), ...(item.strokeMm > 0 ? { stroke: item.strokeMm, strokeColor: item.color } : {}),
    ...(item.radiusMm ? { radius: item.radiusMm } : {}) }];
}

/** #rrggbb som CMYK 0–1 (enkel omräkning; svart blir rent K). */
export function cmykOfHex(hex: string): { c: number; m: number; y: number; k: number } {
  const value = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!value) return { c: 0, m: 0, y: 0, k: 1 };
  const [r, g, b] = [1, 2, 3].map(index => parseInt(value[index]!, 16) / 255) as [number, number, number];
  const k = 1 - Math.max(r, g, b);
  if (k >= 1 - 1e-9) return { c: 0, m: 0, y: 0, k: 1 };
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { c: round((1 - r - k) / (1 - k)), m: round((1 - g - k) / (1 - k)), y: round((1 - b - k) / (1 - k)), k: round(k) };
}

/** Högst så många ytor "Vitt på utskriften" per bana och mall. */
export const WHITE_AREA_LIMITS = { areas: 20, points: 64 } as const;

/** "Vitt på utskriften" (ADR-0211 beslut 8): rektanglar och polygoner i ramens mm. */
export function validateWhiteAreas(value: unknown): PaperShape[] {
  if (!Array.isArray(value) || value.length > WHITE_AREA_LIMITS.areas) throw invalid(`vita ytor (högst ${WHITE_AREA_LIMITS.areas})`);
  const point = (p: { x: number; y: number } | undefined) => {
    if (!p || !within(p.x, -2000, 2000) || !within(p.y, -2000, 2000)) throw invalid("den vita ytans hörn");
    return { x: p.x, y: p.y };
  };
  return value.map((area: PaperShape) => {
    if (area?.shape === "RECT") {
      const r = area.rect;
      if (!r || !within(r.width, 0.5, 2000) || !within(r.height, 0.5, 2000)) throw invalid("den vita rektangeln");
      return { shape: "RECT", rect: { ...point({ x: r.x, y: r.y }), width: r.width, height: r.height } };
    }
    if (area?.shape === "POLYGON") {
      if (!Array.isArray(area.points) || area.points.length < 3 || area.points.length > WHITE_AREA_LIMITS.points) throw invalid(`den vita polygonen (3–${WHITE_AREA_LIMITS.points} hörn)`);
      return { shape: "POLYGON", points: area.points.map(point) };
    }
    throw invalid("den vita ytans form");
  });
}

/** Ytans hörn i ramens mm. */
export function shapePoints(area: PaperShape): { x: number; y: number }[] {
  if (area.shape === "POLYGON") return area.points.map(p => ({ x: p.x, y: p.y }));
  const r = area.rect;
  return [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];
}

/** Punkten i polygonen (jämn–udda). */
export function insidePolygon(point: { x: number; y: number }, polygon: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
