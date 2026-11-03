import {
  paperAnchorOf, paperLayoutOf, PAPER_LIMITS, type CourseSettingDocument, type CourseSettingEdit, type PaperAnchor, type PaperCorner, type PaperItem,
  type PaperItemKind, type PaperRect,
  type Sheet, type SheetPaperItem
} from "@o-tid/course-setting";

/**
 * ADR-0197: papperets redigering i förhandsvisningen (ren logik utan React): nya element, flytt och storlek på arket,
 * ändringen som sparas och ångra (ändringarna som återställer det som gällde före).
 */

/** Ett nytt element med förval: text nere till vänster, bild uppe till höger, skalstock nere till höger, nordpil uppe till höger. */
export function newPaperItem(kind: PaperItemKind, id: string, image?: { sha256: string; mediaType: "image/png" | "image/jpeg"; width: number; height: number }): PaperItem {
  switch (kind) {
    case "TEXT": return { id, kind, at: { corner: "BOTTOM_LEFT", x: 3, y: 3 }, text: "{bana}  {längd}  {skala}", sizeMm: 4, widthMm: 70, bold: true, background: true };
    case "IMAGE": return { id, kind, at: { corner: "TOP_RIGHT", x: 3, y: 3 }, image: image!.sha256, mediaType: image!.mediaType,
      aspect: Math.max(0.01, Math.min(100, image!.width / image!.height)), widthMm: 25 };
    case "SCALE_BAR": return { id, kind, at: { corner: "BOTTOM_RIGHT", x: 3, y: 3 }, widthMm: 40, background: true };
    case "NORTH_ARROW": return { id, kind, at: { corner: "TOP_RIGHT", x: 3, y: 30 }, sizeMm: 12 };
  }
}

/** Ramen (eller arket) som elementet är förankrat i. */
export function anchorRect(sheet: Sheet, placed: SheetPaperItem): PaperRect {
  return placed.relativeTo === "PAGE" ? { x: 0, y: 0, width: sheet.paper.widthMm, height: sheet.paper.heightMm } : sheet.frames[placed.frame]!.clip;
}

/** Förankringen i `corner` av `reference` för ett element som står i `rect` på arket. */
export function anchorIn(corner: PaperCorner, rect: PaperRect, reference: PaperRect): PaperAnchor {
  const right = corner === "TOP_RIGHT" || corner === "BOTTOM_RIGHT", bottom = corner === "BOTTOM_LEFT" || corner === "BOTTOM_RIGHT";
  const round = (value: number) => Math.round(value * 10) / 10;
  return { corner, x: round(right ? reference.x + reference.width - rect.x - rect.width : rect.x - reference.x),
    y: round(bottom ? reference.y + reference.height - rect.y - rect.height : rect.y - reference.y) };
}

/** Elementet flyttat `dx`, `dy` mm på arket; förankringen i närmaste hörn. */
export function movedPaperItem(item: PaperItem, placed: SheetPaperItem, reference: PaperRect, dx: number, dy: number): PaperItem {
  return { ...item, at: paperAnchorOf({ ...placed.rect, x: placed.rect.x + dx, y: placed.rect.y + dy }, reference) };
}

/** Elementet med ny storlek (övre vänstra hörnet står kvar): bredden för text, bild och skalstock, höjden för nordpilen. */
export function resizedPaperItem(item: PaperItem, placed: SheetPaperItem, reference: PaperRect, width: number, height: number): PaperItem {
  const clamp = (value: number, min: number, max: number) => Math.round(Math.max(min, Math.min(max, value)) * 10) / 10;
  let next: PaperItem;
  switch (item.kind) {
    case "TEXT": next = { ...item, widthMm: clamp(width, PAPER_LIMITS.minWidthMm, PAPER_LIMITS.maxWidthMm) }; break;
    case "IMAGE": next = { ...item, widthMm: clamp(width, 2, PAPER_LIMITS.maxWidthMm) }; break;
    case "SCALE_BAR": next = { ...item, widthMm: clamp(width - (item.background ? 2 : 0), PAPER_LIMITS.minScaleBarMm, PAPER_LIMITS.maxScaleBarMm) }; break;
    case "NORTH_ARROW": next = { ...item, sizeMm: clamp(height, PAPER_LIMITS.minArrowMm, PAPER_LIMITS.maxArrowMm) }; break;
  }
  const size = next.kind === "IMAGE" ? { width: next.widthMm, height: next.widthMm / next.aspect } : next.kind === "NORTH_ARROW"
    ? { width: next.sizeMm * 0.6, height: next.sizeMm } : next.kind === "TEXT" ? { width: next.widthMm, height: placed.rect.height }
      : { width: next.widthMm + (next.background ? 2 : 0), height: placed.rect.height };
  return { ...next, at: paperAnchorOf({ x: placed.rect.x, y: placed.rect.y, ...size }, reference) };
}

/**
 * Ändringarna som återställer det som gällde före `edits` (ångra): banans papper som det var, mallen som den var (eller
 * borttagen), datum och ekvidistans. En borttagen mall läggs tillbaka före banorna som ärvde av den.
 */
export function paperUndoFor(document: CourseSettingDocument, edits: readonly CourseSettingEdit[]): CourseSettingEdit[] {
  const out: CourseSettingEdit[] = [];
  const layout = (course: string): CourseSettingEdit => {
    const before = document.event.paperLayouts?.[course];
    return { type: "SET_PAPER_LAYOUT", course, layout: before ?? null };
  };
  for (const edit of edits) {
    switch (edit.type) {
      case "SET_PAPER_LAYOUT": out.push(layout(edit.course)); break;
      case "PUT_PAPER_TEMPLATE": {
        const before = document.event.paperTemplates?.find(row => row.id === edit.template.id);
        out.push(before ? { type: "PUT_PAPER_TEMPLATE", template: before } : { type: "DELETE_PAPER_TEMPLATE", id: edit.template.id });
        break;
      }
      case "DELETE_PAPER_TEMPLATE": {
        const before = document.event.paperTemplates?.find(row => row.id === edit.id);
        if (before) out.push({ type: "PUT_PAPER_TEMPLATE", template: before });
        for (const [course, row] of Object.entries(document.event.paperLayouts ?? {})) if (row.template === edit.id) out.push(layout(course));
        break;
      }
      case "SET_EVENT":
        if (edit.changes.paperValues !== undefined) out.push({ type: "SET_EVENT", changes: { paperValues: document.event.paperValues ?? {} } });
        break;
      default: break;
    }
  }
  // Mallarna först (en bana kan bara peka på en mall som finns), sedan banorna.
  return [...out.filter(edit => edit.type !== "SET_PAPER_LAYOUT"), ...out.filter(edit => edit.type === "SET_PAPER_LAYOUT")];
}

/** Ändringen som sätter hela banans papper (tomt = null). */
export function paperLayoutEdit(course: string, layout: ReturnType<typeof paperLayoutOf>): CourseSettingEdit {
  const empty = Object.values(layout).every(value => value === undefined || (Array.isArray(value) && value.length === 0));
  return { type: "SET_PAPER_LAYOUT", course, layout: empty ? null : layout };
}

/** Elementets namn i listan. */
export function paperItemLabel(item: PaperItem): string {
  switch (item.kind) {
    case "TEXT": return item.text.split("\n")[0]!.slice(0, 40) || "Text";
    case "IMAGE": return "Bild";
    case "SCALE_BAR": return "Skalstock";
    case "NORTH_ARROW": return "Nordpil";
  }
}
