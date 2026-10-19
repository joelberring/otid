import { useState } from "react";
import type { StartDrawLaterStart, StartDrawRules, StartDrawSetupResponse } from "@o-tid/contracts";
import { startDrawAdvancedSv as text } from "../../i18n/start-draw-advanced-sv";
import { formatClockTime, parseRaceClock } from "../../lib/clock-time";
import { matchSeedRanking } from "../../lib/seed-ranking-csv";
import type { DrawRow } from "./start-draw";

/**
 * "Avancerat" i Lottning (PLAN.md steg 26): regler för hela starten, startordning och senare start per klass,
 * seedning och ranking från fil. Inställningarna gäller även när avsnittet är hopfällt; det öppnas av sig självt
 * när något avviker från standard. De sparas med lottningen och läses in nästa gång.
 */
export type LaterStartKind = "NONE" | "CLOCK" | "OFFSET";
export type DrawAdvanced = {
  groupControls: "1" | "2" | "3"; maxPerMinute: string; maxPerMinutePerPen: string; lastStart: string;
  seeding: "LAST" | "SPREAD";
  /** Egen ordning (klass-id), null = automatisk. */
  classOrder: string[] | null;
  laterStarts: Record<string, { kind: LaterStartKind; value: string }>;
  /** Seedning per löpare som text i fältet; tomt = inte seedad. */
  seeds: Record<string, string>;
};
export type DrawImportResult = { matched: number; unmatched: { line: number; text: string }[] } | "error";

const EMPTY: DrawAdvanced = { groupControls: "1", maxPerMinute: "", maxPerMinutePerPen: "", lastStart: "", seeding: "LAST",
  classOrder: null, laterStarts: {}, seeds: {} };
const CLOCK = /^([01]?\d|2[0-3])[:.]?([0-5]\d)$/;
const clockOf = (instant: string, timeZone: string) => formatClockTime(instant, timeZone).slice(0, 5);

/** Avancerat som det sparades med senaste lottningen, och löparnas seedning. */
export function advancedFromSetup(setup: StartDrawSetupResponse): DrawAdvanced {
  const saved = setup.settings;
  const seeds = Object.fromEntries(setup.entries.flatMap(entry => entry.seedRank === null ? [] : [[entry.id, String(entry.seedRank)]]));
  if (!saved) return { ...EMPTY, seeds };
  const rules = saved.rules;
  return { groupControls: String(rules.groupControls) as DrawAdvanced["groupControls"],
    maxPerMinute: rules.maxPerMinute === null ? "" : String(rules.maxPerMinute),
    maxPerMinutePerPen: rules.maxPerMinutePerPen === null ? "" : String(rules.maxPerMinutePerPen),
    lastStart: rules.lastStartTime === null ? "" : clockOf(rules.lastStartTime, setup.timeZone), seeding: rules.seeding,
    classOrder: rules.classOrder, seeds,
    laterStarts: Object.fromEntries(saved.laterStarts.map(row => [row.classId, row.laterStart.kind === "CLOCK"
      ? { kind: "CLOCK" as const, value: clockOf(row.laterStart.startTime, setup.timeZone) }
      : { kind: "OFFSET" as const, value: String(row.laterStart.minutes) }])) };
}

/** Avviker något från standard (det enkla läget)? Då visas Avancerat öppet. */
export function advancedChanged(advanced: DrawAdvanced): boolean {
  return advanced.groupControls !== "1" || advanced.maxPerMinute.trim() !== "" || advanced.maxPerMinutePerPen.trim() !== "" ||
    advanced.lastStart.trim() !== "" || advanced.seeding !== "LAST" || advanced.classOrder !== null ||
    Object.values(advanced.laterStarts).some(row => row.kind !== "NONE") || Object.values(advanced.seeds).some(value => value.trim() !== "");
}

/** Klasserna i den ordning de lottas: egen ordning, annars som lottningen gör det automatiskt. */
export function drawClassOrder(setup: StartDrawSetupResponse, rows: Record<string, DrawRow>, advanced: DrawAdvanced): string[] {
  const ids = setup.classes.map(row => row.id);
  if (advanced.classOrder) {
    const known = advanced.classOrder.filter(id => ids.includes(id));
    return [...known, ...ids.filter(id => !known.includes(id))];
  }
  const size = (raceClass: StartDrawSetupResponse["classes"][number]) => {
    const row = rows[raceClass.id];
    return raceClass.entryCount + (row?.vacancyKind === "COUNT" ? Number(row.vacancies) || 0 : 0);
  };
  return [...setup.classes].sort((a, b) => (rows[a.id]?.method === "MASS" ? 0 : 1) - (rows[b.id]?.method === "MASS" ? 0 : 1) ||
    size(b) - size(a) || a.name.localeCompare(b.name, "sv-SE")).map(row => row.id);
}

const limit = (value: string) => value.trim() === "" ? null : /^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 1_000
  ? Number(value) : undefined;
const clock = (value: string) => CLOCK.exec(value.trim());
const clockInstant = (setup: StartDrawSetupResponse, value: string) => {
  const match = clock(value);
  return match ? parseRaceClock(setup.raceDate, `${match[1]!.padStart(2, "0")}:${match[2]}`, setup.timeZone) : null;
};

export type AdvancedRequest = { rules: StartDrawRules; seeds: { entryId: string; rank: number }[]; laterStarts: Map<string, StartDrawLaterStart> };

/**
 * Begärans delar från Avancerat, eller fältfel på svenska. `selected` är de ikryssade klasserna; deras senare start
 * och löparnas seedning skickas.
 */
export function advancedRequest(setup: StartDrawSetupResponse, rows: Record<string, DrawRow>, advanced: DrawAdvanced,
  firstStartTime: string, selected: ReadonlySet<string>): { request: AdvancedRequest } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const maxPerMinute = limit(advanced.maxPerMinute), maxPerMinutePerPen = limit(advanced.maxPerMinutePerPen);
  if (maxPerMinute === undefined) errors.maxPerMinute = text.errors.limit;
  if (maxPerMinutePerPen === undefined) errors.maxPerMinutePerPen = text.errors.limit;
  let lastStartTime: string | null = null;
  if (advanced.lastStart.trim() !== "") {
    lastStartTime = clockInstant(setup, advanced.lastStart);
    if (!lastStartTime) errors.lastStart = text.errors.lastStart;
    else if (Date.parse(lastStartTime) < Date.parse(firstStartTime)) errors.lastStart = text.errors.lastStartBefore;
  }
  const laterStarts = new Map<string, StartDrawLaterStart>();
  for (const classId of selected) {
    const later = advanced.laterStarts[classId];
    if (!later || later.kind === "NONE") continue;
    if (later.kind === "CLOCK") {
      const startTime = clockInstant(setup, later.value);
      if (!startTime || Date.parse(startTime) <= Date.parse(firstStartTime)) errors[`later:${classId}`] = text.errors.clock;
      else laterStarts.set(classId, { kind: "CLOCK", startTime });
    } else {
      const minutes = Number(later.value.trim());
      if (!/^\d+$/.test(later.value.trim()) || minutes < 1 || minutes > 1_440) errors[`later:${classId}`] = text.errors.offset;
      else laterStarts.set(classId, { kind: "OFFSET", minutes });
    }
  }
  const seeds: { entryId: string; rank: number }[] = [];
  for (const entry of setup.entries.filter(row => selected.has(row.classId))) {
    const value = advanced.seeds[entry.id]?.trim() ?? "";
    if (value === "") continue;
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 10_000) errors[`seed:${entry.id}`] = text.errors.seed;
    else seeds.push({ entryId: entry.id, rank: Number(value) });
  }
  if (Object.keys(errors).length > 0) return { errors };
  return { request: { laterStarts, seeds, rules: { groupControls: Number(advanced.groupControls), maxPerMinute: maxPerMinute ?? null,
    maxPerMinutePerPen: maxPerMinutePerPen ?? null, lastStartTime, seeding: advanced.seeding,
    classOrder: advanced.classOrder ? drawClassOrder(setup, rows, advanced) : null } } };
}

export function useStartDrawAdvancedState() {
  const [drawAdvanced, setDrawAdvanced] = useState<DrawAdvanced>(EMPTY);
  const [drawAdvancedErrors, setDrawAdvancedErrors] = useState<Record<string, string>>({});
  const [drawAdvancedOpen, setDrawAdvancedOpen] = useState(false);
  /** Har Avancerat lästs in från tävlingen? Läses om efter sparandet. */
  const [drawAdvancedLoaded, setDrawAdvancedLoaded] = useState(false);
  const [drawSeedClass, setDrawSeedClass] = useState("");
  const [drawSeedImport, setDrawSeedImport] = useState<DrawImportResult>();
  return { drawAdvanced, setDrawAdvanced, drawAdvancedErrors, setDrawAdvancedErrors, drawAdvancedOpen, setDrawAdvancedOpen,
    drawAdvancedLoaded, setDrawAdvancedLoaded, drawSeedClass, setDrawSeedClass, drawSeedImport, setDrawSeedImport };
}
type AdvancedState = ReturnType<typeof useStartDrawAdvancedState>;

export function createStartDrawAdvancedActions(ws: AdvancedState & {
  drawSetup: StartDrawSetupResponse | undefined; drawRows: Record<string, DrawRow>; drawAdvanced: DrawAdvanced;
  setDrawRows: (update: (previous: Record<string, DrawRow>) => Record<string, DrawRow>) => void;
  setDrawPreview: (value: undefined) => void; setDrawError: (value: string) => void; setDrawSaved: (value: string) => void;
}) {
  const { drawSetup, drawRows, drawAdvanced, setDrawAdvanced, setDrawAdvancedErrors, setDrawRows, setDrawPreview, setDrawError,
    setDrawSaved, setDrawSeedImport } = ws;
  /** Varje ändring gör förhandsvisningen inaktuell. */
  function changed(errorKey?: string) {
    setDrawPreview(undefined); setDrawError(""); setDrawSaved("");
    if (errorKey) setDrawAdvancedErrors(previous => { const next = { ...previous }; delete next[errorKey]; return next; });
  }
  function changeDrawAdvanced(change: Partial<Pick<DrawAdvanced, "groupControls" | "maxPerMinute" | "maxPerMinutePerPen" | "lastStart" | "seeding">>) {
    changed(Object.keys(change)[0]);
    setDrawAdvanced(previous => ({ ...previous, ...change }));
  }
  function changeLaterStart(classId: string, change: Partial<{ kind: LaterStartKind; value: string }>) {
    changed(`later:${classId}`);
    setDrawAdvanced(previous => ({ ...previous, laterStarts: { ...previous.laterStarts,
      [classId]: { ...(previous.laterStarts[classId] ?? { kind: "NONE", value: "" }), ...change } } }));
  }
  function changeSeed(entryId: string, value: string) {
    changed(`seed:${entryId}`);
    setDrawAdvanced(previous => ({ ...previous, seeds: { ...previous.seeds, [entryId]: value } }));
  }
  function clearClassSeeds(classId: string) {
    if (!drawSetup) return;
    changed();
    const ids = new Set(drawSetup.entries.filter(entry => entry.classId === classId).map(entry => entry.id));
    setDrawAdvanced(previous => ({ ...previous, seeds: Object.fromEntries(Object.entries(previous.seeds).filter(([id]) => !ids.has(id))) }));
  }
  function moveDrawClass(classId: string, step: -1 | 1) {
    if (!drawSetup) return;
    changed();
    const order = drawClassOrder(drawSetup, drawRows, drawAdvanced);
    const index = order.indexOf(classId), target = index + step;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    setDrawAdvanced(previous => ({ ...previous, classOrder: order }));
  }
  function resetDrawOrder() { changed(); setDrawAdvanced(previous => ({ ...previous, classOrder: null })); }
  /** Kryssar i alla klasser eller bara de som saknar starttider (t.ex. efteranmälda klasser). */
  function selectDrawClasses(which: "ALL" | "UNDRAWN") {
    if (!drawSetup) return;
    changed();
    const undrawn = new Set(drawSetup.classes.filter(row => !row.hasStartTimes).map(row => row.id));
    setDrawRows(previous => Object.fromEntries(Object.entries(previous).map(([id, row]) =>
      [id, { ...row, selected: which === "ALL" || undrawn.has(id) }])));
  }
  /** Ranking från fil: placeringen blir seedning för de löpare som matchas; andra seedningar står kvar. */
  async function importSeedRanking(file: File | undefined) {
    if (!file || !drawSetup) return;
    changed();
    try {
      if (file.size > 2_000_000) throw new Error("För stor fil");
      const result = matchSeedRanking(await file.text(), drawSetup.entries);
      setDrawAdvanced(previous => ({ ...previous, seeds: { ...previous.seeds,
        ...Object.fromEntries([...result.ranks].map(([id, rank]) => [id, String(rank)])) } }));
      setDrawAdvancedErrors(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith("seed:"))));
      setDrawSeedImport({ matched: result.ranks.size, unmatched: result.unmatched });
    } catch { setDrawSeedImport("error"); }
  }
  return { changeDrawAdvanced, changeLaterStart, changeSeed, clearClassSeeds, moveDrawClass, resetDrawOrder, selectDrawClasses,
    importSeedRanking };
}
