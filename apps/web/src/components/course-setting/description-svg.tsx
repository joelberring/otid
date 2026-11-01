"use client";

import type { KeyboardEvent } from "react";
import type { DescriptionLayout } from "@o-tid/course-setting";
import { DESCRIPTION_FONT, descriptionNodes, mm, type SvgNode, type SymbolLookup } from "../../lib/course-setting-description-draw";
import { hitAreas, type HitPrimitive } from "../../lib/course-setting-description";
import { isPickerBox } from "../../lib/course-setting-description-picker";

/** Steg 63: noderna från `descriptionNodes` som SVG-element i React (samma som den nedladdade filen). Rent svart. */
export function DescriptionShapes({ nodes }: { nodes: readonly SvgNode[] }) {
  return <>{nodes.map((node, index) => <Shape key={index} node={node} />)}</>;
}

function Shape({ node }: { node: SvgNode }) {
  switch (node.tag) {
    case "path": return node.fill ? <path d={node.d} fill="#000" />
      : <path d={node.d} fill="none" stroke="#000" strokeWidth={node.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
    case "line": return <line x1={node.x1} y1={node.y1} x2={node.x2} y2={node.y2} stroke="#000" strokeWidth={node.strokeWidth} />;
    case "circle": return node.fill ? <circle cx={node.cx} cy={node.cy} r={node.r} fill="#000" />
      : <circle cx={node.cx} cy={node.cy} r={node.r} fill="none" stroke="#000" strokeWidth={node.strokeWidth} />;
    case "text": return <text x={node.x} y={node.y} fontSize={node.size} fontWeight={node.bold ? "bold" : undefined} textAnchor={node.anchor}
      dominantBaseline="central" textLength={node.textLength} lengthAdjust={node.textLength !== undefined ? "spacingAndGlyphs" : undefined}>{node.text}</text>;
    case "symbol": return <g data-symbol={node.symbol} data-ref={node.ref}><DescriptionShapes nodes={node.children} /></g>;
  }
}

/**
 * En beskrivning som egen SVG. I editorn är raderna och rutorna klickbara (och nåbara med Tab): `onHit` får ytan,
 * `highlight` markerar vald rad och `active` rutan som väljaren är öppen för.
 */
export function DescriptionSvg({ layout, symbols, label, fluid, highlight, active, onHit, hitLabel, testId }: {
  layout: DescriptionLayout; symbols: SymbolLookup; label: string;
  /** Så bred som behållaren (editorn); annars verklig storlek i mm. */
  fluid?: boolean | undefined;
  highlight?: { x: number; y: number; width: number; height: number } | undefined;
  active?: { ref: string; box: string } | undefined;
  onHit?: ((hit: HitPrimitive) => void) | undefined; hitLabel?: ((hit: HitPrimitive) => string) | undefined; testId?: string | undefined;
}) {
  const width = mm(layout.widthMm), height = mm(layout.heightMm);
  // Raderna först, så att rutorna ligger ovanpå och tar klicket.
  const hits = onHit ? [...hitAreas(layout)].sort((left, right) => (left.box ? 1 : 0) - (right.box ? 1 : 0)) : [];
  const key = (hit: HitPrimitive) => (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onHit?.(hit);
  };
  const box = active ? hits.find(hit => hit.ref === active.ref && hit.box === active.box) : undefined;
  // Klickbara rader och rutor: en grupp (en bild döljer sina delar för skärmläsare).
  return <svg role={onHit ? "group" : "img"} aria-label={label} data-testid={testId} viewBox={`0 0 ${width} ${height}`}
    width={fluid ? "100%" : `${width}mm`} height={fluid ? undefined : `${height}mm`} fontFamily={DESCRIPTION_FONT}
    style={{ display: "block", background: "#fff", ...(fluid ? { height: "auto", maxWidth: `${width * 7}px` } : {}) }}>
    {highlight && <rect x={highlight.x} y={highlight.y} width={highlight.width} height={highlight.height} fill="var(--attention-tint, #fff3c4)" />}
    {box && <rect x={box.x} y={box.y} width={box.width} height={box.height} fill="var(--attention, #f0b400)" fillOpacity={0.35} />}
    <DescriptionShapes nodes={descriptionNodes(layout, symbols)} />
    {hits.map((hit, index) => <rect key={index} x={hit.x} y={hit.y} width={hit.width} height={hit.height} fill="transparent"
      style={{ cursor: "pointer" }} tabIndex={!hit.box || isPickerBox(hit.box) ? 0 : -1} role="button" aria-label={hitLabel?.(hit)}
      data-ref={hit.ref} data-box={hit.box} onClick={() => onHit?.(hit)} onKeyDown={key(hit)} />)}
  </svg>;
}
