/**
 * ADR-0199: varningarnas nivå och godtagna varningar. Varje kontroll (`CourseCheck`) har en nivå (fel, varning, notis), en
 * nyckel som inte beror på banan när samma fysiska sträcka eller kontroll gäller flera banor, och lägena för det den gäller.
 * En godtagen varning gäller så länge samma kontroller och objekt finns (id i nyckeln) och inget av dem flyttats mer än
 * `ACCEPT_MOVE_METERS`. Fel som stoppar tidtagningen eller överföringen (dubbla koder, kod saknas, bana utan start eller
 * mål) går inte att godta.
 */
import type { Point } from "@o-tid/map-file";
import { distance } from "./geometry";
import type { AcceptedCheck, CourseCheck, CourseSettingDocument, CourseSettingEdit } from "./types";
import { CourseSettingEditError } from "./types";

export type CheckLevel = "ERROR" | "WARNING" | "NOTICE";

/** En godtagen varning visas igen när något den gäller flyttats längre än så (meter i terrängen). */
export const ACCEPT_MOVE_METERS = 25;
/** Högst så många godtagna varningar i dokumentet. */
export const ACCEPTED_CHECKS_MAX = 5000;

/**
 * Fel: det blir fel vid tävlingen (dubbla koder, kod saknas, start eller mål saknas, kontrollen går inte att nå lagligt).
 * Varning: troligen fel, men kan vara meningen. Notis: att känna till; räknas inte i fliken.
 */
export function checkLevel(check: CourseCheck): CheckLevel {
  switch (check.kind) {
    case "DUPLICATE_CODE": case "MISSING_CODE": case "COURSE_WITHOUT_START_OR_FINISH": case "CONTROL_IN_FORBIDDEN": return "ERROR";
    case "LEG_THROUGH_FORBIDDEN": return check.route === "NO_ROUTE" ? "ERROR" : "NOTICE";
    case "CONTROLS_TOO_CLOSE": return check.feature === "UNKNOWN" ? "NOTICE" : "WARNING";
    case "UNUSED_CONTROL": case "NUMBER_ON_OBSTACLE": case "LEVEL_DEVIATION": return "NOTICE";
    case "INVERTIBLE_CODE": case "SAME_CONTROL_TWICE_IN_ROW": case "LEG_THROUGH_CONTROL": return "WARNING";
  }
}

/** Kan banläggaren godta den ("Det är meningen")? Inte det som stoppar tidtagningen eller överföringen. */
export function checkAcceptable(check: CourseCheck): boolean {
  return check.kind !== "DUPLICATE_CODE" && check.kind !== "MISSING_CODE" && check.kind !== "COURSE_WITHOUT_START_OR_FINISH";
}

/**
 * Nyckeln för att godta. Sträckor och kontroller utan bana (samma fysiska sträcka på flera banor och varianter är en),
 * id för det den gäller och det som gör den till en annan varning (gränsen för för nära, koden). Delarna skiljs med "/".
 */
export function checkKey(check: CourseCheck): string {
  switch (check.kind) {
    case "CONTROLS_TOO_CLOSE": return ["CONTROLS_TOO_CLOSE", ...[...check.controls].sort(), String(check.limitMeters)].join("/");
    case "DUPLICATE_CODE": return `DUPLICATE_CODE/${check.code}`;
    case "INVERTIBLE_CODE": return `INVERTIBLE_CODE/${check.control}/${check.code}`;
    case "SAME_CONTROL_TWICE_IN_ROW": return `SAME_CONTROL_TWICE_IN_ROW/${check.course}/${check.control}`;
    case "LEG_THROUGH_CONTROL": return `LEG_THROUGH_CONTROL/${check.from}/${check.to}/${check.control}`;
    case "LEG_THROUGH_FORBIDDEN": return check.route === "NO_ROUTE" ? `LEG_NO_ROUTE/${check.from}/${check.to}`
      : `LEG_THROUGH_FORBIDDEN/${check.from}/${check.to}`;
    case "CONTROL_IN_FORBIDDEN": return `CONTROL_IN_FORBIDDEN/${check.control}/${check.special}`;
    case "COURSE_WITHOUT_START_OR_FINISH": return `COURSE_WITHOUT_START_OR_FINISH/${check.course}`;
    case "UNUSED_CONTROL": return `UNUSED_CONTROL/${check.control}`;
    case "MISSING_CODE": return `MISSING_CODE/${check.control}`;
    case "NUMBER_ON_OBSTACLE": return `NUMBER_ON_OBSTACLE/${check.course}/${check.control}`;
    // ADR-0212: samma kontroll eller sträcka med samma målnivå på flera banor är en rad.
    case "LEVEL_DEVIATION": return check.control !== undefined ? `LEVEL_DEVIATION/${check.target}/${check.control}`
      : `LEVEL_DEVIATION/${check.target}/${check.from}/${check.to}`;
  }
}

function centroid(points: readonly Point[]): Point {
  let x = 0, y = 0;
  for (const point of points) { x += point.x; y += point.y; }
  return { x: x / Math.max(1, points.length), y: y / Math.max(1, points.length) };
}

/** Lägena för det varningen gäller: kontroller "c:<id>", specialobjekt (mittpunkten) "s:<id>". */
export function checkSubjects(document: CourseSettingDocument, check: CourseCheck): Record<string, Point> {
  const controls: string[] = [], specials: string[] = [];
  switch (check.kind) {
    case "CONTROLS_TOO_CLOSE": case "DUPLICATE_CODE": controls.push(...check.controls); break;
    case "INVERTIBLE_CODE": case "SAME_CONTROL_TWICE_IN_ROW": case "UNUSED_CONTROL": case "MISSING_CODE": case "NUMBER_ON_OBSTACLE": controls.push(check.control); break;
    case "LEG_THROUGH_CONTROL": controls.push(check.from, check.to, check.control); break;
    case "LEG_THROUGH_FORBIDDEN": controls.push(check.from, check.to); specials.push(...(check.specials ?? [check.special])); break;
    case "CONTROL_IN_FORBIDDEN": controls.push(check.control); specials.push(check.special); break;
    case "COURSE_WITHOUT_START_OR_FINISH": break;
    case "LEVEL_DEVIATION": for (const id of [check.control, check.from, check.to]) if (id !== undefined) controls.push(id); break;
  }
  const at: Record<string, Point> = {};
  for (const id of controls) { const point = document.controls[id]; if (point) at[`c:${id}`] = { x: point.at.x, y: point.at.y }; }
  for (const id of specials) {
    const special = document.specialObjects.find(item => item.id === id);
    if (special && special.points.length > 0) at[`s:${id}`] = centroid(special.points);
  }
  return at;
}

/** Är varningen godtagen och gäller godtagandet fortfarande (samma objekt, inget flyttat längre än gränsen)? */
export function isAccepted(document: CourseSettingDocument, check: CourseCheck): boolean {
  if (!checkAcceptable(check)) return false;
  const entry = document.event.acceptedChecks?.[checkKey(check)];
  if (!entry) return false;
  const limitMm = ACCEPT_MOVE_METERS * 1000 / document.event.mapScale;
  for (const [id, point] of Object.entries(checkSubjects(document, check))) {
    const then = entry.at[id];
    if (!then || distance(then, point) > limitMm) return false;
  }
  return true;
}

/** Åtgärden som godtar varningarna (alla som går att godta) med dagens lägen. */
export function acceptChecksEdit(document: CourseSettingDocument, checks: readonly CourseCheck[]): CourseSettingEdit | undefined {
  const entries: Record<string, AcceptedCheck> = {};
  for (const check of checks) if (checkAcceptable(check)) entries[checkKey(check)] = { at: { ...entries[checkKey(check)]?.at, ...checkSubjects(document, check) } };
  return Object.keys(entries).length > 0 ? { type: "SET_ACCEPTED_CHECKS", checks: entries } : undefined;
}

/** Åtgärden som ångrar godtagandet. */
export function unacceptChecksEdit(keys: readonly string[]): CourseSettingEdit | undefined {
  return keys.length > 0 ? { type: "SET_ACCEPTED_CHECKS", checks: Object.fromEntries(keys.map(key => [key, null])) } : undefined;
}

/**
 * De godtagna vars kontroller och specialobjekt finns i `document` (t.ex. efter att en ny .ppen lästs in: Purple Pens id
 * behålls, så det som finns kvar är godtaget som förut). Undefined = inga.
 */
export function keepAcceptedChecks(accepted: CourseSettingDocument["event"]["acceptedChecks"], document: CourseSettingDocument)
  : Readonly<Record<string, AcceptedCheck>> | undefined {
  if (!accepted) return undefined;
  const specials = new Set(document.specialObjects.map(special => special.id));
  const courses = new Set(document.courses.map(course => course.id));
  const kept = Object.entries(accepted).filter(([key, entry]) => {
    if (key.startsWith("SAME_CONTROL_TWICE_IN_ROW/") && !courses.has(key.split("/")[1]!)) return false;
    return Object.keys(entry.at).every(id => id.startsWith("c:") ? document.controls[id.slice(2)] !== undefined
      : id.startsWith("s:") ? specials.has(id.slice(2)) : false);
  });
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

const KEY = /^[A-Z_]{1,40}(\/[^/]{1,64}){1,4}$/;

/** `SET_ACCEPTED_CHECKS`: nycklarna sätts eller tas bort; övriga godtagna står kvar. */
export function setAcceptedChecks(document: CourseSettingDocument, checks: Readonly<Record<string, AcceptedCheck | null>>): CourseSettingDocument {
  const next: Record<string, AcceptedCheck> = { ...(document.event.acceptedChecks ?? {}) };
  for (const [key, entry] of Object.entries(checks)) {
    if (!KEY.test(key)) throw new CourseSettingEditError("INVALID", "Varningens nyckel är fel");
    if (entry === null) { delete next[key]; continue; }
    const at = Object.entries(entry.at ?? {});
    if (at.length > 20 || at.some(([id, point]) => !/^[cs]:.{1,64}$/.test(id) || !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) {
      throw new CourseSettingEditError("INVALID", "Den godtagna varningens lägen är fel");
    }
    next[key] = { at: Object.fromEntries(at.map(([id, point]) => [id, { x: point.x, y: point.y }])) };
  }
  if (Object.keys(next).length > ACCEPTED_CHECKS_MAX) throw new CourseSettingEditError("INVALID", "För många godtagna varningar");
  const event = { ...document.event };
  delete event.acceptedChecks;
  return { ...document, event: Object.keys(next).length > 0 ? { ...event, acceptedChecks: next } : event };
}
