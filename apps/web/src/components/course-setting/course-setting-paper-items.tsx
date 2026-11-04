"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { PAPER_VARIABLES, type PaperPart, type Sheet, type SheetPaperItem } from "@o-tid/course-setting";
import { paperSpaceSv as text } from "../../i18n/course-setting-paper-sv";
import { snapMove, snapTargets, type SnapGuide } from "../../lib/course-setting-paper-snap";
import styles from "./course-setting-print-page.module.css";

/** Det markerade elementet på papperet; `CLIP` = klippningens hörn, `__white:<n>` = den vita ytans hörn. */
export type PaperSelection = { readonly course: string; readonly id: string } | undefined;
export const CLIP_SELECTION = "__clip";
export const WHITE_SELECTION = "__white:";

/** Hur arket ritar och ändrar papperets element (ADR-0197, ADR-0211 beslut 8). Utan `editable` ritas de bara. */
export interface PaperInteraction {
  readonly editable: boolean;
  readonly selected: PaperSelection;
  /** Alla markerade (Skift-klick, ruta på tomt papper); det första är `selected`. */
  readonly selection?: readonly { readonly course: string; readonly id: string }[] | undefined;
  readonly imageUrl: (sha256: string) => string;
  readonly onSelect: (selection: PaperSelection, additive?: boolean) => void;
  readonly onSelectMany?: ((list: readonly { course: string; id: string }[]) => void) | undefined;
  readonly onMove: (sheet: Sheet, item: SheetPaperItem, dx: number, dy: number) => void;
  readonly onResize: (sheet: Sheet, item: SheetPaperItem, width: number, height: number) => void;
  readonly onDelete: (item: SheetPaperItem) => void;
  /** Texten skriven direkt på arket (dubbelklick). */
  readonly onText?: ((item: SheetPaperItem, text: string) => void) | undefined;
  /** Textens källa med variablerna ({bana} …), för att skriva i den. */
  readonly textOf?: ((item: SheetPaperItem) => string | undefined) | undefined;
  /** Fästningen mot kanter och mittlinjer, och rutnätet (0 = av). */
  readonly snap?: { readonly enabled: boolean; readonly gridMm: number } | undefined;
  /** Klippningen för den markerade banan i ramens mm (hörnen dras när klippningen är markerad). */
  readonly clip?: { readonly course: string; readonly points: readonly { x: number; y: number }[] } | undefined;
  readonly onClipPoint?: ((index: number, point: { x: number; y: number }) => void) | undefined;
  /** "Vitt på utskriften": ytornas hörn i ramens mm för den markerade banan. */
  readonly white?: { readonly course: string; readonly areas: readonly (readonly { x: number; y: number }[])[] } | undefined;
  readonly onWhitePoint?: ((area: number, index: number, point: { x: number; y: number }) => void) | undefined;
}

const KEY_STEP_MM = 1;

/** Fångar pekaren (mus, finger, penna) för dragningen; en pekare som redan släppts kan inte fångas och dras då bara så länge den är över elementet. */
function capture(element: Element, pointerId: number): void {
  try { element.setPointerCapture(pointerId); } catch (error) { console.warn("Pekaren kunde inte fångas", error); }
}

function Part({ part, imageUrl }: { part: PaperPart; imageUrl: (sha256: string) => string }) {
  switch (part.kind) {
    case "rect": return <rect x={part.x} y={part.y} width={part.width} height={part.height} rx={part.radius} ry={part.radius}
      fill={part.fillColor ?? (part.fill === "BLACK" ? "#000" : part.fill === "WHITE" ? "#fff" : "none")}
      stroke={part.stroke ? part.strokeColor ?? "#000" : undefined} strokeWidth={part.stroke} />;
    case "line": return <line x1={part.x1} y1={part.y1} x2={part.x2} y2={part.y2} stroke={part.color} strokeWidth={part.width} />;
    case "polygon": return <polygon points={part.points.map(p => `${p.x},${p.y}`).join(" ")} fill={part.fill === "BLACK" ? "#000" : "#fff"}
      stroke={part.stroke ? "#000" : undefined} strokeWidth={part.stroke} />;
    case "text": return <text x={part.at.x} y={part.at.y} fontSize={part.heightMm} fontWeight={part.bold ? "bold" : undefined}
      textAnchor={part.align === "left" ? "start" : part.align === "right" ? "end" : "middle"} fill="#000" fontFamily="Arial, Helvetica, sans-serif"
      style={{ whiteSpace: "pre" }}>{part.text}</text>;
    case "image": return <image href={imageUrl(part.image)} x={part.x} y={part.y} width={part.width} height={part.height} preserveAspectRatio="none"
      opacity={part.opacity < 1 ? part.opacity : undefined} data-testid="paper-image" />;
  }
}

const noop: PaperInteraction = { editable: false, selected: undefined, imageUrl: () => "", onSelect: () => undefined, onMove: () => undefined,
  onResize: () => undefined, onDelete: () => undefined };

const keyOf = (item: { course: string; id: string }) => `${item.course}:${item.id}`;

/**
 * Papperets element på ett ark; markerade med ram och handtag (bara på skärmen). Dragning fäster mot ramen, marginalen och
 * andra element med hjälplinjer (Alt = fritt); en ruta på tomt papper markerar flera; dubbelklick skriver i en text.
 */
export function PaperItemsLayer({ sheet, interaction }: { sheet: Sheet; interaction?: PaperInteraction | undefined }) {
  const items = sheet.paperItems ?? [];
  const active = interaction ?? noop;
  const [guides, setGuides] = useState<readonly SnapGuide[]>([]);
  const [editing, setEditing] = useState<SheetPaperItem>();
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number }>();
  const selectedKeys = new Set((active.selection ?? (active.selected ? [active.selected] : [])).map(keyOf));
  const paperPoint = (event: PointerEvent<SVGElement>) => {
    const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM()?.inverse();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix) : { x: 0, y: 0 };
  };
  // Rutan på tomt papper (bara när arket går att ändra): markerar elementen som den täcker.
  const marqueeHandlers = active.editable ? {
    onPointerDown: (event: PointerEvent<SVGRectElement>) => {
      if (event.button !== 0) return;
      capture(event.currentTarget, event.pointerId);
      const at = paperPoint(event);
      setMarquee({ x0: at.x, y0: at.y, x1: at.x, y1: at.y });
    },
    onPointerMove: (event: PointerEvent<SVGRectElement>) => {
      if (!marquee) return;
      const at = paperPoint(event);
      setMarquee({ ...marquee, x1: at.x, y1: at.y });
    },
    onPointerUp: () => {
      const box = marquee;
      setMarquee(undefined);
      if (!box) return;
      const minX = Math.min(box.x0, box.x1), maxX = Math.max(box.x0, box.x1), minY = Math.min(box.y0, box.y1), maxY = Math.max(box.y0, box.y1);
      if (maxX - minX < 1 && maxY - minY < 1) { active.onSelect(undefined); return; }
      const hit = items.filter(item => !item.locked && item.rect.x < maxX && item.rect.x + item.rect.width > minX && item.rect.y < maxY && item.rect.y + item.rect.height > minY);
      if (active.onSelectMany) active.onSelectMany(hit.map(item => ({ course: item.course, id: item.id })));
      else active.onSelect(hit[0] ? { course: hit[0].course, id: hit[0].id } : undefined);
    }
  } : {};
  return <>
    {active.editable && <rect width={sheet.paper.widthMm} height={sheet.paper.heightMm} fill="transparent" data-testid="paper-empty" {...marqueeHandlers} />}
    {items.map(item => <PaperItemView key={`${item.frame}:${item.id}`} sheet={sheet} item={item} interaction={active} selected={selectedKeys.has(keyOf(item))}
      onGuides={setGuides} onEdit={active.onText && item.kind === "TEXT" ? () => setEditing(item) : undefined} />)}
    {interaction?.clip && sheet.frames.map((frame, index) => frame.course === interaction.clip!.course
      && interaction.selected?.course === frame.course && interaction.selected.id === CLIP_SELECTION
      ? <PointHandles key={index} frame={frame.clip} points={interaction.clip!.points} onPoint={interaction.onClipPoint} testId="paper-clip-handles"
        handleId="paper-clip-handle" label={text.clip.vertex} /> : null)}
    {interaction?.white && sheet.frames.map((frame, index) => {
      const area = interaction.selected?.course === frame.course && interaction.selected.id.startsWith(WHITE_SELECTION) && frame.course === interaction.white!.course
        ? Number(interaction.selected.id.slice(WHITE_SELECTION.length)) : -1;
      const points = interaction.white!.areas[area];
      return points ? <PointHandles key={`w${index}`} frame={frame.clip} points={points} onPoint={(vertex, point) => interaction.onWhitePoint?.(area, vertex, point)}
        testId="paper-white-handles" handleId="paper-white-handle" label={text.white.vertex} /> : null;
    })}
    {guides.map((guide, index) => guide.axis === "x"
      ? <line key={index} className={styles.paperOutline} x1={guide.value} x2={guide.value} y1={0} y2={sheet.paper.heightMm} stroke="#e0007a" strokeWidth={0.25}
        strokeDasharray="1 1" pointerEvents="none" data-testid="paper-guide" data-axis="x" data-kind={guide.kind} />
      : <line key={index} className={styles.paperOutline} y1={guide.value} y2={guide.value} x1={0} x2={sheet.paper.widthMm} stroke="#e0007a" strokeWidth={0.25}
        strokeDasharray="1 1" pointerEvents="none" data-testid="paper-guide" data-axis="y" data-kind={guide.kind} />)}
    {marquee && <rect className={styles.paperOutline} x={Math.min(marquee.x0, marquee.x1)} y={Math.min(marquee.y0, marquee.y1)} width={Math.abs(marquee.x1 - marquee.x0)}
      height={Math.abs(marquee.y1 - marquee.y0)} fill="rgba(29, 111, 209, .08)" stroke="#1d6fd1" strokeWidth={0.3} strokeDasharray="1 1" pointerEvents="none"
      data-testid="paper-marquee" />}
    {editing && active.onText && <TextEditor item={editing} source={active.textOf?.(editing)} onDone={value => { setEditing(undefined); if (value !== undefined) active.onText?.(editing, value); }} />}
  </>;
}

function PaperItemView({ sheet, item, interaction, selected, onGuides, onEdit }: { sheet: Sheet; item: SheetPaperItem; interaction: PaperInteraction; selected: boolean;
  onGuides: (guides: readonly SnapGuide[]) => void; onEdit: (() => void) | undefined }) {
  const [drag, setDrag] = useState<{ dx: number; dy: number; dw: number; dh: number }>();
  const start = useRef<{ x: number; y: number; mode: "move" | "resize" }>(undefined);
  const editable = interaction.editable && !item.locked;
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
    // Skift-klick lägger till eller tar bort ur markeringen; ett klick på ett markerat behåller gruppen.
    if (event.shiftKey) { interaction.onSelect({ course: item.course, id: item.id }, true); return; }
    if (!selected) interaction.onSelect({ course: item.course, id: item.id });
    capture(event.currentTarget, event.pointerId);
    const at = paperPoint(event);
    start.current = { x: at.x, y: at.y, mode };
    setDrag({ dx: 0, dy: 0, dw: 0, dh: 0 });
  };
  const move = (event: PointerEvent<SVGElement>) => {
    const from = start.current;
    if (!from) return;
    const at = paperPoint(event);
    if (from.mode === "move") {
      const raw = { dx: at.x - from.x, dy: at.y - from.y };
      const snap = interaction.snap;
      // Alt stänger av fästningen; rutnätet gäller utan fästlinje.
      if (snap && !event.altKey && (snap.enabled || snap.gridMm > 0)) {
        const exclude = new Set([...(interaction.selection ?? []).map(keyOf), keyOf(item)]);
        const result = snapMove(item.rect, raw.dx, raw.dy, snap.enabled ? snapTargets(sheet, exclude) : { x: [], y: [] }, { gridMm: snap.gridMm });
        onGuides(result.guides);
        setDrag({ dx: result.dx, dy: result.dy, dw: 0, dh: 0 });
      } else { onGuides([]); setDrag({ ...raw, dw: 0, dh: 0 }); }
    } else setDrag({ dx: 0, dy: 0, dw: at.x - from.x, dh: at.y - from.y });
  };
  const up = () => {
    const current = drag, mode = start.current?.mode;
    start.current = undefined;
    setDrag(undefined);
    onGuides([]);
    if (!current) return;
    if (mode === "move" && (Math.abs(current.dx) > 0.2 || Math.abs(current.dy) > 0.2)) interaction.onMove(sheet, item, current.dx, current.dy);
    if (mode === "resize" && (Math.abs(current.dw) > 0.2 || Math.abs(current.dh) > 0.2)) {
      // Bilden behåller proportionerna: bredden följer handtaget.
      interaction.onResize(sheet, item, Math.max(item.kind === "LINE" ? 0 : 2, item.rect.width + current.dw), Math.max(item.kind === "LINE" ? 0 : 2, item.rect.height + current.dh));
    }
  };
  const key = (event: KeyboardEvent<SVGGElement>) => {
    if (!editable) return;
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); interaction.onDelete(item); return; }
    if (event.key === "Escape") { interaction.onSelect(undefined); return; }
    if (event.key === "Enter" && onEdit) { event.preventDefault(); onEdit(); return; }
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
  const free = item.kind === "RECT" || item.kind === "LINE";
  const sy = item.kind === "TEXT" || item.kind === "SCALE_BAR" ? 1 : item.kind === "NORTH_ARROW" || free
    ? Math.max(0.1, item.rect.height > 0 ? (item.rect.height + shown.dh) / item.rect.height : 1) : sx;
  const scaleX = item.kind === "NORTH_ARROW" ? sy : sx;
  const transform = `translate(${shown.dx} ${shown.dy})` + (drag && (shown.dw || shown.dh)
    ? ` translate(${item.rect.x} ${item.rect.y}) scale(${scaleX} ${sy}) translate(${-item.rect.x} ${-item.rect.y})` : "");
  const r = item.rect;
  // En linje utan höjd (eller bredd) får en träffyta på 2 mm.
  const hit = { x: r.x - (r.width < 2 ? 1 : 0), y: r.y - (r.height < 2 ? 1 : 0), width: Math.max(2, r.width), height: Math.max(2, r.height) };
  return <g transform={transform} data-testid="paper-item" data-kind={item.kind} data-id={item.id} data-course={item.course} data-source={item.source}
    data-selected={selected ? "" : undefined} data-locked={item.locked ? "" : undefined}
    {...(editable ? { tabIndex: 0, role: "button", "aria-label": text.dragLabel(label), "aria-pressed": selected, onKeyDown: key, className: styles.paperDescription } : {})}>
    {item.parts.map((part, index) => <Part key={index} part={part} imageUrl={interaction.imageUrl} />)}
    {editable && <rect {...hit} fill="transparent" onPointerDown={down("move")} onPointerMove={move}
      onPointerUp={up} onPointerCancel={up} onDoubleClick={onEdit ? event => { event.stopPropagation(); onEdit(); } : undefined}
      style={{ cursor: drag ? "grabbing" : "grab", touchAction: "none" }} />}
    {editable && selected && <>
      <rect className={styles.paperOutline} x={r.x} y={r.y} width={r.width} height={r.height} fill="none" stroke="#1d6fd1" strokeWidth={0.4}
        strokeDasharray="1.5 1" pointerEvents="none" />
      <rect className={styles.paperOutline} x={r.x + r.width - 2} y={r.y + r.height - 2} width={4} height={4} fill="#1d6fd1" stroke="#fff" strokeWidth={0.3}
        style={{ cursor: "nwse-resize", touchAction: "none" }} data-testid="paper-item-resize" aria-label={text.resizeLabel}
        onPointerDown={down("resize")} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
    </>}
  </g>;
}

/**
 * Texten skrivs direkt på arket (dubbelklick): en ruta över texten med variablerna, storleken och fet nära markeringen.
 * Ctrl+Enter eller Klar sparar, Escape avbryter. Storlek och fet sparas genom panelens fält (samma element).
 */
function TextEditor({ item, source: raw, onDone }: { item: SheetPaperItem; source: string | undefined; onDone: (value: string | undefined) => void }) {
  const anchor = useRef<SVGRectElement>(null);
  const [box, setBox] = useState<DOMRect>();
  const source = raw ?? item.parts.filter((part): part is Extract<PaperPart, { kind: "text" }> => part.kind === "text").map(part => part.text).join("\n");
  const [value, setValue] = useState<string>();
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // Texten mitt i fönstret först, så att rutan med verktygen syns (den står fast i fönstret vid texten).
    anchor.current?.scrollIntoView({ block: "center", inline: "nearest" });
    const place = () => setBox(anchor.current?.getBoundingClientRect());
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, []);
  const shown = box !== undefined;
  useEffect(() => { if (shown) { area.current?.focus(); area.current?.select(); } }, [shown]);
  const commit = () => onDone(value ?? undefined);
  return <>
    <rect ref={anchor} x={item.rect.x} y={item.rect.y} width={Math.max(10, item.rect.width)} height={Math.max(5, item.rect.height)} fill="none" pointerEvents="none" />
    {box && typeof window !== "undefined" && createPortal(<div className={styles.textEditor} role="dialog" aria-label={text.editor.editText} data-testid="paper-text-editor"
      style={{ left: Math.max(4, Math.min(box.left, window.innerWidth - 228)), top: Math.max(4, Math.min(box.top, window.innerHeight - 180)),
        width: Math.min(window.innerWidth - 8, Math.max(220, box.width)) }}>
      <textarea ref={area} rows={Math.max(2, (value ?? source).split("\n").length)} defaultValue={source} maxLength={400} data-testid="paper-text-inplace"
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); onDone(undefined); }
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); }
        }} />
      <div className={styles.textEditorBar}>
        <label>{text.variables}<select value="" data-testid="paper-text-inplace-variable" onChange={event => {
          if (!event.target.value || !area.current) return;
          const field = area.current, at = field.selectionStart ?? field.value.length;
          const next = `${field.value.slice(0, at)}{${event.target.value}}${field.value.slice(field.selectionEnd ?? at)}`;
          field.value = next; setValue(next); field.focus();
        }}><option value="">…</option>{PAPER_VARIABLES.map(name => <option key={name} value={name}>{`{${name}}`}</option>)}</select></label>
        <button type="button" onClick={commit} data-testid="paper-text-inplace-done">{text.editor.done}</button>
        <button type="button" onClick={() => onDone(undefined)}>{text.editor.cancel}</button>
      </div>
    </div>, window.document.body)}
  </>;
}

/** Hörnen (klippningen eller en vit yta) i ramen: dras med musen eller fingret (bara på skärmen). */
function PointHandles({ frame, points, onPoint, testId, handleId, label }: { frame: { x: number; y: number; width: number; height: number };
  points: readonly { x: number; y: number }[]; onPoint?: ((index: number, point: { x: number; y: number }) => void) | undefined;
  testId: string; handleId: string; label: (index: number) => string }) {
  const [drag, setDrag] = useState<{ index: number; x: number; y: number }>();
  const paperPoint = (event: PointerEvent<SVGElement>) => {
    const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM()?.inverse();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix) : { x: 0, y: 0 };
  };
  const shown = points.map((p, index) => drag?.index === index ? { x: drag.x, y: drag.y } : p);
  const round = (value: number) => Math.round(value * 10) / 10;
  return <g className={styles.paperOutline} data-testid={testId}>
    <polygon points={shown.map(p => `${frame.x + p.x},${frame.y + p.y}`).join(" ")} fill="none" stroke="#1d6fd1" strokeWidth={0.4} strokeDasharray="2 1"
      pointerEvents="none" />
    {shown.map((p, index) => <rect key={index} x={frame.x + p.x - 2} y={frame.y + p.y - 2} width={4} height={4} fill="#1d6fd1" stroke="#fff" strokeWidth={0.3}
      style={{ cursor: "move", touchAction: "none" }} data-testid={handleId} aria-label={label(index + 1)}
      onPointerDown={event => { event.stopPropagation(); event.preventDefault(); capture(event.currentTarget, event.pointerId);
        const at = paperPoint(event); setDrag({ index, x: at.x - frame.x, y: at.y - frame.y }); }}
      onPointerMove={event => { if (drag?.index !== index) return; const at = paperPoint(event); setDrag({ index, x: at.x - frame.x, y: at.y - frame.y }); }}
      onPointerUp={() => { if (drag?.index === index) onPoint?.(index, { x: round(drag.x), y: round(drag.y) }); setDrag(undefined); }}
      onPointerCancel={() => setDrag(undefined)} />)}
  </g>;
}
