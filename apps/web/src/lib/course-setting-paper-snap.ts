import type { PaperRect, Sheet } from "@o-tid/course-setting";

/**
 * ADR-0211 beslut 8: fästpunkterna när papperets element dras på arket (som AutoCAD:s paper space): kartramens kanter och
 * mitt, arkets marginal, kanter och mitt, och andra elements kanter och mitt, med synliga hjälplinjer; ett valbart rutnät
 * (1 eller 5 mm). Alt stänger av fästningen. Och justering och fördelning av markerade element.
 */
export interface SnapLine { readonly value: number; readonly kind: "FRAME" | "MARGIN" | "PAGE" | "ITEM" }
export interface SnapTargets { readonly x: readonly SnapLine[]; readonly y: readonly SnapLine[] }
/** En hjälplinje som visas medan elementet fäster: lodrät (`x`) eller vågrät (`y`) över arket. */
export interface SnapGuide { readonly axis: "x" | "y"; readonly value: number; readonly kind: SnapLine["kind"] }

/** Så nära (mm på papperet) fäster en kant eller mitt. */
export const SNAP_TOLERANCE_MM = 1.5;

/** Fästlinjerna på arket; elementen i `exclude` (de som dras) räknas inte. */
export function snapTargets(sheet: Pick<Sheet, "paper" | "frames" | "paperItems">, exclude: ReadonlySet<string> = new Set()): SnapTargets {
  const x: SnapLine[] = [], y: SnapLine[] = [];
  const add = (rect: PaperRect, kind: SnapLine["kind"]) => {
    x.push({ value: rect.x, kind }, { value: rect.x + rect.width / 2, kind }, { value: rect.x + rect.width, kind });
    y.push({ value: rect.y, kind }, { value: rect.y + rect.height / 2, kind }, { value: rect.y + rect.height, kind });
  };
  const { widthMm: w, heightMm: h, marginMm: m } = sheet.paper;
  add({ x: 0, y: 0, width: w, height: h }, "PAGE");
  if (m > 0) { x.push({ value: m, kind: "MARGIN" }, { value: w - m, kind: "MARGIN" }); y.push({ value: m, kind: "MARGIN" }, { value: h - m, kind: "MARGIN" }); }
  for (const frame of sheet.frames) add(frame.clip, "FRAME");
  for (const item of sheet.paperItems ?? []) if (!exclude.has(`${item.course}:${item.id}`)) add(item.rect, "ITEM");
  return { x, y };
}

/**
 * Var rutan hamnar när den flyttats `dx`, `dy`: närmaste fästlinje för vänsterkant, mitt eller högerkant (och överkant,
 * mitt, underkant) inom toleransen, annars rutnätet (`gridMm`) för övre vänstra hörnet, annars där den släpptes.
 */
export function snapMove(rect: PaperRect, dx: number, dy: number, targets: SnapTargets, options: { readonly gridMm?: number | undefined; readonly toleranceMm?: number | undefined } = {}):
  { dx: number; dy: number; guides: SnapGuide[] } {
  const tolerance = options.toleranceMm ?? SNAP_TOLERANCE_MM;
  const guides: SnapGuide[] = [];
  const axis = (start: number, size: number, lines: readonly SnapLine[], name: "x" | "y"): number => {
    let best: { shift: number; line: SnapLine } | undefined;
    for (const edge of [start, start + size / 2, start + size]) for (const line of lines) {
      const shift = line.value - edge;
      if (Math.abs(shift) <= tolerance && (!best || Math.abs(shift) < Math.abs(best.shift))) best = { shift, line };
    }
    if (best) { guides.push({ axis: name, value: best.line.value, kind: best.line.kind }); return best.shift; }
    if (options.gridMm && options.gridMm > 0) return Math.round(start / options.gridMm) * options.gridMm - start;
    return 0;
  };
  const sx = axis(rect.x + dx, rect.width, targets.x, "x");
  const sy = axis(rect.y + dy, rect.height, targets.y, "y");
  // Hundradels mm räcker och ger jämna tal i dokumentet.
  const round = (value: number) => Math.round(value * 100) / 100 || 0;
  return { dx: round(dx + sx), dy: round(dy + sy), guides };
}

export type AlignMode = "LEFT" | "CENTER" | "RIGHT" | "TOP" | "MIDDLE" | "BOTTOM";

/**
 * Flytten per ruta för att justera dem: mot de markerades gemensamma ruta, eller mot `reference` (kartramen) när bara en
 * är markerad.
 */
export function alignMoves(rects: readonly PaperRect[], mode: AlignMode, reference?: PaperRect): { dx: number; dy: number }[] {
  if (rects.length === 0) return [];
  const box = rects.length === 1 && reference ? reference : bounds(rects);
  return rects.map(rect => {
    switch (mode) {
      case "LEFT": return { dx: box.x - rect.x, dy: 0 };
      case "CENTER": return { dx: box.x + box.width / 2 - (rect.x + rect.width / 2), dy: 0 };
      case "RIGHT": return { dx: box.x + box.width - (rect.x + rect.width), dy: 0 };
      case "TOP": return { dx: 0, dy: box.y - rect.y };
      case "MIDDLE": return { dx: 0, dy: box.y + box.height / 2 - (rect.y + rect.height / 2) };
      case "BOTTOM": return { dx: 0, dy: box.y + box.height - (rect.y + rect.height) };
    }
  });
}

/** Lika stora mellanrum mellan rutorna (minst tre), vågrätt eller lodrätt; de yttersta står kvar. */
export function distributeMoves(rects: readonly PaperRect[], axis: "HORIZONTAL" | "VERTICAL"): { dx: number; dy: number }[] {
  const moves = rects.map(() => ({ dx: 0, dy: 0 }));
  if (rects.length < 3) return moves;
  const start = (rect: PaperRect) => axis === "HORIZONTAL" ? rect.x : rect.y;
  const size = (rect: PaperRect) => axis === "HORIZONTAL" ? rect.width : rect.height;
  const order = rects.map((rect, index) => ({ rect, index })).sort((a, b) => start(a.rect) - start(b.rect));
  const first = order[0]!.rect, last = order[order.length - 1]!.rect;
  const span = start(last) + size(last) - start(first);
  const gap = (span - order.reduce((sum, item) => sum + size(item.rect), 0)) / (order.length - 1);
  let at = start(first);
  for (const { rect, index } of order) {
    const shift = at - start(rect);
    moves[index] = axis === "HORIZONTAL" ? { dx: shift, dy: 0 } : { dx: 0, dy: shift };
    at += size(rect) + gap;
  }
  return moves;
}

export function bounds(rects: readonly PaperRect[]): PaperRect {
  const minX = Math.min(...rects.map(rect => rect.x)), minY = Math.min(...rects.map(rect => rect.y));
  const maxX = Math.max(...rects.map(rect => rect.x + rect.width)), maxY = Math.max(...rects.map(rect => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
