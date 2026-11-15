/**
 * Virtuella kontroller (ADR-0226, ägaren 2026-11-16): en vanlig bana ur banläggningen där telefonen stämplar när en position
 * ligger inom radien från kontrollen. Rena regler: inom radien, ordningen på en vanlig bana, poängbana och duell (först full
 * poäng, tvåan 30 %, sedan 0). Positioner i kartans mm (y uppåt), `metersPerMm` = kartans meter per mm.
 */

export const VIRTUAL_RULES = {
  /** En stämpling kräver en position som är minst så här noggrann. */
  punchAccuracyM: 20,
  /** Radien kring kontrollen (förval; ledaren väljer per träning). */
  defaultRadiusM: 25,
  minRadiusM: 5,
  maxRadiusM: 100,
  /** Förvalda poäng per kontroll i en duell. */
  defaultPoints: 10,
  /** Tvåan på en kontroll i en duell får så stor andel (avrundat). */
  secondShare: 0.3
} as const;

export type VirtualControlKind = "START" | "CONTROL" | "FINISH";

/** En kontroll på banan: banans kontroll-id (unikt på banan), koden som visas, läget och poängen. */
export interface VirtualControl {
  readonly id: string;
  readonly kind: VirtualControlKind;
  readonly code: string;
  readonly x: number;
  readonly y: number;
  readonly points: number;
}

export interface VirtualCourse {
  /** Vanlig bana: i ordning; poängbana: valfri ordning. */
  readonly order: "ORDERED" | "SCORE";
  /** Kontrollerna i banans ordning (start först, mål sist). */
  readonly controls: readonly VirtualControl[];
}

/** En stämpling som telefonen gjorde: kontrollen, tiden (ms) och positionen med noggrannheten. */
export interface VirtualPunch {
  readonly control: string;
  readonly at: number;
  readonly x: number;
  readonly y: number;
  readonly accuracyM: number;
}

/** Ligger positionen inom radien från kontrollen, med en tillräckligt noggrann position? */
export function withinRadius(control: Pick<VirtualControl, "x" | "y">, fix: { x: number; y: number; accuracyM: number }, radiusM: number,
  metersPerMm: number): boolean {
  if (!(fix.accuracyM <= VIRTUAL_RULES.punchAccuracyM) || !(metersPerMm > 0)) return false;
  return Math.hypot(fix.x - control.x, fix.y - control.y) * metersPerMm <= radiusM;
}

/** Kontrollerna (inte start) som positionen ligger inom radien från, närmast först. */
export function controlsInReach(course: VirtualCourse, fix: { x: number; y: number; accuracyM: number }, radiusM: number, metersPerMm: number): VirtualControl[] {
  return course.controls.filter(control => control.kind !== "START" && withinRadius(control, fix, radiusM, metersPerMm))
    .sort((a, b) => Math.hypot(fix.x - a.x, fix.y - a.y) - Math.hypot(fix.x - b.x, fix.y - b.y));
}

/** Den giltiga stämplingen med sträcktiden (ms från start) och mellantiden. */
export interface JudgedPunch extends VirtualPunch { readonly code: string; readonly points: number; readonly fromStartMs: number }

/**
 * Stämplingarna bedömda (servern räknar om allt): positionen måste ligga inom radien. Vanlig bana: bara nästa kontroll i
 * ordningen räknas (en kontroll i fel ordning räknas inte; målet först när alla kontroller är tagna). Poängbana: varje
 * kontroll en gång, valfri ordning; målet när som helst. Efter målet räknas inget mer.
 */
export function judgePunches(course: VirtualCourse, punches: readonly VirtualPunch[], startedAt: number, radiusM: number, metersPerMm: number): JudgedPunch[] {
  const byId = new Map(course.controls.map(control => [control.id, control]));
  const sequence = course.controls.filter(control => control.kind !== "START");
  const taken = new Set<string>();
  const out: JudgedPunch[] = [];
  let finished = false;
  for (const punch of [...punches].sort((a, b) => a.at - b.at || a.control.localeCompare(b.control))) {
    const control = byId.get(punch.control);
    if (finished || !control || control.kind === "START" || taken.has(control.id) || punch.at < startedAt) continue;
    if (!withinRadius(control, punch, radiusM, metersPerMm)) continue;
    if (course.order === "ORDERED") {
      const next = sequence.find(item => !taken.has(item.id));
      if (next?.id !== control.id) continue;
    }
    taken.add(control.id);
    if (control.kind === "FINISH") finished = true;
    out.push({ ...punch, code: control.code, points: control.points, fromStartMs: punch.at - startedAt });
  }
  return out;
}

/** Resultatet för en löpare: kontroller tagna (utan mål), poäng (poängbana), målgång och tiden. */
export interface VirtualResult { readonly controls: number; readonly points: number; readonly finished: boolean; readonly lastAt: number | null }

export function virtualResult(judged: readonly JudgedPunch[], course: VirtualCourse): VirtualResult {
  const controls = judged.filter(punch => course.controls.find(control => control.id === punch.control)?.kind === "CONTROL");
  const finish = judged.find(punch => course.controls.find(control => control.id === punch.control)?.kind === "FINISH");
  return { controls: controls.length, points: controls.reduce((sum, punch) => sum + punch.points, 0), finished: finish !== undefined,
    lastAt: judged.length > 0 ? Math.max(...judged.map(punch => punch.at)) : null };
}

/** En deltagare i en duell: laget (lagkamrater delar «först»; ensam = eget lag) och de giltiga stämplingarna. */
export interface DuelEntry { readonly runner: string; readonly team: string; readonly punches: readonly { readonly control: string; readonly at: number }[] }

export interface DuelControlScore { readonly control: string; readonly team: string; readonly runner: string; readonly at: number; readonly points: number;
  readonly place: number }

/**
 * Duellen (rogaining för två eller fler): per kontroll rangordnas lagen efter sin första stämpling. Först får full poäng,
 * tvåan 30 % (avrundat), sedan 0. Lagets poäng är summan. Lika tid: samma plats.
 */
export function duelScores(entries: readonly DuelEntry[], points: (control: string) => number): { teams: Record<string, number>; controls: DuelControlScore[] } {
  const firstByTeam = new Map<string, Map<string, { runner: string; at: number }>>();
  for (const entry of entries) {
    for (const punch of entry.punches) {
      const perControl = firstByTeam.get(punch.control) ?? new Map<string, { runner: string; at: number }>();
      const before = perControl.get(entry.team);
      if (!before || punch.at < before.at) perControl.set(entry.team, { runner: entry.runner, at: punch.at });
      firstByTeam.set(punch.control, perControl);
    }
  }
  const teams: Record<string, number> = Object.fromEntries(entries.map(entry => [entry.team, 0]));
  const controls: DuelControlScore[] = [];
  for (const [control, perTeam] of firstByTeam) {
    const ranked = [...perTeam].sort((a, b) => a[1].at - b[1].at || a[0].localeCompare(b[0]));
    const full = points(control);
    ranked.forEach(([team, first], index) => {
      const place = index === 0 || first.at !== ranked[index - 1]![1].at ? index + 1 : controls[controls.length - 1]!.place;
      const value = place === 1 ? full : place === 2 ? Math.round(full * VIRTUAL_RULES.secondShare) : 0;
      teams[team] = (teams[team] ?? 0) + value;
      controls.push({ control, team, runner: first.runner, at: first.at, points: value, place });
    });
  }
  return { teams, controls };
}

/** Poängen per kontroll i duellen: ledarens värde per kod, annars förvalet (10). */
export function duelPoints(overrides: Readonly<Record<string, number>> | undefined, code: string): number {
  const value = overrides?.[code];
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : VIRTUAL_RULES.defaultPoints;
}

/** Ledarens poäng per kod ur texten "31=20, 32=15"; undefined om texten inte går att läsa. */
export function parseControlPoints(text: string): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const part of text.split(/[,;\n]+/).map(item => item.trim()).filter(Boolean)) {
    const match = /^([A-Za-z0-9]{1,8})\s*[=:]\s*(\d{1,4})$/.exec(part);
    if (!match) return undefined;
    out[match[1]!] = Number(match[2]);
  }
  return out;
}
