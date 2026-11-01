import { toPage, type CoursePage, type OverprintPrimitive } from "@o-tid/course-setting";
import { circleArcs } from "./course-setting-draw";
import { cachedDescriptionNodes, screenColor } from "./course-setting-draw-special";
import type { SvgNode, SymbolLookup } from "./course-setting-description-draw";
import { MAX_RENDER_SIDE } from "./course-setting-map-protocol";

/**
 * Steg 64: en utskriftssida (`layoutCoursePage`) som SVG-noder i papperets mm (y nedåt). Förhandsvisningen ritar dem i
 * webbläsaren och skriver ut dem som utkast; steg 65 skriver samma sidor som PDF med dekorfärger. Färgerna här är skärmens.
 */
export type PrintNode =
  | { readonly tag: "path"; readonly d: string; readonly stroke?: string | undefined; readonly fill?: string | undefined; readonly width?: number | undefined;
      readonly dash?: string | undefined; readonly cap?: "round" | "butt" | undefined; readonly opacity?: number | undefined; readonly ref?: string | undefined;
      readonly role: string }
  | { readonly tag: "text"; readonly x: number; readonly y: number; readonly text: string; readonly size: number; readonly fill: string;
      readonly anchor: "start" | "middle"; readonly family: string; readonly bold: boolean; readonly italic: boolean; readonly ref?: string | undefined;
      readonly role: string }
  | { readonly tag: "image"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly href: string;
      readonly ref?: string | undefined }
  /** Beskrivningen: noderna i kartans mm (y nedåt) flyttade och skalade till sidan. */
  | { readonly tag: "description"; readonly x: number; readonly y: number; readonly scale: number; readonly nodes: readonly SvgNode[];
      readonly ref?: string | undefined };

const r3 = (value: number) => Math.round(value * 1000) / 1000;

function pathOf(page: CoursePage, points: readonly { x: number; y: number }[], closed: boolean): string {
  return points.map((point, index) => {
    const at = toPage(page, point);
    return `${index === 0 ? "M" : "L"}${r3(at.x)} ${r3(at.y)}`;
  }).join(" ") + (closed ? " Z" : "");
}

/** Ringens bågar (grader moturs i kartan) som SVG-bågar på sidan; utan avbrott en hel ring. */
function circlePath(page: CoursePage, primitive: Extract<OverprintPrimitive, { kind: "circle" }>): string {
  const r = primitive.diameter / 2;
  const at = (degrees: number) => toPage(page, { x: primitive.center.x + r * Math.cos(degrees * Math.PI / 180), y: primitive.center.y + r * Math.sin(degrees * Math.PI / 180) });
  const radius = r3(r * page.transform.scale);
  return circleArcs(primitive.gaps).map(([start, end]) => {
    if (end - start >= 360) {
      const a = at(start), b = at(start + 180);
      return `M${r3(a.x)} ${r3(a.y)} A${radius} ${radius} 0 1 0 ${r3(b.x)} ${r3(b.y)} A${radius} ${radius} 0 1 0 ${r3(a.x)} ${r3(a.y)}`;
    }
    const a = at(start), b = at(end);
    // Moturs i kartan är moturs på papperet också (y vänds bara i talen): svep 0 i SVG.
    return `M${r3(a.x)} ${r3(a.y)} A${radius} ${radius} 0 ${end - start > 180 ? 1 : 0} 0 ${r3(b.x)} ${r3(b.y)}`;
  }).join(" ");
}

/** Figurerna på sidan i målningsordning. Bildernas data blir data-URL. */
export function pageNodes(page: CoursePage, symbols: SymbolLookup): PrintNode[] {
  const s = page.transform.scale;
  return page.figures.map((primitive): PrintNode => {
    if (primitive.kind === "image") {
      const corner = toPage(page, { x: primitive.rect.minX, y: primitive.rect.maxY });
      return { tag: "image", x: r3(corner.x), y: r3(corner.y), width: r3((primitive.rect.maxX - primitive.rect.minX) * s),
        height: r3((primitive.rect.maxY - primitive.rect.minY) * s), href: `data:${primitive.mediaType};base64,${primitive.data}`, ref: primitive.ref };
    }
    const color = screenColor(primitive);
    const base = { ref: primitive.ref, role: primitive.role };
    switch (primitive.kind) {
      case "circle": return { tag: "path", d: circlePath(page, primitive), stroke: color, width: r3(primitive.lineWidth * s), ...base };
      case "polyline": return { tag: "path", d: pathOf(page, primitive.points, primitive.closed === true), stroke: color, width: r3(primitive.width * s),
        ...(primitive.dash ? { dash: primitive.dash.map(value => r3(value * s)).join(" ") } : {}), cap: primitive.cap ?? "butt", ...base };
      case "polygon": return { tag: "path", d: primitive.rings.map(ring => pathOf(page, ring, true)).join(" "), fill: color,
        ...(primitive.tint !== undefined ? { opacity: primitive.tint } : {}), ...base };
      case "text": {
        const at = toPage(page, primitive.at);
        return { tag: "text", x: r3(at.x), y: r3(at.y), text: primitive.text, size: r3(primitive.heightMm * s), fill: color, anchor: primitive.align === "left" ? "start" : "middle",
          family: primitive.font ? `"${primitive.font.family.replace(/"/g, "")}", Arial, Helvetica, sans-serif` : "Arial, Helvetica, sans-serif",
          bold: primitive.font?.bold ?? false, italic: primitive.font?.italic ?? false, ...base };
      }
      case "description": {
        const at = toPage(page, primitive.topLeft);
        return { tag: "description", x: r3(at.x), y: r3(at.y), scale: s, nodes: cachedDescriptionNodes(primitive.layout, symbols), ref: primitive.ref };
      }
    }
  });
}

/** Kartbilden för sidan: utsnittet `mapArea` i upplösning `dpi` (högst `MAX_RENDER_SIDE` pixlar på längsta sidan). */
export function mapRenderRequest(page: CoursePage, dpi = 300): { width: number; height: number; pxPerMm: number; origin: { x: number; y: number } } {
  const longest = Math.max(page.clip.width, page.clip.height);
  const pxPerPaperMm = Math.min(dpi / 25.4, MAX_RENDER_SIDE / Math.max(1, longest));
  return { width: Math.round(page.clip.width * pxPerPaperMm), height: Math.round(page.clip.height * pxPerPaperMm),
    pxPerMm: pxPerPaperMm * page.transform.scale, origin: { x: page.mapArea.minX, y: page.mapArea.maxY } };
}

/** Namnet på CSS-sidan (`@page`) för papperets storlek, så att varje ark skrivs ut i sin storlek och riktning. */
export function pageName(page: Pick<CoursePage, "paper">): string {
  return `otid-${Math.round(page.paper.widthMm)}x${Math.round(page.paper.heightMm)}`;
}

/** `@page`-reglerna för sidorna (utan marginal: sidan har sina egna marginaler i mm). */
export function pageStyles(pages: readonly Pick<CoursePage, "paper">[]): string {
  const sizes = new Map(pages.map(page => [pageName(page), page.paper]));
  return [...sizes].map(([name, paper]) => `@page ${name} { size: ${r3(paper.widthMm)}mm ${r3(paper.heightMm)}mm; margin: 0; }`).join("\n");
}
