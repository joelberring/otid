import type { ControlMapResponse, RunnerControlMap, RunnerControlMarkRowDto } from "@o-tid/contracts";
import { controlMapSv as text } from "../../i18n/control-map-sv";
import { legLine, loadLevel, loadRadius, numberPlace, type ControlMapView, type XY } from "../../lib/control-map";
import type { ControlTone, DrawnControl, DrawnEnd, DrawnLine } from "./control-map-svg";

/** Steg 52: från serverns svar till det som ritas (kontroller, sträckor, start och mål). */
export interface Drawing { controls: DrawnControl[]; lines: DrawnLine[]; ends: DrawnEnd[] }

type Course = ControlMapResponse["courses"][number];

/** Sträckorna för en kontrollföljd: start, kontroller och mål; ett okänt läge bryter linjen. */
function legs(points: readonly (XY | null)[], gap: number, tone: DrawnLine["tone"], prefix: string, seen: Set<string>): DrawnLine[] {
  const lines: DrawnLine[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1], to = points[index];
    if (!from || !to) continue;
    const key = `${from.x},${from.y}-${to.x},${to.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const line = legLine(from, to, gap);
    if (line) lines.push({ key: `${prefix}${index}-${key}`, ...line, tone });
  }
  return lines;
}

const variantsOf = (course: Course, variant: string | null) =>
  variant === null ? course.variants : course.variants.filter(row => row.code === variant);

/**
 * Belastning: alla kontroller med färg och storlek efter vald siffra. Bana: vald bana (en variant eller alla) med linjer och
 * nummer, övriga kontroller nedtonade; gafflade grenar som egna sträckor.
 */
export function adminDrawing(data: ControlMapResponse, view: ControlMapView, mode: "LOAD" | "COURSE", metric: "planned" | "punched",
  course: Course | undefined, variant: string | null): Drawing {
  const positioned = data.controls.filter(control => control.position);
  const max = Math.max(0, ...positioned.map(control => control[metric]));
  const gap = view.radius * 1.15;
  if (mode === "LOAD" || !course) {
    const controls = positioned.map((control): DrawnControl => {
      const radius = loadRadius(view.radius, control[metric], max);
      return { key: `c${control.code}`, code: control.code, at: control.position!, tone: "normal", level: loadLevel(control[metric], max), radius,
        outOfOrder: control.outOfOrder, label: { at: { x: control.position!.x, y: control.position!.y - radius - view.fontSize * 0.7 }, text: String(control.code) },
        title: `${text.control(control.code)}: ${text.table.planned} ${control.planned}, ${text.table.punched} ${control.punched}` +
          `${control.outOfOrder ? `, ${text.outOfOrder}` : ""}` };
    });
    const ends = data.courses.flatMap(row => [row.start ? { key: `s${row.courseId}`, at: row.start, kind: "START" as const, tone: "dim" as const } : [],
      row.finish ? { key: `f${row.courseId}`, at: row.finish, kind: "FINISH" as const, tone: "dim" as const } : []].flat());
    return { controls, lines: [], ends: dedupeEnds(ends) };
  }
  const chosen = variantsOf(course, variant);
  const position = new Map(data.controls.map(control => [control.code, control]));
  const selectedCodes = new Set(chosen.flatMap(row => row.controlCodes));
  const otherCodes = new Set(course.variants.flatMap(row => row.controlCodes));
  const seen = new Set<string>();
  const lines: DrawnLine[] = [];
  // Övriga varianter av banan nedtonade, vald variant (eller alla) som banan.
  for (const row of course.variants) {
    if (chosen.includes(row)) continue;
    lines.push(...legs([course.start, ...row.controlCodes.map(code => position.get(code)?.position ?? null), course.finish], gap, "dim", `o${row.code}`, new Set()));
  }
  for (const row of chosen) {
    lines.push(...legs([course.start, ...row.controlCodes.map(code => position.get(code)?.position ?? null), course.finish], gap, "course", `v${row.code}`, seen));
  }
  // Nummer: kontrollens plats i vald variant (en ensam variant); med alla varianter koden.
  const single = chosen.length === 1 ? chosen[0]!.controlCodes : undefined;
  const numbers = new Map<number, string>();
  if (single) single.forEach((code, index) => numbers.set(code, numbers.has(code) ? `${numbers.get(code)}/${index + 1}` : String(index + 1)));
  const controls = positioned.map((control): DrawnControl => {
    const on = selectedCodes.has(control.code), alternative = !on && otherCodes.has(control.code);
    const tone: ControlTone = on ? "course" : "dim";
    const index = single?.indexOf(control.code) ?? -1;
    const neighbour = (offset: number) => {
      if (!single || index < 0) return undefined;
      const code = single[index + offset];
      return code === undefined ? (offset < 0 ? course.start ?? undefined : course.finish ?? undefined) : position.get(code)?.position ?? undefined;
    };
    const labelText = on ? (numbers.get(control.code) ?? String(control.code)) : alternative ? String(control.code) : undefined;
    return { key: `c${control.code}`, code: control.code, at: control.position!, tone, outOfOrder: control.outOfOrder,
      label: labelText ? { at: numberPlace(control.position!, neighbour(-1), neighbour(1), view.radius * 2), text: labelText } : undefined,
      title: `${text.control(control.code)}${control.outOfOrder ? ` (${text.outOfOrder})` : ""}` };
  });
  const ends = endsOf(course.start, course.finish);
  return { controls, lines, ends };
}

function endsOf(start: XY | null, finish: XY | null): DrawnEnd[] {
  const ends: DrawnEnd[] = [];
  if (start) ends.push({ key: "s", at: start, kind: "START", tone: "course" });
  if (finish) ends.push({ key: "f", at: finish, kind: "FINISH", tone: "course" });
  return ends;
}

function dedupeEnds(ends: DrawnEnd[]): DrawnEnd[] {
  const seen = new Set<string>();
  return ends.filter(end => { const key = `${end.kind}${end.at.x},${end.at.y}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

const markTone: Record<RunnerControlMarkRowDto["mark"], ControlTone> = { OK: "ok", MISSING: "missing", WRONG_ORDER: "wrong", NEUTRAL: "neutral" };

/** Löparens bana (en sträcka): linjer, nummer och markeringar (stämplad, saknas, fel ordning). */
export function runnerDrawing(data: RunnerControlMap, leg: RunnerControlMap["legs"][number], view: ControlMapView): Drawing {
  const position = new Map(data.controls.map(control => [control.code, control.position]));
  const points = [leg.start, ...leg.controlCodes.map(code => position.get(code) ?? null), leg.finish];
  const lines = legs(points, view.radius * 1.15, "course", "r", new Set());
  const marks = new Map<number, RunnerControlMarkRowDto>();
  for (const row of leg.marks ?? []) if (!marks.has(row.code) || row.mark !== "OK") marks.set(row.code, row);
  const drawn = new Map<number, DrawnControl>();
  leg.controlCodes.forEach((code, index) => {
    const at = position.get(code);
    if (!at) return;
    const mark = marks.get(code);
    const previous = drawn.get(code);
    const label = previous?.label ? `${previous.label.text}/${index + 1}` : String(index + 1);
    drawn.set(code, { key: `c${code}`, code, at, tone: mark ? markTone[mark.mark] : "course",
      label: { at: numberPlace(at, points[index] ?? undefined, points[index + 2] ?? undefined, view.radius * 2), text: label },
      title: `${text.control(code)}${mark ? `: ${text.marks[mark.mark]}` : ""}`,
      ...(mark?.mark === "MISSING" ? { radius: view.radius * 1.3 } : {}) });
  });
  const ends = endsOf(leg.start, leg.finish);
  return { controls: [...drawn.values()], lines, ends };
}

/** Beskeden under kartan: saknade, fel ordning och ur funktion, i banans ordning. */
type RunnerMessage = { key: string; mark: RunnerControlMarkRowDto["mark"]; text: string };
export function runnerMessages(leg: RunnerControlMap["legs"][number]): RunnerMessage[] {
  return (leg.marks ?? []).flatMap((row): RunnerMessage[] => row.mark === "MISSING"
    ? [{ key: `${row.position}`, mark: row.mark, text: text.missing(row.code, row.previous, row.next) }]
    : row.mark === "WRONG_ORDER" ? [{ key: `${row.position}`, mark: row.mark, text: text.wrongOrder(row.code, row.previous, row.next) }]
      : row.mark === "NEUTRAL" ? [{ key: `${row.position}`, mark: row.mark, text: text.neutral(row.code) }] : []);
}
