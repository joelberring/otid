"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { controlMapSv as text } from "../../i18n/control-map-sv";
import { scaleBar, type ControlMapView, type XY } from "../../lib/control-map";
import styles from "./control-map.module.css";

export type ControlTone = "normal" | "dim" | "course" | "ok" | "missing" | "wrong" | "neutral";

export interface DrawnControl {
  readonly key: string;
  readonly code: number;
  readonly at: XY;
  readonly tone: ControlTone;
  /** Belastningens nivå 1–3 (ger färg); 0 eller saknas = ingen. */
  readonly level?: 0 | 1 | 2 | 3;
  readonly radius?: number;
  readonly outOfOrder?: boolean;
  /** Text bredvid ringen: kontrollens nummer i banan eller koden. */
  readonly label?: { readonly at: XY; readonly text: string } | undefined;
  readonly title: string;
}
export interface DrawnLine { readonly key: string; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly tone: "course" | "dim" }
export interface DrawnEnd { readonly key: string; readonly at: XY; readonly kind: "START" | "FINISH"; readonly tone: "course" | "dim" }

/**
 * Steg 52 (ADR-0176): kontrollkartan som SVG. Kartbilden under (beskuren till utsnittet), sträckorna, kontrollerna som
 * ringar, starttriangel och målring, och en skalstock. Bara färgtoken. Bilden skalar med bredden; sidan rullar aldrig i sidled.
 */
export function ControlMapSvg({ view, image, controls, lines, ends, metersPerUnit, label, children }: {
  view: ControlMapView; image?: { href: string; width: number; height: number } | undefined;
  controls: readonly DrawnControl[]; lines: readonly DrawnLine[]; ends: readonly DrawnEnd[];
  metersPerUnit: number | null; label: string; children?: ReactNode;
}) {
  // Texten och strecken hålls läsbara när bilden är smal (mobilen): minst 11 px text och 1,5 px streck på skärmen.
  const svg = useRef<SVGSVGElement>(null);
  const [pixels, setPixels] = useState<number>();
  useEffect(() => {
    const element = svg.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setPixels(element.getBoundingClientRect().width || undefined));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const perPixel = pixels ? view.width / pixels : 0;
  const fontSize = Math.max(view.fontSize, perPixel * 11);
  const radius = view.radius;
  const bar = scaleBar(metersPerUnit, view.width);
  const stroke = Math.max(radius * 0.22, perPixel * 1.5);
  return <svg ref={svg} className={styles.svg} viewBox={view.viewBox} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet"
    style={{ aspectRatio: `${view.width} / ${view.height}` }}>
    <title>{label}</title>
    <rect className={styles.paper} x={view.x} y={view.y} width={view.width} height={view.height} />
    {image && <image className={styles.image} href={image.href} x={0} y={0} width={image.width} height={image.height} />}
    <g style={{ strokeWidth: stroke }}>
      {lines.map(line => <line key={line.key} className={styles.leg} data-tone={line.tone} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />)}
      {ends.map(end => end.kind === "START"
        ? <polygon key={end.key} className={styles.end} data-tone={end.tone} points={triangle(end.at, radius * 1.3)}><title>{text.start}</title></polygon>
        : <g key={end.key} className={styles.end} data-tone={end.tone}><title>{text.finish}</title>
          <circle cx={end.at.x} cy={end.at.y} r={radius * 1.05} /><circle cx={end.at.x} cy={end.at.y} r={radius * 0.7} /></g>)}
      {controls.map(control => <g key={control.key} className={styles.control} data-tone={control.tone} data-level={control.level || undefined}
        data-control={control.code}>
        <title>{control.title}</title>
        <circle cx={control.at.x} cy={control.at.y} r={control.radius ?? radius}
          style={control.tone === "missing" || control.tone === "neutral" ? { strokeDasharray: `${radius * 0.45} ${radius * 0.3}` } : undefined} />
        {control.outOfOrder && <path className={styles.cross} d={cross(control.at, (control.radius ?? radius) * 0.75)} />}
        {control.label && <text className={styles.label} x={control.label.at.x} y={control.label.at.y}
          style={{ fontSize, strokeWidth: fontSize * 0.25 }}>{control.label.text}</text>}
      </g>)}
    </g>
    {bar && <g className={styles.scaleBar} transform={`translate(${view.x + view.width * 0.04} ${view.y + view.height * 0.95})`}>
      <rect x={-fontSize * 0.3} y={-fontSize * 1.6} width={bar.units + fontSize * 0.6} height={fontSize * 2.1} className={styles.scaleBox} />
      <path d={`M0 0 H${bar.units} M0 ${-fontSize * 0.4} V0 M${bar.units} ${-fontSize * 0.4} V0`} style={{ strokeWidth: stroke * 0.8 }} />
      <text x={bar.units / 2} y={-fontSize * 0.55} style={{ fontSize: fontSize * 0.85 }}>{text.scale(bar.meters)}</text>
    </g>}
    {children}
  </svg>;
}

function triangle(at: XY, size: number): string {
  const h = size * Math.sqrt(3) / 2;
  return `${at.x},${at.y - h * 2 / 3} ${at.x + size / 2},${at.y + h / 3} ${at.x - size / 2},${at.y + h / 3}`;
}

function cross(at: XY, size: number): string {
  return `M${at.x - size} ${at.y - size} L${at.x + size} ${at.y + size} M${at.x + size} ${at.y - size} L${at.x - size} ${at.y + size}`;
}
