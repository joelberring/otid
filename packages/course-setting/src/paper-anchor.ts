/**
 * Papperets förankring (ADR-0197): ett element står ett visst avstånd inåt från ett hörn av kartramen eller arket, i papperets
 * mm. Samma förankring för kontrollbeskrivningen (hittbarhet) och papperets texter, bilder, skalstock och nordpil.
 */
export type PaperCorner = "TOP_LEFT" | "TOP_RIGHT" | "BOTTOM_LEFT" | "BOTTOM_RIGHT";
export const PAPER_CORNERS: readonly PaperCorner[] = ["TOP_LEFT", "TOP_RIGHT", "BOTTOM_LEFT", "BOTTOM_RIGHT"];

/** En plats på papperet: avståndet (mm, inåt positivt) från ett hörn av ramen till elementets motsvarande hörn. */
export interface PaperAnchor {
  readonly corner: PaperCorner;
  readonly x: number;
  readonly y: number;
}

export interface PaperRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** Elementets övre vänstra hörn på papperet ur förankringen. */
export function anchorToPaper(anchor: PaperAnchor, size: { width: number; height: number }, clip: PaperRect): { x: number; y: number } {
  const right = anchor.corner === "TOP_RIGHT" || anchor.corner === "BOTTOM_RIGHT";
  const bottom = anchor.corner === "BOTTOM_LEFT" || anchor.corner === "BOTTOM_RIGHT";
  return { x: right ? clip.x + clip.width - anchor.x - size.width : clip.x + anchor.x, y: bottom ? clip.y + clip.height - anchor.y - size.height : clip.y + anchor.y };
}

/** Förankringen för ett element på papperet: närmaste hörn av ramen (efter elementets mitt). */
export function paperAnchorOf(rect: PaperRect, clip: PaperRect): PaperAnchor {
  const right = rect.x + rect.width / 2 > clip.x + clip.width / 2;
  const bottom = rect.y + rect.height / 2 > clip.y + clip.height / 2;
  const corner: PaperCorner = bottom ? (right ? "BOTTOM_RIGHT" : "BOTTOM_LEFT") : right ? "TOP_RIGHT" : "TOP_LEFT";
  const round = (value: number) => Math.round(value * 10) / 10;
  return { corner, x: round(right ? clip.x + clip.width - rect.x - rect.width : rect.x - clip.x),
    y: round(bottom ? clip.y + clip.height - rect.y - rect.height : rect.y - clip.y) };
}

/** Samma förankring med ett annat hörn (elementet står kvar på samma ställe). */
export function reanchor(anchor: PaperAnchor, corner: PaperCorner, size: { width: number; height: number }, clip: PaperRect): PaperAnchor {
  const at = anchorToPaper(anchor, size, clip);
  const right = corner === "TOP_RIGHT" || corner === "BOTTOM_RIGHT";
  const bottom = corner === "BOTTOM_LEFT" || corner === "BOTTOM_RIGHT";
  const round = (value: number) => Math.round(value * 10) / 10;
  return { corner, x: round(right ? clip.x + clip.width - at.x - size.width : at.x - clip.x), y: round(bottom ? clip.y + clip.height - at.y - size.height : at.y - clip.y) };
}
