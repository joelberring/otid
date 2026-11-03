"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { PaperPart, Sheet, SheetPaperItem } from "@o-tid/course-setting";
import { paperSpaceSv as text } from "../../i18n/course-setting-paper-sv";
import styles from "./course-setting-print-page.module.css";

/** Det markerade elementet på papperet; `CLIP` = klippningens hörn. */
export type PaperSelection = { readonly course: string; readonly id: string } | undefined;
export const CLIP_SELECTION = "__clip";

/** Hur arket ritar och ändrar papperets element (ADR-0197). Utan `editable` ritas de bara. */
export interface PaperInteraction {
  readonly editable: boolean;
  readonly selected: PaperSelection;
  readonly imageUrl: (sha256: string) => string;
  readonly onSelect: (selection: PaperSelection) => void;
  readonly onMove: (sheet: Sheet, item: SheetPaperItem, dx: number, dy: number) => void;
  readonly onResize: (sheet: Sheet, item: SheetPaperItem, width: number, height: number) => void;
  readonly onDelete: (item: SheetPaperItem) => void;
  /** Klippningen för den markerade banan i ramens mm (hörnen dras när klippningen är markerad). */
  readonly clip?: { readonly course: string; readonly points: readonly { x: number; y: number }[] } | undefined;
  readonly onClipPoint?: ((index: number, point: { x: number; y: number }) => void) | undefined;
}

const KEY_STEP_MM = 1;

function Part({ part, imageUrl }: { part: PaperPart; imageUrl: (sha256: string) => string }) {
  switch (part.kind) {
    case "rect": return <rect x={part.x} y={part.y} width={part.width} height={part.height} fill={part.fill === "BLACK" ? "#000" : part.fill === "WHITE" ? "#fff" : "none"}
      stroke={part.stroke ? "#000" : undefined} strokeWidth={part.stroke} />;
    case "polygon": return <polygon points={part.points.map(p => `${p.x},${p.y}`).join(" ")} fill={part.fill === "BLACK" ? "#000" : "#fff"}
      stroke={part.stroke ? "#000" : undefined} strokeWidth={part.stroke} />;
    case "text": return <text x={part.at.x} y={part.at.y} fontSize={part.heightMm} fontWeight={part.bold ? "bold" : undefined}
      textAnchor={part.align === "left" ? "start" : part.align === "right" ? "end" : "middle"} fill="#000" fontFamily="Arial, Helvetica, sans-serif"
      style={{ whiteSpace: "pre" }}>{part.text}</text>;
    case "image": return <image href={imageUrl(part.image)} x={part.x} y={part.y} width={part.width} height={part.height} preserveAspectRatio="none"
      opacity={part.opacity < 1 ? part.opacity : undefined} data-testid="paper-image" />;
  }
}

/** Papperets element på ett ark; markerat element med ram och handtag (bara på skärmen). */
export function PaperItemsLayer({ sheet, interaction }: { sheet: Sheet; interaction?: PaperInteraction | undefined }) {
  const items = sheet.paperItems ?? [];
  const noop = { editable: false, selected: undefined, imageUrl: () => "", onSelect: () => undefined, onMove: () => undefined,
    onResize: () => undefined, onDelete: () => undefined } satisfies PaperInteraction;
  const active = interaction ?? noop;
  return <>
    {items.map(item => <PaperItemView key={`${item.frame}:${item.id}`} sheet={sheet} item={item} interaction={active} />)}
    {interaction?.clip && sheet.frames.map((frame, index) => frame.course === interaction.clip!.course
      && interaction.selected?.course === frame.course && interaction.selected.id === CLIP_SELECTION
      ? <ClipHandles key={index} frame={frame.clip} points={interaction.clip!.points} onPoint={interaction.onClipPoint} /> : null)}
  </>;
}

function PaperItemView({ sheet, item, interaction }: { sheet: Sheet; item: SheetPaperItem; interaction: PaperInteraction }) {
  const [drag, setDrag] = useState<{ dx: number; dy: number; dw: number; dh: number }>();
  const start = useRef<{ x: number; y: number; mode: "move" | "resize" }>(undefined);
  const selected = interaction.selected?.course === item.course && interaction.selected.id === item.id;
  const editable = interaction.editable;
  const label = text.kinds[item.kind] ?? item.kind;
  const paperPoint = (event: PointerEvent<SVGElement>) => {
    const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM()?.inverse();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix) : { x: 0, y: 0 };
  };
  const down = (mode: "move" | "resize") => (event: PointerEvent<SVGElement>) => {
    if (!editable) return;
    event.stopPropagation(); event.preventDefault();
    const group = event.currentTarget.closest<SVGGElement>("g[tabindex]");
    group?.focus({ preventScroll: true });
    if (!selected) interaction.onSelect({ course: item.course, id: item.id });
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = paperPoint(event);
    start.current = { x: at.x, y: at.y, mode };
    setDrag({ dx: 0, dy: 0, dw: 0, dh: 0 });
  };
  const move = (event: PointerEvent<SVGElement>) => {
    const from = start.current;
    if (!from) return;
    const at = paperPoint(event);
    if (from.mode === "move") setDrag({ dx: at.x - from.x, dy: at.y - from.y, dw: 0, dh: 0 });
    else setDrag({ dx: 0, dy: 0, dw: at.x - from.x, dh: at.y - from.y });
  };
  const up = () => {
    const current = drag, mode = start.current?.mode;
    start.current = undefined;
    setDrag(undefined);
    if (!current) return;
    if (mode === "move" && (Math.abs(current.dx) > 0.2 || Math.abs(current.dy) > 0.2)) interaction.onMove(sheet, item, current.dx, current.dy);
    if (mode === "resize" && (Math.abs(current.dw) > 0.2 || Math.abs(current.dh) > 0.2)) {
      // Bilden behåller proportionerna: bredden följer handtaget.
      interaction.onResize(sheet, item, Math.max(2, item.rect.width + current.dw), Math.max(2, item.rect.height + current.dh));
    }
  };
  const key = (event: KeyboardEvent<SVGGElement>) => {
    if (!editable) return;
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); interaction.onDelete(item); return; }
    if (event.key === "Escape") { interaction.onSelect(undefined); return; }
    const step = event.shiftKey ? 5 * KEY_STEP_MM : KEY_STEP_MM;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    interaction.onMove(sheet, item, delta[0], delta[1]);
  };
  const shown = drag ?? { dx: 0, dy: 0, dw: 0, dh: 0 };
  // Medan storleken ändras: skala delarna kring övre vänstra hörnet (bilden och nordpilen med låsta proportioner).
  const sx = item.rect.width > 0 ? Math.max(0.1, (item.rect.width + shown.dw) / item.rect.width) : 1;
  const sy = item.kind === "TEXT" || item.kind === "SCALE_BAR" ? 1 : item.kind === "NORTH_ARROW" ? Math.max(0.1, (item.rect.height + shown.dh) / item.rect.height) : sx;
  const scaleX = item.kind === "NORTH_ARROW" ? sy : sx;
  const transform = `translate(${shown.dx} ${shown.dy})` + (drag && (shown.dw || shown.dh)
    ? ` translate(${item.rect.x} ${item.rect.y}) scale(${scaleX} ${sy}) translate(${-item.rect.x} ${-item.rect.y})` : "");
  const r = item.rect;
  return <g transform={transform} data-testid="paper-item" data-kind={item.kind} data-id={item.id} data-course={item.course} data-source={item.source}
    data-selected={selected ? "" : undefined}
    {...(editable ? { tabIndex: 0, role: "button", "aria-label": text.dragLabel(label), "aria-pressed": selected, onKeyDown: key, className: styles.paperDescription } : {})}>
    {item.parts.map((part, index) => <Part key={index} part={part} imageUrl={interaction.imageUrl} />)}
    {editable && <rect x={r.x} y={r.y} width={r.width} height={r.height} fill="transparent" onPointerDown={down("move")} onPointerMove={move}
      onPointerUp={up} onPointerCancel={up} style={{ cursor: drag ? "grabbing" : "grab" }} />}
    {editable && selected && <>
      <rect className={styles.paperOutline} x={r.x} y={r.y} width={r.width} height={r.height} fill="none" stroke="#1d6fd1" strokeWidth={0.4}
        strokeDasharray="1.5 1" pointerEvents="none" />
      <rect className={styles.paperOutline} x={r.x + r.width - 2} y={r.y + r.height - 2} width={4} height={4} fill="#1d6fd1" stroke="#fff" strokeWidth={0.3}
        style={{ cursor: "nwse-resize" }} data-testid="paper-item-resize" aria-label={text.resizeLabel}
        onPointerDown={down("resize")} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
    </>}
  </g>;
}

/** Klippningens hörn i ramen: dras med musen eller fingret (bara på skärmen). */
function ClipHandles({ frame, points, onPoint }: { frame: { x: number; y: number; width: number; height: number }; points: readonly { x: number; y: number }[];
  onPoint?: ((index: number, point: { x: number; y: number }) => void) | undefined }) {
  const [drag, setDrag] = useState<{ index: number; x: number; y: number }>();
  const paperPoint = (event: PointerEvent<SVGElement>) => {
    const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM()?.inverse();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix) : { x: 0, y: 0 };
  };
  const shown = points.map((p, index) => drag?.index === index ? { x: drag.x, y: drag.y } : p);
  const round = (value: number) => Math.round(value * 10) / 10;
  return <g className={styles.paperOutline} data-testid="paper-clip-handles">
    <polygon points={shown.map(p => `${frame.x + p.x},${frame.y + p.y}`).join(" ")} fill="none" stroke="#1d6fd1" strokeWidth={0.4} strokeDasharray="2 1"
      pointerEvents="none" />
    {shown.map((p, index) => <rect key={index} x={frame.x + p.x - 2} y={frame.y + p.y - 2} width={4} height={4} fill="#1d6fd1" stroke="#fff" strokeWidth={0.3}
      style={{ cursor: "move" }} data-testid="paper-clip-handle" aria-label={text.clip.vertex(index + 1)}
      onPointerDown={event => { event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        const at = paperPoint(event); setDrag({ index, x: at.x - frame.x, y: at.y - frame.y }); }}
      onPointerMove={event => { if (drag?.index !== index) return; const at = paperPoint(event); setDrag({ index, x: at.x - frame.x, y: at.y - frame.y }); }}
      onPointerUp={() => { if (drag?.index === index) onPoint?.(index, { x: round(drag.x), y: round(drag.y) }); setDrag(undefined); }}
      onPointerCancel={() => setDrag(undefined)} />)}
  </g>;
}
