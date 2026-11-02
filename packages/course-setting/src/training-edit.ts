/**
 * `PUT_TRAINING` (ADR-0192 beslut 11): sätter hela delar av träningen per id. Formen kontrolleras här och delarna sparas
 * utan okända fält, så att samma värde ger samma JSON (konflikterna jämför värdena).
 */
import type { Point } from "@o-tid/map-file";
import type { CourseSettingDocument } from "./types";
import { CourseSettingEditError } from "./types";
import type {
  AttackPoint, AttackStyle, CourseTraining, FilterPreset, PairTraining, PieceTraining, SectionMarker, SymbolFilter, SymbolGroup, TrainingArea,
  TrainingOutside, TrainingPatch, TrainingSection, TrainingSettings
} from "./training-types";
import { SYMBOL_GROUPS } from "./training-symbols";
import { EMPTY_TRAINING } from "./training-passes";

export const TRAINING_LIMITS = { sections: 64, areas: 50, attackPoints: 500, polygonPoints: 2000, linePoints: 2000, pairs: 200, symbols: 2000 } as const;

const invalid = (message: string) => new CourseSettingEditError("INVALID", message);
const PRESETS: readonly FilterPreset[] = ["ALL", "CONTOURS", "CONTOURS_WATER_ROCK", "NO_VEGETATION", "NO_PATHS", "PATHS_ROADS", "CUSTOM"];

type Unknown = Record<string, unknown>;
const object = (value: unknown, what: string): Unknown => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid(`${what} har fel form`);
  return value as Unknown;
};
const array = (value: unknown, what: string, max: number): unknown[] => {
  if (!Array.isArray(value)) throw invalid(`${what} ska vara en lista`);
  if (value.length > max) throw invalid(`${what} har för många delar (högst ${max})`);
  return value;
};
const text = (value: unknown, what: string, max: number, min = 0): string => {
  if (typeof value !== "string" || value.length > max || value.length < min) throw invalid(`${what} ska vara en text`);
  return value;
};
const id = (value: unknown, what: string) => text(value, what, 64, 1);
const number = (value: unknown, what: string, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw invalid(`${what} ska vara ett tal ${min}–${max}`);
  return value;
};
const oneOf = <T extends string>(value: unknown, what: string, allowed: readonly T[]): T => {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw invalid(`${what} har ett okänt värde`);
  return value as T;
};
const point = (value: unknown, what: string): Point => {
  const p = object(value, what);
  return { x: number(p.x, `${what} x`, -1_000_000, 1_000_000), y: number(p.y, `${what} y`, -1_000_000, 1_000_000) };
};

export function cleanFilter(value: unknown): SymbolFilter {
  const f = object(value, "Filtret");
  const strings = (list: unknown, what: string) => [...new Set(array(list, what, TRAINING_LIMITS.symbols).map(item => text(item, what, 200, 1)))];
  const groups = new Set(array(f.groups, "Filtrets grupper", SYMBOL_GROUPS.length).map(item => oneOf(item, "Gruppen", SYMBOL_GROUPS)));
  return { preset: oneOf(f.preset, "Förvalet", PRESETS), groups: SYMBOL_GROUPS.filter((group: SymbolGroup) => groups.has(group)),
    hide: strings(f.hide, "Dolda symboler"), show: strings(f.show, "Synliga symboler") };
}

function cleanOutside(value: unknown): TrainingOutside {
  const o = object(value, "Utanför");
  const kind = oneOf(o.kind, "Utanför", ["FULL", "WHITE", "TINT", "FILTER"] as const);
  if (kind === "TINT") return { kind, lighten: number(o.lighten, "Tonen", 0.05, 0.95) };
  if (kind === "FILTER") return { kind, filter: cleanFilter(o.filter) };
  return { kind };
}

function cleanMarker(value: unknown): SectionMarker {
  const m = object(value, "Markeringen");
  const kind = oneOf(m.kind, "Markeringen", ["NONE", "TEXT", "BAR"] as const);
  return { kind, ...(m.text !== undefined ? { text: text(m.text, "Markeringens text", 60) } : {}) };
}

function cleanSection(value: unknown): TrainingSection {
  const s = object(value, "Avsnittet");
  const end = (v: unknown, what: string) => v === null ? null : id(v, what);
  const form = oneOf(s.form, "Formen", ["CORRIDOR", "WINDOW", "BAND", "NO_MAP"] as const);
  const out: TrainingSection = { id: id(s.id, "Avsnittets id"), from: end(s.from, "Från"), to: end(s.to, "Till"), form, filter: cleanFilter(s.filter),
    marker: cleanMarker(s.marker) };
  let extra: Partial<TrainingSection> = {};
  if (s.corridor !== undefined) {
    const c = object(s.corridor, "Korridoren");
    const legWidths = c.legWidths === undefined ? undefined : Object.fromEntries(Object.entries(object(c.legWidths, "Sträckornas bredd"))
      .slice(0, 1000).map(([key, width]) => [text(key, "Sträckan", 140, 1), number(width, "Bredden", 1, 2000)]));
    extra = { ...extra, corridor: { shape: oneOf(c.shape, "Korridorens form", ["ANGULAR", "SMOOTH"] as const), widthMeters: number(c.widthMeters, "Bredden", 1, 2000),
      smoothing: number(c.smoothing, "Utjämningen", 0, 1), ...(legWidths && Object.keys(legWidths).length > 0 ? { legWidths } : {}) } };
  }
  if (s.window !== undefined) {
    const w = object(s.window, "Fönstret");
    extra = { ...extra, window: { shape: oneOf(w.shape, "Fönstrets form", ["CIRCLE", "SQUARE"] as const), radiusMeters: number(w.radiusMeters, "Radien", 1, 2000) } };
  }
  if (s.bandMeters !== undefined) extra = { ...extra, bandMeters: number(s.bandMeters, "Bältets bredd", 1, 5000) };
  return { ...out, ...extra };
}

function cleanPairs(value: unknown): PairTraining {
  const p = object(value, "Kepsorienteringen");
  const pairs = array(p.pairs, "Paren", TRAINING_LIMITS.pairs).map(pair => {
    const items = array(pair, "Paret", 2);
    if (items.length !== 2) throw invalid("Ett par har två kontroller");
    return [id(items[0], "Kontrollen a"), id(items[1], "Kontrollen b")] as const;
  });
  if (typeof p.legs !== "boolean") throw invalid("Sträckorna anges med ja eller nej");
  return { pairs, legs: p.legs, print: oneOf(p.print, "Kepsens karta", ["COMMON", "SEPARATE"] as const) };
}

function cleanPieces(value: unknown): PieceTraining {
  const p = object(value, "Kartbitarna");
  return { sizeMm: number(p.sizeMm, "Bitens storlek", 20, 300), ...(p.scale !== undefined ? { scale: number(p.scale, "Skalan", 500, 100_000) } : {}),
    marginMeters: number(p.marginMeters, "Marginalen", 0, 2000), order: oneOf(p.order, "Ordningen", ["COURSE", "SHUFFLED"] as const) };
}

export function cleanCourseTraining(value: unknown): CourseTraining {
  const c = object(value, "Banans träning");
  const sections = array(c.sections, "Avsnitten", TRAINING_LIMITS.sections).map(cleanSection);
  if (new Set(sections.map(section => section.id)).size !== sections.length) throw invalid("Två avsnitt med samma id");
  let out: CourseTraining = { outside: cleanOutside(c.outside), sections };
  if (c.filter !== undefined) out = { ...out, filter: cleanFilter(c.filter) };
  if (c.star !== undefined) {
    const s = object(c.star, "Stjärnan");
    out = { ...out, star: { center: id(s.center, "Mitten"), print: oneOf(s.print, "Stjärnans utskrift", ["ALL", "PER_CONTROL"] as const) } };
  }
  if (c.line !== undefined) {
    const l = object(c.line, "Linjen");
    out = { ...out, line: { points: array(l.points, "Linjens punkter", TRAINING_LIMITS.linePoints).map(p => point(p, "Linjens punkt")) } };
  }
  if (c.pairs !== undefined) out = { ...out, pairs: cleanPairs(c.pairs) };
  if (c.pieces !== undefined) out = { ...out, pieces: cleanPieces(c.pieces) };
  return out;
}

function cleanArea(value: unknown): TrainingArea {
  const a = object(value, "Området");
  const polygon = array(a.polygon, "Områdets punkter", TRAINING_LIMITS.polygonPoints).map(p => point(p, "Områdets punkt"));
  if (polygon.length < 3) throw invalid("Ett område har minst tre punkter");
  return { id: id(a.id, "Områdets id"), ...(a.name !== undefined ? { name: text(a.name, "Områdets namn", 100) } : {}), polygon,
    filter: cleanFilter(a.filter), courses: [...new Set(array(a.courses, "Områdets banor", 1000).map(course => id(course, "Banan")))] };
}

function cleanAttack(value: unknown): AttackPoint {
  const a = object(value, "Sista säkra");
  return { id: id(a.id, "Id"), from: id(a.from, "Från"), to: id(a.to, "Till"), at: point(a.at, "Läget") };
}

export function cleanAttackStyle(value: unknown): AttackStyle {
  const s = object(value, "Stilen");
  return { sizeRatio: number(s.sizeRatio, "Storleken", 0.4, 0.9), style: oneOf(s.style, "Stilen", ["SOLID", "DASHED", "THIN"] as const) };
}

/** Delarna per id; ett id i nyckeln måste stämma med delens. */
function putAll<T extends object>(target: Record<string, T>, changes: Readonly<Record<string, unknown>> | undefined,
  clean: (value: unknown) => T, what: string, check: (id: string, value: T) => void = () => undefined): void {
  for (const [key, value] of Object.entries(changes ?? {})) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") throw invalid(`${what} ${key} går inte`);
    if (value === null) { delete target[key]; continue; }
    const cleaned = clean(value);
    const own = (cleaned as { readonly id?: unknown }).id;
    if (own !== undefined && own !== key) throw invalid(`${what} ${key} har fel id`);
    check(key, cleaned);
    target[key] = cleaned;
  }
}

/** Träningen efter ändringen (tom träning tas bort ur dokumentet). */
export function applyTrainingPatch(document: CourseSettingDocument, patch: TrainingPatch): CourseSettingDocument {
  const current = document.training ?? EMPTY_TRAINING;
  const courses = { ...current.courses }, areas = { ...current.areas }, attackPoints = { ...current.attackPoints };
  const courseIds = new Set(document.courses.map(course => course.id));
  putAll(courses, patch.courses, cleanCourseTraining, "Banan", key => {
    if (!courseIds.has(key)) throw new CourseSettingEditError("NOT_FOUND", `Banan ${key} finns inte`);
  });
  putAll(areas, patch.areas, cleanArea, "Området");
  putAll(attackPoints, patch.attackPoints, cleanAttack, "Sista säkra", (_key, value) => {
    if (!document.controls[value.from] || !document.controls[value.to]) throw invalid("Ändringen går inte längre: sträckans kontroll finns inte");
  });
  if (Object.keys(areas).length > TRAINING_LIMITS.areas) throw invalid(`Högst ${TRAINING_LIMITS.areas} områden`);
  if (Object.keys(attackPoints).length > TRAINING_LIMITS.attackPoints) throw invalid(`Högst ${TRAINING_LIMITS.attackPoints} sista säkra`);
  let attackStyle = current.attackStyle;
  if (patch.attackStyle === null) attackStyle = undefined;
  else if (patch.attackStyle !== undefined) attackStyle = cleanAttackStyle(patch.attackStyle);
  const next: TrainingSettings = { schemaVersion: 1, courses, areas, attackPoints, ...(attackStyle ? { attackStyle } : {}) };
  const empty = Object.keys(courses).length === 0 && Object.keys(areas).length === 0 && Object.keys(attackPoints).length === 0 && !attackStyle;
  if (!empty) return { ...document, training: next };
  const rest = { ...document };
  delete (rest as { training?: TrainingSettings }).training;
  return rest;
}

/** Skillnaden mellan två dokuments träning som en patch (ångra och gör om); `undefined` = samma. */
export function trainingPatch(from: CourseSettingDocument, to: CourseSettingDocument, same: (a: unknown, b: unknown) => boolean): TrainingPatch | undefined {
  const a = from.training ?? EMPTY_TRAINING, b = to.training ?? EMPTY_TRAINING;
  const diff = <T>(x: Readonly<Record<string, T>>, y: Readonly<Record<string, T>>) => {
    const out: Record<string, T | null> = {};
    for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) if (!same(x[key], y[key])) out[key] = y[key] ?? null;
    return Object.keys(out).length > 0 ? out : undefined;
  };
  const courses = diff(a.courses, b.courses), areas = diff(a.areas, b.areas), attackPoints = diff(a.attackPoints, b.attackPoints);
  const style = same(a.attackStyle, b.attackStyle) ? undefined : (b.attackStyle ?? null);
  if (!courses && !areas && !attackPoints && style === undefined) return undefined;
  return { ...(courses ? { courses } : {}), ...(areas ? { areas } : {}), ...(attackPoints ? { attackPoints } : {}), ...(style !== undefined ? { attackStyle: style } : {}) };
}

/** Det som en träningsändring rör (konflikterna, ADR-0181 beslut 4). */
export function trainingTouches(patch: TrainingPatch): string[] {
  return [
    ...Object.keys(patch.courses ?? {}).map(key => `training:course:${key}`),
    ...Object.keys(patch.areas ?? {}).map(key => `training:area:${key}`),
    ...Object.keys(patch.attackPoints ?? {}).map(key => `training:attack:${key}`),
    ...(patch.attackStyle !== undefined ? ["training:attackStyle"] : [])
  ].sort();
}

/** Värdet bakom en touch ("training:course:3"). */
export function trainingTouchValue(document: CourseSettingDocument, touch: string): unknown {
  const [, part, key] = touch.split(":");
  const training = document.training ?? EMPTY_TRAINING;
  if (part === "course") return key === undefined ? training.courses : training.courses[key];
  if (part === "area") return key === undefined ? training.areas : training.areas[key];
  if (part === "attack") return key === undefined ? training.attackPoints : training.attackPoints[key];
  if (part === "attackStyle") return training.attackStyle;
  return training;
}

type IdFn = (id: string) => string;

/** Delarna med id översatta (uppspelningen, ADR-0181 beslut 9): banor, kontroller och banornas kontroller. */
export function remapTrainingPatch(patch: TrainingPatch, ids: { control: IdFn; courseControl: IdFn; course: IdFn }): TrainingPatch {
  const cc = (id: string | null) => id === null ? null : ids.courseControl(id);
  const course = (value: CourseTraining): CourseTraining => ({ ...value,
    sections: value.sections.map(section => ({ ...section, from: cc(section.from), to: cc(section.to) })),
    ...(value.star ? { star: { ...value.star, center: ids.control(value.star.center) } } : {}),
    ...(value.pairs ? { pairs: { ...value.pairs, pairs: value.pairs.pairs.map(([a, b]) => [ids.courseControl(a), ids.courseControl(b)] as const) } } : {}) });
  const map = <T>(record: Readonly<Record<string, T | null>> | undefined, key: IdFn, value: (item: T) => T) => record === undefined ? undefined
    : Object.fromEntries(Object.entries(record).map(([id, item]) => [key(id), item === null ? null : value(item)]));
  const same = (id: string) => id;
  const courses = map(patch.courses, ids.course, course);
  const areas = map(patch.areas, same, area => ({ ...area, courses: area.courses.map(ids.course) }));
  const attackPoints = map(patch.attackPoints, same, attack => ({ ...attack, from: ids.control(attack.from), to: ids.control(attack.to) }));
  return { ...patch, ...(courses ? { courses } : {}), ...(areas ? { areas } : {}), ...(attackPoints ? { attackPoints } : {}) };
}

/** Banor och kontroller som delarna pekar på (för uppspelningens beroenden). */
export function trainingRefs(patch: TrainingPatch): { courses: string[]; controls: string[] } {
  const courses = Object.keys(patch.courses ?? {});
  const controls: string[] = [];
  for (const attack of Object.values(patch.attackPoints ?? {})) if (attack) controls.push(attack.from, attack.to);
  for (const value of Object.values(patch.courses ?? {})) if (value?.star) controls.push(value.star.center);
  for (const area of Object.values(patch.areas ?? {})) if (area) courses.push(...area.courses);
  return { courses, controls };
}
