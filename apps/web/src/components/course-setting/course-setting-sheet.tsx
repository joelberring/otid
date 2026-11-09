"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { coursePrintEn } from "../../i18n/course-setting-print-en";
import { useTexts } from "../language-provider";
import { courseLayerOf, passesKey, type PaperRect, type Sheet, type SheetDescription, type SheetFrame } from "@o-tid/course-setting";
import type { PressLayers } from "../../lib/course-setting-press-layers";
import { coursePrintSv } from "../../i18n/course-setting-print-sv";
import { DESCRIPTION_FONT, descriptionNodes, type SymbolLookup } from "../../lib/course-setting-description-draw";
import { pageName, pageNodes, type PrintNode } from "../../lib/course-setting-print";
import { DescriptionShapes } from "./description-svg";
import { PaperHandlesLayer, PaperItemsLayer, type PaperInteraction } from "./course-setting-paper-items";
import styles from "./course-setting-print-page.module.css";

/** Nyckeln för en rams kartbild (samma utsnitt, skala och färger ritas en gång). */
export function frameImageKey(frame: Pick<SheetFrame, "mapArea" | "clip" | "transform" | "mapPasses">, colors: string): string {
  return `${frame.mapArea.minX.toFixed(3)},${frame.mapArea.maxY.toFixed(3)},${frame.clip.width.toFixed(2)},${frame.clip.height.toFixed(2)},`
    + `${frame.transform.scale.toFixed(6)}|${colors}${frame.mapPasses ? `|${passesKey(frame.mapPasses)}` : ""}`;
}

/**
 * Steg 64: ett ark (`Sheet` ur `layoutCoursePage`/`sheetLayoutSheets`) som SVG i papperets mm: per kartram kartbilden
 * och banpåtrycket klippta till ramen, sedan vita ytor (remsan), logotyper, beskrivningar, texter och skärmarker, och
 * raden om att det är ett utkast. Webbläsarens utskrift ger ett ark per sida (`@page` per pappersstorlek).
 */
export function SheetView({ sheet, index, symbols, images, colorsKey, courseColor, label, onPlace, paper, pressLayers, testId = "print-sheet" }: {
  sheet: Sheet; index: number; symbols: SymbolLookup; images: Readonly<Record<string, string>>; colorsKey: string; courseColor?: string | undefined;
  label: string;
  /** Papperet (ägaren 2026-11-03): beskrivningen dras och ändras i storlek här; ger rutans nya läge och rutstorlek. */
  onPlace?: ((description: SheetDescription, frame: SheetFrame, rect: PaperRect, boxMm: number) => void) | undefined;
  /** Papperets element (ADR-0197): markeras, dras och ändras här. */
  paper?: PaperInteraction | undefined;
  /** Normens färgordning (ADR-0211 beslut 3): kartan i två bilder med banans undre lila mellan och övre lila överst. */
  pressLayers?: PressLayers | undefined;
  /** Översiktens små bilder har ett eget testid (inte "print-sheet"). */
  testId?: string | undefined;
}) {
  const text = useTexts(coursePrintSv, coursePrintEn);
  const sheetPaper = sheet.paper;
  const ready = sheet.frames.every(frame => images[frameImageKey(frame, colorsKey)] && (!pressLayers || (images[`${frameImageKey(frame, colorsKey)}|OVER`]
    && (pressLayers.overWhite.length === 0 || images[`${frameImageKey(frame, colorsKey)}|OVERWHITE`]))));
  return <svg className={styles.sheet} role="img" aria-label={label} data-testid={testId} data-back={sheet.back ? "" : undefined}
    data-course={sheet.frames[0]?.course} data-variant={sheet.frames[0]?.variant ?? ""} data-frames={sheet.frames.length}
    data-map={ready ? "ready" : "waiting"} data-scale={sheet.frames[0]?.printScale}
    width={`${sheetPaper.widthMm}mm`} height={`${sheetPaper.heightMm}mm`} viewBox={`0 0 ${sheetPaper.widthMm} ${sheetPaper.heightMm}`} style={{ page: pageName(sheet) }}>
    <rect width={sheetPaper.widthMm} height={sheetPaper.heightMm} fill="#fff" />
    {sheet.frames.map((frame, frameIndex) => <FrameView key={frameIndex} id={`s${index}f${frameIndex}`} frame={frame} symbols={symbols}
      image={images[frameImageKey(frame, colorsKey)]} overImage={pressLayers ? images[`${frameImageKey(frame, colorsKey)}|OVER`] : undefined}
      overWhiteImage={pressLayers ? images[`${frameImageKey(frame, colorsKey)}|OVERWHITE`] : undefined}
      layers={pressLayers} courseColor={courseColor} />)}
    {sheet.boxes.map((box, boxIndex) => <rect key={boxIndex} x={box.x} y={box.y} width={box.width} height={box.height} fill="#fff"
      stroke={box.border ? "#000" : undefined} strokeWidth={box.border ? 0.25 : undefined} data-testid="print-strip" />)}
    {sheet.images.map((image, imageIndex) => <image key={imageIndex} href={`data:${image.mediaType};base64,${image.data}`} x={image.x} y={image.y}
      width={image.width} height={image.height} preserveAspectRatio="xMidYMid meet" data-testid="print-logo" />)}
    {/* Klick på tomt papper (kartan räknas som papper här) släpper markeringen; en ruta markerar flera (PaperItemsLayer). */}
    <PaperItemsLayer sheet={sheet} interaction={paper} />
    {sheet.descriptions.map((item, descriptionIndex) => <PaperDescription key={descriptionIndex} item={item} symbols={symbols}
      frame={sheet.frames[item.frame]} onPlace={onPlace} />)}
    {sheet.texts.map((item, textIndex) => <text key={textIndex} x={item.at.x} y={item.at.y} fontSize={item.heightMm} fontWeight={item.bold ? "bold" : undefined}
      textAnchor={item.align === "left" ? "start" : item.align === "right" ? "end" : "middle"} fill={item.color === "COURSE" ? courseColor ?? "rgb(204, 0, 255)" : "#000"}
      transform={item.rotation ? `rotate(${item.rotation} ${item.at.x} ${item.at.y})` : undefined}
      fontFamily="Arial, Helvetica, sans-serif" data-testid="print-text">{item.text}</text>)}
    <PaperHandlesLayer sheet={sheet} interaction={paper} />
    {sheet.cutMarks.map((mark, markIndex) => <line key={markIndex} x1={mark.x1} y1={mark.y1} x2={mark.x2} y2={mark.y2} stroke="#000" strokeWidth={0.15} />)}
    {!sheet.back && <text x={Math.max(2, sheetPaper.marginMm)} y={sheetPaper.heightMm - Math.max(1.2, sheetPaper.marginMm / 3)} fontSize={2} fill="#777"
      fontFamily="Arial, Helvetica, sans-serif">{text.page.draft}</text>}
  </svg>;
}

function FrameView({ id, frame, symbols, image, overImage, overWhiteImage, layers, courseColor }: { id: string; frame: SheetFrame; symbols: SymbolLookup;
  image: string | undefined; overImage?: string | undefined; overWhiteImage?: string | undefined; layers?: PressLayers | undefined; courseColor?: string | undefined }) {
  const { clip } = frame;
  const nodes = pageNodes(frame, symbols, courseColor);
  // Figurerna och noderna står i samma ordning (`pageNodes`): vita specialobjekt och bilder och undre lila mellan kartans två
  // bilder, övre lila överst (som PDF:en, `courseLayerOf`).
  const layer = layers ? frame.figures.map(figure => courseLayerOf(figure, layers.norm, layers.numbersOnTop)) : undefined;
  // Papperets klippning (ADR-0197): specialobjekten i `markingClip.refs` klipps till polygonen; banan står hel.
  const marked = new Set(frame.markingClip?.refs ?? []);
  const white = frame.whiteAreas ?? [];
  const isSpecial = (node: PrintNode) => node.tag !== "description" && "role" in node && node.role === "SPECIAL" && node.ref !== undefined;
  const isMarking = (node: PrintNode) => isSpecial(node) && marked.has(node.ref!);
  // "Vitt på utskriften" (ADR-0211 beslut 8): ytorna vita över kartan; kartan över banan och markeringarna klipps bort där.
  const whitePath = white.map(polygon => `M${polygon.map(p => `${p.x} ${p.y}`).join(" L")} Z`).join(" ");
  // Ytorna som vita specialobjekt och bilder täcker (papperets klippning gäller dem också).
  const covers = layer ? nodes.flatMap((node, index) => layer[index] === "BENEATH" ? [{ node, index }] : []) : [];
  const mirror = frame.mirror ? `translate(${2 * clip.x + clip.width} 0) scale(-1 1)` : undefined;
  const draw = (keep: (index: number) => boolean) => nodes.map((node, index) => {
    if (!keep(index)) return null;
    const inner = isMarking(node) ? <g clipPath={`url(#${id}m)`} data-testid="print-marking-clipped"><Node node={node} /></g> : <Node node={node} />;
    return white.length > 0 && isSpecial(node) ? <g key={index} clipPath={`url(#${id}w)`} data-testid="print-marking-white">{inner}</g>
      : isMarking(node) ? <g key={index} clipPath={`url(#${id}m)`} data-testid="print-marking-clipped"><Node node={node} /></g> : <Node key={index} node={node} />;
  });
  return <g data-testid="print-frame" data-course={frame.course} data-marking-clip={frame.markingClip ? "" : undefined} data-norm={layers?.norm}>
    <defs><clipPath id={id}><rect x={clip.x} y={clip.y} width={clip.width} height={clip.height} /></clipPath>
      {frame.markingClip && <clipPath id={`${id}m`}><polygon points={frame.markingClip.polygon.map(p => `${p.x},${p.y}`).join(" ")} /></clipPath>}
      {white.length > 0 && <clipPath id={`${id}w`}><path clipRule="evenodd" d={`M${clip.x} ${clip.y} h${clip.width} v${clip.height} h${-clip.width} Z ${whitePath}`} /></clipPath>}
      {covers.length > 0 && <mask id={`${id}c`} maskUnits="userSpaceOnUse" x={clip.x} y={clip.y} width={clip.width} height={clip.height}>
        <rect x={clip.x} y={clip.y} width={clip.width} height={clip.height} fill="#fff" />
        {covers.map(({ node, index }) => {
          const shape = node.tag === "image" ? <rect x={node.x} y={node.y} width={node.width} height={node.height} fill="#000" />
            : node.tag === "path" ? <path d={node.d} fill="#000" fillRule="evenodd" /> : null;
          return <g key={index} clipPath={isMarking(node) ? `url(#${id}m)` : undefined}>{shape}</g>;
        })}</mask>}</defs>
    {image && <image href={image} x={clip.x} y={clip.y} width={clip.width} height={clip.height} preserveAspectRatio="none" data-testid="print-map"
      data-mirror={frame.mirror ? "" : undefined} transform={mirror} />}
    {white.length > 0 && <path d={whitePath} fill="#fff" clipPath={`url(#${id})`} data-testid="print-white-area" />}
    {layer ? <>
      {/* Vita specialobjekt och bilder under banan (ligger över hela kartan: kartans bild över banan maskas bort i dem). */}
      {covers.length > 0 && <g clipPath={`url(#${id})`} data-testid="print-overprint-beneath" data-layer="beneath">{draw(index => layer[index] === "BENEATH")}</g>}
      <g clipPath={`url(#${id})`} data-testid="print-overprint" data-layer="lower">{draw(index => layer[index] === "LOWER")}</g>
      {/* Kartans färger över banan multipliceras, som övertryck på tryck: lila syns genom dem. Vitt över banan slår ut. */}
      <g mask={covers.length > 0 ? `url(#${id}c)` : undefined} data-testid="print-map-over-layer">
        {overWhiteImage && <g clipPath={white.length > 0 ? `url(#${id}w)` : undefined}><image href={overWhiteImage} x={clip.x} y={clip.y} width={clip.width}
          height={clip.height} preserveAspectRatio="none" data-testid="print-map-over-white" transform={mirror} /></g>}
        {overImage && <g clipPath={white.length > 0 ? `url(#${id}w)` : undefined}><image href={overImage} x={clip.x} y={clip.y} width={clip.width} height={clip.height}
          preserveAspectRatio="none" data-testid="print-map-over" style={{ mixBlendMode: "multiply" }} transform={mirror} /></g>}
      </g>
      <g clipPath={`url(#${id})`} data-testid="print-overprint-upper" data-layer="upper">{draw(index => layer[index] === "UPPER")}</g>
    </> : <g clipPath={`url(#${id})`} data-testid="print-overprint">{draw(() => true)}</g>}
  </g>;
}

function Node({ node }: { node: PrintNode }) {
  switch (node.tag) {
    case "path": return <path d={node.d} fill={node.fill ?? "none"} fillRule="evenodd" stroke={node.stroke} strokeWidth={node.width} strokeDasharray={node.dash}
      strokeLinecap={node.cap} strokeLinejoin="round" opacity={node.opacity} data-ref={node.ref} data-role={node.role} />;
    case "text": return <text x={node.x} y={node.y} fontSize={node.size} fill={node.fill} textAnchor={node.anchor} dominantBaseline="middle" opacity={node.opacity}
      fontFamily={node.family} fontWeight={node.bold ? "bold" : undefined} fontStyle={node.italic ? "italic" : undefined} data-ref={node.ref} data-role={node.role}>{node.text}</text>;
    case "image": return <image href={node.href} x={node.x} y={node.y} width={node.width} height={node.height} preserveAspectRatio="none" data-ref={node.ref} />;
    case "description": return <g transform={`translate(${node.x} ${node.y}) scale(${node.scale})`} data-ref={node.ref} data-role="SPECIAL" data-testid="print-description">
      <DescriptionShapes nodes={node.nodes} /></g>;
  }
}

const KEY_STEP_MM = 1;

/**
 * Kontrollbeskrivningen på arket. Med `onPlace`: dra den (mus, finger) eller flytta med piltangenterna (1 mm, Skift 5 mm),
 * och ändra storleken i handtaget nere till höger. Medan den dras visas den där den hamnar; läget sparas när den släpps.
 */
function PaperDescription({ item, symbols, frame, onPlace }: { item: SheetDescription; symbols: SymbolLookup; frame: SheetFrame | undefined;
  onPlace?: ((description: SheetDescription, frame: SheetFrame, rect: PaperRect, boxMm: number) => void) | undefined }) {
  const text = useTexts(coursePrintSv, coursePrintEn);
  const [drag, setDrag] = useState<{ dx: number; dy: number; scale: number }>();
  const start = useRef<{ x: number; y: number; mode: "move" | "resize" }>(undefined);
  const editable = Boolean(onPlace && frame && item.boxMm);
  const box = item.boxMm ?? 5;
  const width = item.layout.widthMm, height = item.layout.heightMm;
  const place = (dx: number, dy: number, scale: number) => {
    if (!onPlace || !frame) return;
    onPlace(item, frame, { x: item.x + dx, y: item.y + dy, width: width * scale, height: height * scale }, Math.round(box * scale * 2) / 2);
  };
  const paperPoint = (event: PointerEvent<SVGElement>) => {
    const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM()?.inverse();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix) : { x: 0, y: 0 };
  };
  const down = (mode: "move" | "resize") => (event: PointerEvent<SVGElement>) => {
    if (!editable) return;
    event.stopPropagation(); event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = paperPoint(event);
    start.current = { x: at.x, y: at.y, mode };
    setDrag({ dx: 0, dy: 0, scale: 1 });
  };
  const move = (event: PointerEvent<SVGElement>) => {
    const from = start.current;
    if (!from) return;
    const at = paperPoint(event);
    if (from.mode === "move") setDrag({ dx: at.x - from.x, dy: at.y - from.y, scale: 1 });
    else {
      // Storleken följer handtaget; rutan 3–10 mm.
      const scale = Math.max(3 / box, Math.min(10 / box, (width + at.x - from.x) / width));
      setDrag({ dx: 0, dy: 0, scale });
    }
  };
  const up = () => {
    const current = drag;
    start.current = undefined;
    setDrag(undefined);
    if (current && (Math.abs(current.dx) > 0.2 || Math.abs(current.dy) > 0.2 || Math.abs(current.scale - 1) > 0.01)) place(current.dx, current.dy, current.scale);
  };
  const key = (event: KeyboardEvent<SVGGElement>) => {
    const step = event.shiftKey ? 5 * KEY_STEP_MM : KEY_STEP_MM;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    place(delta[0], delta[1], 1);
  };
  const shown = drag ?? { dx: 0, dy: 0, scale: 1 };
  const warn = (item.overlaps ?? 0) > 0;
  return <g transform={`translate(${item.x + shown.dx} ${item.y + shown.dy}) scale(${shown.scale})`} data-testid="print-description" data-course={item.course}
    data-source={item.source} data-overlaps={item.overlaps ?? 0} fontFamily={DESCRIPTION_FONT}
    {...(editable ? { tabIndex: 0, role: "button", "aria-label": text.paper.dragLabel, onKeyDown: key, className: styles.paperDescription } : {})}>
    <rect width={width} height={height} fill="#fff" onPointerDown={down("move")} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      style={editable ? { cursor: drag ? "grabbing" : "grab" } : undefined} />
    <g pointerEvents="none"><DescriptionShapes nodes={descriptionNodes(item.layout, symbols)} /></g>
    {editable && <>
      {/* Ramen visar att rutan går att flytta (bara på skärmen, inte i utskriften). */}
      <rect className={styles.paperOutline} width={width} height={height} fill="none" stroke={warn ? "#b00020" : "#1d6fd1"} strokeWidth={0.4 / shown.scale}
        strokeDasharray={`${1.5 / shown.scale} ${1 / shown.scale}`} pointerEvents="none" />
      <rect className={styles.paperOutline} x={width - 2.5 / shown.scale} y={height - 2.5 / shown.scale} width={4 / shown.scale} height={4 / shown.scale}
        fill="#1d6fd1" stroke="#fff" strokeWidth={0.3 / shown.scale} style={{ cursor: "nwse-resize" }} data-testid="print-description-resize"
        onPointerDown={down("resize")} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
    </>}
  </g>;
}
