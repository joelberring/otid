"use client";

import { useRef, useState, type PointerEvent } from "react";
import type { Sheet } from "@o-tid/course-setting";
import { layoutSv as text } from "../../i18n/course-setting-layout-sv";
import styles from "./course-setting-layout.module.css";

/** Numren på arket som går att dra (bara i en annan layout än huvudlayouten): släppt läge = justerat nummer i kartans mm. */
export function NumberLayer({ sheet, onMove }: { sheet: Sheet; onMove: (courseControl: string, at: { x: number; y: number }) => void }) {
  const [drag, setDrag] = useState<{ ref: string; dx: number; dy: number }>();
  const start = useRef<{ x: number; y: number; ref: string }>(undefined);
  const point = (event: PointerEvent<SVGElement>) => {
    const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM()?.inverse();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix) : { x: 0, y: 0 };
  };
  const numbers = sheet.frames.flatMap(frame => frame.figures.flatMap(figure => figure.kind === "text" && figure.role === "NUMBER" && figure.ref
    ? [{ frame, figure }] : []));
  return <svg className={styles.numberLayer} viewBox={`0 0 ${sheet.paper.widthMm} ${sheet.paper.heightMm}`} data-testid="layout-number-layer">
    {numbers.map(({ frame, figure }) => {
      const s = frame.transform.scale;
      const x = s * figure.at.x + frame.transform.translateX, y = -s * figure.at.y + frame.transform.translateY;
      const h = figure.heightMm * s, w = Math.max(h, figure.text.length * h * 0.62);
      const moving = drag?.ref === figure.ref ? drag : undefined;
      return <rect key={figure.ref} x={x - w / 2 + (moving?.dx ?? 0)} y={y - h / 2 + (moving?.dy ?? 0)} width={w} height={h} fill="rgba(29, 111, 209, .12)"
        stroke="#1d6fd1" strokeWidth={0.2} strokeDasharray="0.8 0.5" style={{ cursor: "grab", touchAction: "none" }} data-testid="layout-number" data-ref={figure.ref}
        aria-label={text.sheet.numberLabel(figure.text)}
        onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); const at = point(event);
          start.current = { x: at.x, y: at.y, ref: figure.ref! }; setDrag({ ref: figure.ref!, dx: 0, dy: 0 }); }}
        onPointerMove={event => { const from = start.current; if (!from) return; const at = point(event); setDrag({ ref: from.ref, dx: at.x - from.x, dy: at.y - from.y }); }}
        onPointerUp={() => {
          const current = drag;
          start.current = undefined; setDrag(undefined);
          if (current && (Math.abs(current.dx) > 0.2 || Math.abs(current.dy) > 0.2)) {
            onMove(current.ref, { x: Math.round((figure.at.x + current.dx / s) * 100) / 100, y: Math.round((figure.at.y - current.dy / s) * 100) / 100 });
          }
        }} />;
    })}
  </svg>;
}
