"use client";

import type { VirtualCourseView } from "@o-tid/contracts";
import styles from "./bingo.module.css";

export type ControlState = "OPEN" | "MINE" | "OTHER";
export interface VirtualMapImage { readonly href: string; readonly originX: number; readonly originY: number; readonly pxPerMm: number;
  readonly width: number; readonly height: number }

/**
 * Banan som telefonen visar (ADR-0226): kontrollerna som ringar med nummer i rätt läge relativt varandra, kartnorr uppåt, start
 * som triangel och mål som dubbelring. Läget syns med färg och symbol: öppen ring, ✓ och fylld (min), korsad och randig (tagen
 * av en motståndare). Ingen kartbild och ingen position under loppet; efter målgången kartbilden och spåret.
 */
export function VirtualControlsView({ course, states, dark, label, image, track, punches }: { course: VirtualCourseView;
  states: ReadonlyMap<string, ControlState>; dark?: boolean; label: string; image?: VirtualMapImage | undefined;
  track?: readonly (readonly [number, number, number])[] | undefined; punches?: readonly { x: number; y: number }[] | undefined }) {
  const xs = course.controls.map(control => control.x), ys = course.controls.map(control => control.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const size = Math.max(maxX - minX, maxY - minY, 20);
  const r = size * 0.035, pad = r * 3;
  const ink = dark ? "#e8e8e8" : "#a626ff";
  const mine = dark ? "#4fbf5c" : "#1b8a2f", other = "#e07b00";
  const label_ = (index: number, code: string) => course.order === "ORDERED" ? `${index}` : code;
  let number = 0;
  const width = maxX - minX + 2 * pad, height = maxY - minY + 2 * pad;
  // I en ruta av sig själv: ett rutnät räknar annars radens höjd innan SVG:ns bredd är känd.
  return <div><svg className={dark ? styles.controlsDark : styles.controls} viewBox={`${minX - pad} ${-maxY - pad} ${width} ${height}`}
    style={{ aspectRatio: `${width} / ${height}` }}
    role="img" aria-label={label} data-testid="virtual-controls">
    <defs><pattern id="vk-hatch" width={r * 0.6} height={r * 0.6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2={r * 0.6} stroke={other} strokeWidth={r * 0.25} /></pattern></defs>
    {image && <image href={image.href} x={image.originX} y={-image.originY} width={image.width / image.pxPerMm} height={image.height / image.pxPerMm}
      preserveAspectRatio="none" />}
    {course.order === "ORDERED" && <polyline points={course.controls.map(control => `${control.x},${-control.y}`).join(" ")} fill="none" stroke={ink}
      strokeOpacity={0.35} strokeWidth={r * 0.12} />}
    {track && track.length > 1 && <polyline points={track.map(([x, y]) => `${x},${-y}`).join(" ")} fill="none" stroke="#d0021b" strokeWidth={r * 0.15} />}
    {course.controls.map(control => {
      const state = states.get(control.id) ?? "OPEN";
      const stroke = state === "MINE" ? mine : state === "OTHER" ? other : ink;
      const cx = control.x, cy = -control.y;
      if (control.kind === "START") {
        const h = r * 1.6;
        return <polygon key={control.id} points={`${cx},${cy - h * 0.66} ${cx - h * 0.58},${cy + h * 0.33} ${cx + h * 0.58},${cy + h * 0.33}`} fill="none"
          stroke={ink} strokeWidth={r * 0.15} />;
      }
      if (control.kind === "CONTROL") number++;
      return <g key={control.id} data-state={state}>
        <circle cx={cx} cy={cy} r={r} fill={state === "MINE" ? mine : state === "OTHER" ? "url(#vk-hatch)" : "none"} fillOpacity={state === "MINE" ? 0.35 : 1}
          stroke={stroke} strokeWidth={r * 0.15} />
        {control.kind === "FINISH" && <circle cx={cx} cy={cy} r={r * 0.65} fill="none" stroke={stroke} strokeWidth={r * 0.15} />}
        {state === "MINE" && <text x={cx} y={cy + r * 0.35} fontSize={r} textAnchor="middle" fill={mine} fontWeight="bold">✓</text>}
        {state === "OTHER" && <path d={`M${cx - r * 0.5},${cy - r * 0.5} L${cx + r * 0.5},${cy + r * 0.5} M${cx + r * 0.5},${cy - r * 0.5} L${cx - r * 0.5},${cy + r * 0.5}`}
          stroke={other} strokeWidth={r * 0.18} />}
        {control.kind === "CONTROL" && <text x={cx + r * 1.2} y={cy - r * 0.9} fontSize={r * 1.3} fill={stroke} fontWeight="bold">{label_(number, control.code)}</text>}
      </g>;
    })}
    {(punches ?? []).map((punch, index) => <circle key={`p${index}`} cx={punch.x} cy={-punch.y} r={r * 0.25} fill="#0057b8" />)}
  </svg></div>;
}
