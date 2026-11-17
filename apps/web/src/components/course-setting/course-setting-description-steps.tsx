"use client";

import { useEffect, useRef } from "react";
import { courseSettingDescriptionEn } from "../../i18n/course-setting-course-en";
import { courseSettingDescriptionSv } from "../../i18n/course-setting-description-sv";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import css from "./course-setting-suggest.module.css";

/**
 * Stegandet i kontrollbeskrivningen (ägarens önskan 2026-11-17): Föregående och Nästa går igenom vyns vanliga kontroller
 * i beskrivningens ordning, och kartan går till kontrollen (editorns `onSelect`). Tangenterna "," och "." gör samma sak
 * när man inte skriver i ett fält.
 */
export function DescriptionSteps({ order, current, label, onStep }: {
  order: readonly string[]; current: string | undefined; label: string | undefined; onStep: (delta: 1 | -1) => void;
}) {
  const text = useTexts(courseSettingDescriptionSv, courseSettingDescriptionEn).steps;
  const index = current === undefined ? -1 : order.indexOf(current);
  const step = useRef(onStep);
  step.current = onStep;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || (event.key !== "." && event.key !== ",")) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], dialog")) return;
      event.preventDefault();
      step.current(event.key === "." ? 1 : -1);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  if (order.length === 0) return null;
  return <div className={css.steps} role="group" aria-label={text.label} data-testid="description-steps">
    <Button variant="secondary" onClick={() => onStep(-1)} disabled={index === 0} aria-keyshortcuts=","
      aria-label={text.previous} title={text.previousHelp} data-testid="description-step-previous">◀</Button>
    <span className={css.position} aria-live="polite" data-testid="description-step-position">
      {index >= 0 && label ? text.position(label, index + 1, order.length) : text.none(order.length)}
    </span>
    <Button variant="secondary" onClick={() => onStep(1)} disabled={index === order.length - 1} aria-keyshortcuts="."
      aria-label={text.next} title={text.nextHelp} data-testid="description-step-next">▶</Button>
  </div>;
}
