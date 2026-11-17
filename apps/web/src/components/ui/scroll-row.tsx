"use client";

import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import styles from "./scroll-row.module.css";

/** Marginal (px) som valt eller fokuserat element får mot kanten, så att det inte hamnar under toningen. */
const EDGE = 48;

/** Rullar `row` i sidled så att `item` syns med marginal mot kanterna. Gör inget när raden inte rullar. */
export function revealInRow(row: HTMLElement, item: HTMLElement): void {
  if (row.scrollWidth <= row.clientWidth) return;
  const box = row.getBoundingClientRect(), target = item.getBoundingClientRect();
  if (target.left < box.left + EDGE) row.scrollLeft -= box.left + EDGE - target.left;
  else if (target.right > box.right - EDGE) row.scrollLeft += target.right - (box.right - EDGE);
}

/**
 * Översynen 2026-11-17: en rad som rullar i sidled (arbetsytans steg och klubbytans flikar i telefonen) visar att den fortsätter:
 * en toning med en pil i kanten där det finns mer. Pilen rullar raden en bit (pekfinger och mus); med tangentbord går man med
 * Tab, och raden följer fokus. Det valda (`aria-current="step"` eller `aria-selected="true"`) rullas in i bild när `active`
 * ändras. Pilarna är dolda för skärmläsare, som når allt i raden ändå. Tar ingen extra höjd.
 */
export function ScrollRow({ children, active, rowClassName, className, ...props }: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode; active?: string | number | undefined; rowClassName?: string | undefined }) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const update = useCallback(() => {
    const element = row.current;
    if (!element) return;
    const max = element.scrollWidth - element.clientWidth;
    const next = { start: max > 1 && element.scrollLeft > 1, end: max > 1 && element.scrollLeft < max - 1 };
    setEdges(previous => previous.start === next.start && previous.end === next.end ? previous : next);
  }, []);
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(element);
    for (const child of Array.from(element.children)) observer?.observe(child);
    return () => { element.removeEventListener("scroll", update); observer?.disconnect(); };
  }, [update]);
  useEffect(() => {
    const element = row.current;
    const selected = element?.querySelector<HTMLElement>('[aria-current="step"], [aria-selected="true"]');
    if (element && selected) revealInRow(element, selected);
    update();
  }, [active, update]);
  const move = (direction: 1 | -1) => {
    const element = row.current;
    if (element) element.scrollLeft += direction * Math.max(EDGE, element.clientWidth * 0.7);
  };
  return <div className={`${styles.wrap}${className ? ` ${className}` : ""}`}>
    <div ref={row} className={rowClassName} {...props}
      onFocus={event => { if (row.current && event.target !== row.current) revealInRow(row.current, event.target as HTMLElement); props.onFocus?.(event); }}>
      {children}
    </div>
    {edges.start && <button type="button" className={`${styles.hint} ${styles.back}`} tabIndex={-1} aria-hidden="true"
      data-testid="scroll-row-back" onClick={() => move(-1)}><span>‹</span></button>}
    {edges.end && <button type="button" className={`${styles.hint} ${styles.forward}`} tabIndex={-1} aria-hidden="true"
      data-testid="scroll-row-forward" onClick={() => move(1)}><span>›</span></button>}
  </div>;
}
