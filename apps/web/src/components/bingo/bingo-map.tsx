"use client";

import type { BingoGroup } from "@o-tid/contracts";
import styles from "./bingo.module.css";

export interface BingoMapImage { readonly href: string; readonly originX: number; readonly originY: number; readonly pxPerMm: number;
  readonly width: number; readonly height: number }
export interface BingoMapTrack { readonly id: string; readonly points: readonly (readonly [number, number, number])[]; readonly color: string }

/**
 * Kartan efter målgången och i ledarens vy: kartbilden (om den får visas), rutnätet med de tagna rutorna och spåren. SVG i
 * kartans mm med y nedåt (y vänds), utsnittet runt gruppens rutor.
 */
export interface BingoMapShot { readonly x: number; readonly y: number; readonly result: "HIT" | "SUNK" | "WATER" | "WRONG"; readonly color?: string | undefined }
const SHOT_COLORS = { HIT: "#1b8a2f", SUNK: "#0b5d17", WATER: "#0057b8", WRONG: "#d0021b" } as const;

export function BingoMap({ group, taken, tracks, image, label, ships, shots }: { group: BingoGroup; taken: ReadonlySet<string>; tracks: readonly BingoMapTrack[];
  image: BingoMapImage | undefined; label: string; ships?: readonly (readonly string[])[] | undefined; shots?: readonly BingoMapShot[] | undefined }) {
  if (group.cells.length === 0) return null;
  const minX = Math.min(...group.cells.map(cell => cell.rect.minX)), maxX = Math.max(...group.cells.map(cell => cell.rect.maxX));
  const minY = Math.min(...group.cells.map(cell => cell.rect.minY)), maxY = Math.max(...group.cells.map(cell => cell.rect.maxY));
  const pad = Math.max(maxX - minX, maxY - minY) * 0.04;
  const side = Math.min(...group.cells.map(cell => Math.min(cell.rect.maxX - cell.rect.minX, cell.rect.maxY - cell.rect.minY)));
  const font = Math.max(1, Math.min(3, side * 0.22));
  return <svg className={styles.map} viewBox={`${minX - pad} ${-maxY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`} role="img" aria-label={label}
    data-testid="bingo-map">
    {image && <image href={image.href} x={image.originX} y={-image.originY} width={image.width / image.pxPerMm} height={image.height / image.pxPerMm}
      preserveAspectRatio="none" />}
    {group.cells.map(cell => <g key={cell.name}>
      <rect x={cell.rect.minX} y={-cell.rect.maxY} width={cell.rect.maxX - cell.rect.minX} height={cell.rect.maxY - cell.rect.minY}
        fill={taken.has(cell.name) ? "rgba(40, 160, 60, 0.35)" : "none"} stroke="#a626ff" strokeWidth={0.25} />
      <text x={cell.rect.minX + font * 0.3} y={-cell.rect.maxY + font * 1.05} fontSize={font} fill="#a626ff" fontWeight="bold">{cell.name}</text>
    </g>)}
    {(ships ?? []).map((ship, index) => {
      const rects = ship.map(name => group.cells.find(cell => cell.name === name)?.rect).filter(rect => rect !== undefined);
      if (rects.length === 0) return null;
      const x0 = Math.min(...rects.map(r => r.minX)), x1 = Math.max(...rects.map(r => r.maxX));
      const y0 = Math.min(...rects.map(r => r.minY)), y1 = Math.max(...rects.map(r => r.maxY));
      const inset = side * 0.12;
      return <rect key={`ship-${index}`} x={x0 + inset} y={-y1 + inset} width={x1 - x0 - 2 * inset} height={y1 - y0 - 2 * inset} rx={side * 0.3}
        fill="none" stroke="#111" strokeWidth={0.6} />;
    })}
    {(shots ?? []).map((shot, index) => <circle key={`shot-${index}`} cx={shot.x} cy={-shot.y} r={Math.max(0.6, side * 0.06)}
      fill={shot.color ?? SHOT_COLORS[shot.result]} stroke="#fff" strokeWidth={0.2} />)}
    {tracks.map(track => track.points.length > 1 && <polyline key={track.id} points={track.points.map(([x, y]) => `${x},${-y}`).join(" ")}
      fill="none" stroke={track.color} strokeWidth={0.5} strokeLinejoin="round" strokeLinecap="round" />)}
  </svg>;
}
