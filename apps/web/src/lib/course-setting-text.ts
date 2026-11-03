import { routeBarriers, type CourseSettingDocument } from "@o-tid/course-setting";
import type { LegInput } from "@o-tid/route-choice";
import { courseSettingSv as text } from "../i18n/course-setting-sv";
import { ALL_CONTROLS } from "./course-setting-hit";

/** Kort kontrollsumma (FNV-1a) för att märka indata. */
export function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) { h ^= value.charCodeAt(index); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/**
 * Steg 62: banläggningens klartext och vägvalens indata. Kontrollerna nämns med kod, banorna med namn. Kontrollerna som
 * `checkDocument` ger blir rader i `course-setting-checks.ts`.
 */
export function controlLabel(document: CourseSettingDocument, control: string): string {
  const point = document.controls[control];
  if (!point) return text.label.control(undefined);
  return point.kind === "NORMAL" ? text.label.control(point.code) : text.label[point.kind];
}

/**
 * Vald sträcka som indata till vägvalsanalysen (steg 60): ändarna och banans övriga kontroller (för varningen om en
 * sträcka genom en annan ring). Nyckeln byter värde när en ände flyttas, så att en gammal analys inte visas för nya lägen.
 */
export function legInput(document: CourseSettingDocument, from: string, to: string, courseControls: readonly string[], view?: string): LegInput | undefined {
  const start = document.controls[from], end = document.controls[to];
  if (!start || !end) return undefined;
  const others = new Map<string, { code: string; at: { x: number; y: number } }>();
  for (const id of courseControls) {
    const control = document.courseControls[id]?.control;
    const point = control ? document.controls[control] : undefined;
    if (!point || point.kind !== "NORMAL" || control === from || control === to) continue;
    others.set(point.id, { code: point.code ?? point.id, at: point.at });
  }
  // Steg 64: banläggningens förbjudna områden och passager för banan; nyckeln ändras när de ändras.
  const barriers = routeBarriers(document, view ?? ALL_CONTROLS);
  const shape = barriers.areas.length + barriers.lines.length + barriers.openings.length > 0 ? `#${hash(JSON.stringify(barriers))}` : "";
  const key = `${from}-${to}@${start.at.x},${start.at.y};${end.at.x},${end.at.y}${shape}`;
  return { key, from: start.at, to: end.at, otherControls: [...others.values()], ...(shape ? { barriers } : {}) };
}

/** Sekunder som "m:ss". */
export function minutes(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
