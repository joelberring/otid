"use client";

import { passesKey, type Sheet, type SheetFrame } from "@o-tid/course-setting";
import { coursePrintSv as text } from "../../i18n/course-setting-print-sv";
import { DESCRIPTION_FONT, descriptionNodes, type SymbolLookup } from "../../lib/course-setting-description-draw";
import { pageName, pageNodes, type PrintNode } from "../../lib/course-setting-print";
import { DescriptionShapes } from "./description-svg";
import styles from "./course-setting-print-page.module.css";

/** Nyckeln för en rams kartbild (samma utsnitt, skala och färger ritas en gång). */
export function frameImageKey(frame: Pick<SheetFrame, "mapArea" | "clip" | "transform" | "mapPasses">, colors: string): string {
  return `${frame.mapArea.minX.toFixed(3)},${frame.mapArea.maxY.toFixed(3)},${frame.clip.width.toFixed(2)},${frame.clip.height.toFixed(2)},`
    + `${frame.transform.scale.toFixed(6)}|${colors}${frame.mapPasses ? `|${passesKey(frame.mapPasses)}` : ""}`;
}

/**
 * Steg 64: ett ark (`Sheet` ur `layoutCoursePage`/`layoutTemplateSheets`) som SVG i papperets mm: per kartram kartbilden
 * och banpåtrycket klippta till ramen, sedan vita ytor (remsan), logotyper, beskrivningar, texter och skärmarker, och
 * raden om att det är ett utkast. Webbläsarens utskrift ger ett ark per sida (`@page` per pappersstorlek).
 */
export function SheetView({ sheet, index, symbols, images, colorsKey, courseColor, label }: {
  sheet: Sheet; index: number; symbols: SymbolLookup; images: Readonly<Record<string, string>>; colorsKey: string; courseColor?: string | undefined;
  label: string;
}) {
  const { paper } = sheet;
  const ready = sheet.frames.every(frame => images[frameImageKey(frame, colorsKey)]);
  return <svg className={styles.sheet} role="img" aria-label={label} data-testid="print-sheet" data-back={sheet.back ? "" : undefined}
    data-course={sheet.frames[0]?.course} data-variant={sheet.frames[0]?.variant ?? ""} data-frames={sheet.frames.length}
    data-map={ready ? "ready" : "waiting"} data-scale={sheet.frames[0]?.printScale}
    width={`${paper.widthMm}mm`} height={`${paper.heightMm}mm`} viewBox={`0 0 ${paper.widthMm} ${paper.heightMm}`} style={{ page: pageName(sheet) }}>
    <rect width={paper.widthMm} height={paper.heightMm} fill="#fff" />
    {sheet.frames.map((frame, frameIndex) => <FrameView key={frameIndex} id={`s${index}f${frameIndex}`} frame={frame} symbols={symbols}
      image={images[frameImageKey(frame, colorsKey)]} courseColor={courseColor} />)}
    {sheet.boxes.map((box, boxIndex) => <rect key={boxIndex} x={box.x} y={box.y} width={box.width} height={box.height} fill="#fff"
      stroke={box.border ? "#000" : undefined} strokeWidth={box.border ? 0.25 : undefined} data-testid="print-strip" />)}
    {sheet.images.map((image, imageIndex) => <image key={imageIndex} href={`data:${image.mediaType};base64,${image.data}`} x={image.x} y={image.y}
      width={image.width} height={image.height} preserveAspectRatio="xMidYMid meet" data-testid="print-logo" />)}
    {sheet.descriptions.map((item, descriptionIndex) => <g key={descriptionIndex} transform={`translate(${item.x} ${item.y})`} data-testid="print-description"
      fontFamily={DESCRIPTION_FONT}><rect width={item.layout.widthMm} height={item.layout.heightMm} fill="#fff" />
      <DescriptionShapes nodes={descriptionNodes(item.layout, symbols)} /></g>)}
    {sheet.texts.map((item, textIndex) => <text key={textIndex} x={item.at.x} y={item.at.y} fontSize={item.heightMm} fontWeight={item.bold ? "bold" : undefined}
      textAnchor={item.align === "left" ? "start" : item.align === "right" ? "end" : "middle"} fill={item.color === "COURSE" ? courseColor ?? "rgb(204, 0, 255)" : "#000"}
      transform={item.rotation ? `rotate(${item.rotation} ${item.at.x} ${item.at.y})` : undefined}
      fontFamily="Arial, Helvetica, sans-serif" data-testid="print-text">{item.text}</text>)}
    {sheet.cutMarks.map((mark, markIndex) => <line key={markIndex} x1={mark.x1} y1={mark.y1} x2={mark.x2} y2={mark.y2} stroke="#000" strokeWidth={0.15} />)}
    {!sheet.back && <text x={Math.max(2, paper.marginMm)} y={paper.heightMm - Math.max(1.2, paper.marginMm / 3)} fontSize={2} fill="#777"
      fontFamily="Arial, Helvetica, sans-serif">{text.page.draft}</text>}
  </svg>;
}

function FrameView({ id, frame, symbols, image, courseColor }: { id: string; frame: SheetFrame; symbols: SymbolLookup; image: string | undefined;
  courseColor?: string | undefined }) {
  const { clip } = frame;
  const nodes = pageNodes(frame, symbols, courseColor);
  return <g data-testid="print-frame" data-course={frame.course}>
    <defs><clipPath id={id}><rect x={clip.x} y={clip.y} width={clip.width} height={clip.height} /></clipPath></defs>
    {image && <image href={image} x={clip.x} y={clip.y} width={clip.width} height={clip.height} preserveAspectRatio="none" data-testid="print-map"
      data-mirror={frame.mirror ? "" : undefined}
      transform={frame.mirror ? `translate(${2 * clip.x + clip.width} 0) scale(-1 1)` : undefined} />}
    <g clipPath={`url(#${id})`} data-testid="print-overprint">{nodes.map((node, index) => <Node key={index} node={node} />)}</g>
  </g>;
}

function Node({ node }: { node: PrintNode }) {
  switch (node.tag) {
    case "path": return <path d={node.d} fill={node.fill ?? "none"} fillRule="evenodd" stroke={node.stroke} strokeWidth={node.width} strokeDasharray={node.dash}
      strokeLinecap={node.cap} strokeLinejoin="round" opacity={node.opacity} data-ref={node.ref} data-role={node.role} />;
    case "text": return <text x={node.x} y={node.y} fontSize={node.size} fill={node.fill} textAnchor={node.anchor} dominantBaseline="middle"
      fontFamily={node.family} fontWeight={node.bold ? "bold" : undefined} fontStyle={node.italic ? "italic" : undefined} data-ref={node.ref} data-role={node.role}>{node.text}</text>;
    case "image": return <image href={node.href} x={node.x} y={node.y} width={node.width} height={node.height} preserveAspectRatio="none" data-ref={node.ref} />;
    case "description": return <g transform={`translate(${node.x} ${node.y}) scale(${node.scale})`} data-ref={node.ref} data-role="SPECIAL" data-testid="print-description">
      <DescriptionShapes nodes={node.nodes} /></g>;
  }
}
