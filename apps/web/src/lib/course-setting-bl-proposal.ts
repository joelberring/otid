import {
  acceptSafe, decisionFor, pressOrder, mapColorAdjust, proposeColorMatches, referenceRow, referenceSide, sourceMapColors, withDecision, type Cmyk100,
  type ColorDecision, type ColorProposal, type CourseSettingEdit, type MapColorAdjust, type PressNorm, type PrintProfile, type ReferenceColor, type ReferenceTable,
  type SheetFrame, type SourceMapColor
} from "@o-tid/course-setting";
import { rgbFromCmyk, type ColorUsage, type MapColor } from "@o-tid/map-file";
import { inLanguage } from "./in-language";

/**
 * BL-profilerna (ADR-0183 beslut 7): förslaget som arrangören godkänner i förhandsvisningen. Allt här är rent: raderna med
 * färgrutor före och efter (skärmfärg via SWOP som kartan), kopian av profilen med besluten, lagren för bilden av
 * ordningen och utsnitten för de små kartbitarna. Kartfilen ändras aldrig; besluten sparas i tävlingens kopia.
 */
export type RowStatus = "ACCEPTED" | "KEPT" | "PENDING";

export interface ProposalRow {
  readonly proposal: ColorProposal;
  readonly status: RowStatus;
  /** Raden som gäller nu (beslut) eller föreslås (inget beslut); `null` = filens färg. */
  readonly row: ReferenceColor | null;
  readonly before: string;
  readonly after: string;
  /** Färgen är ändrad "för hand" (ADR-0211 beslut 6): den egna CMYK:n gäller före BL-raden. */
  readonly byHand?: boolean | undefined;
  /** Den rad arrangören själv valt bland flera (inte förslagets första). */
  readonly chosen: boolean;
}

export interface ProposalState {
  readonly table: ReferenceTable;
  readonly rows: readonly ProposalRow[];
  readonly unused: readonly ProposalRow[];
  readonly counts: { readonly SAFE: number; readonly CONFIRM: number; readonly AMBIGUOUS: number; readonly decided: number; readonly pending: number };
  readonly colors: readonly SourceMapColor[];
}

const channel = (value: number) => Math.round(value * 255);
export const cssOfRgb = (rgb: { r: number; g: number; b: number }) => `rgb(${channel(rgb.r)}, ${channel(rgb.g)}, ${channel(rgb.b)})`;
/** CMYK i procent som skärmfärg, med samma SWOP-tabell som kartan ritas med. */
export const cssOfCmyk = (cmyk: Cmyk100) => cssOfRgb(rgbFromCmyk({ c: cmyk.c / 100, m: cmyk.m / 100, y: cmyk.y / 100, k: cmyk.k / 100 }));
export const cmykText = (cmyk: Cmyk100) => [cmyk.c, cmyk.m, cmyk.y, cmyk.k].map(value => String(Math.round(value * 10) / 10).replace(".", ",")).join("/");

/** Förslaget och besluten rad för rad, i kartans ordning (överst först). */
export function proposalState(profile: PrintProfile, colors: readonly MapColor[], usage: ReadonlyMap<number, ColorUsage>): ProposalState | undefined {
  const table = profile.reference;
  if (!table) return undefined;
  const source = sourceMapColors(colors, usage);
  const byId = new Map(colors.map(color => [color.id, color]));
  const proposals = proposeColorMatches(table, source);
  const rows: ProposalRow[] = [], unused: ProposalRow[] = [];
  const counts = { SAFE: 0, CONFIRM: 0, AMBIGUOUS: 0, decided: 0, pending: 0 };
  for (const proposal of proposals) {
    const decision = decisionFor(profile.colorDecisions, proposal.color);
    const id = decision ? decision.row : proposal.row;
    const row = id ? referenceRow(table, id) ?? null : null;
    const file = byId.get(proposal.color.ocadId);
    const before = file ? cssOfRgb(file.rgb) : cssOfCmyk(proposal.color.cmyk);
    const hand = profile.mapColors.find(item => item.match.ocadIds?.length === 1 && item.match.ocadIds[0] === proposal.color.ocadId);
    const item: ProposalRow = { proposal, row, before, after: hand?.cmyk ? cssOfCmyk(hand.cmyk) : row?.cmyk ? cssOfCmyk(row.cmyk) : before, ...(hand ? { byHand: true } : {}),
      status: !decision ? "PENDING" : decision.row === null ? "KEPT" : "ACCEPTED", chosen: decision !== undefined && decision.row !== proposal.row };
    if (proposal.unused) { unused.push(item); continue; }
    rows.push(item);
    counts[proposal.confidence] += 1;
    if (decision) counts.decided += 1; else counts.pending += 1;
  }
  return { table, rows, unused, counts, colors: source };
}

/** Den inbyggda profilen som en kopia bygger på (sig själv för en inbyggd). */
export function baseOf(profile: PrintProfile, builtIn: readonly PrintProfile[]): PrintProfile {
  return builtIn.find(item => item.id === profile.basedOn) ?? profile;
}

/** Tävlingens kopia av BL-profilen med besluten (samma id för samma inbyggda profil, så att godkännandet byggs på). */
export function approvedProfile(profile: PrintProfile, decisions: readonly ColorDecision[], builtIn: readonly PrintProfile[]): PrintProfile {
  const base = baseOf(profile, builtIn);
  const isCopy = profile.basedOn !== undefined;
  return { ...profile, id: isCopy ? profile.id : `${base.id}-godkand`, name: isCopy ? profile.name : `${base.name} – godkänd för kartan`, basedOn: base.id,
    colorDecisions: [...decisions].sort((a, b) => a.ocadId - b.ocadId) };
}

/** Ändringarna som sparar kopian och väljer den för tävlingen. */
export const approvalEdits = (copy: PrintProfile): CourseSettingEdit[] =>
  [{ type: "PUT_PRINT_PROFILE", profile: copy }, { type: "SET_EVENT", changes: { printProfileId: copy.id } }];

export type Action = { kind: "ACCEPT_SAFE" } | { kind: "ACCEPT"; ocadId: number } | { kind: "KEEP"; ocadId: number } | { kind: "CHOOSE"; ocadId: number; row: string }
  | { kind: "UNDO"; ocadId: number };

/**
 * Vilket val som gäller för raden (knappen som visas nedtryckt): förslagets rad godtagen, filens färg behållen, en egen
 * vald BL-rad, eller inget beslut.
 */
export function activeChoice(row: Pick<ProposalRow, "status" | "chosen">): "ACCEPT" | "KEEP" | "CHOOSE" | undefined {
  if (row.status === "KEPT") return "KEEP";
  if (row.status === "ACCEPTED") return row.chosen ? "CHOOSE" : "ACCEPT";
  return undefined;
}

/** Besluten efter en knapp ("Godta alla säkra", "Godta", "Behåll filens", "Välj BL-rad …"). */
export function decide(state: ProposalState, decisions: readonly ColorDecision[] | undefined, action: Action): ColorDecision[] {
  if (action.kind === "ACCEPT_SAFE") return acceptSafe(decisions, state.rows.map(row => row.proposal));
  const item = state.rows.find(row => row.proposal.color.ocadId === action.ocadId) ?? state.unused.find(row => row.proposal.color.ocadId === action.ocadId);
  if (!item) return [...(decisions ?? [])];
  const color = item.proposal.color;
  // Ångra: tillbaka till Inte godkänd (beslutet tas bort).
  if (action.kind === "UNDO") return (decisions ?? []).filter(decision => decision.ocadId !== color.ocadId);
  if (action.kind === "KEEP") return withDecision(decisions, color, null);
  if (action.kind === "CHOOSE") {
    if (!referenceRow(state.table, action.row)?.cmyk) throw new Error(inLanguage(`Raden ${action.row} har inga värden`, `Row ${action.row} has no values`));
    return withDecision(decisions, color, action.row);
  }
  return withDecision(decisions, color, item.proposal.row);
}

/**
 * Raderna som förhandsvisningen "efter" visar: besluten, och för färger utan beslut förslaget (också osäkra), så att man
 * ser vad som händer om man godtar. PDF:en använder bara besluten.
 */
export function previewProfile(profile: PrintProfile, state: ProposalState): PrintProfile {
  let decisions = [...(profile.colorDecisions ?? [])];
  for (const item of [...state.rows, ...state.unused]) {
    if (!decisionFor(decisions, item.proposal.color)) decisions = withDecision(decisions, item.proposal.color, item.proposal.row);
  }
  return { ...profile, colorDecisions: decisions };
}

export interface Layer { readonly name: string; readonly css: string; readonly row: string | null }

/**
 * Lagren för bilden av ordningen: kartans färger över banan (överst först), banan, färgerna under, enligt normen (ADR-0211
 * beslut 3). `conflicts` = färger som BL:s tabell lägger på andra sidan banan än normen; O-Tid följer normen.
 */
export function layerStack(profile: PrintProfile, state: ProposalState, norm: PressNorm = "ISOM"): { over: Layer[]; course: Layer; under: Layer[]; conflicts: string[]; onTop: boolean } {
  const preview = previewProfile(profile, state);
  const rowOf = (color: SourceMapColor) => decisionFor(preview.colorDecisions, color)?.row;
  const above = pressOrder(state.colors, norm).over;
  const course: Layer = { name: profile.course.spotName, css: cssOfCmyk(profile.course.cmyk), row: state.table.courseRow };
  const used = state.rows.map(item => item.proposal.color).sort((a, b) => b.drawOrder - a.drawOrder);
  const layer = (color: SourceMapColor): Layer => {
    const item = state.rows.find(row => row.proposal.color.ocadId === color.ocadId)!;
    const id = rowOf(color) ?? null;
    return { name: color.name, css: id && referenceRow(state.table, id)?.cmyk ? cssOfCmyk(referenceRow(state.table, id)!.cmyk!) : item.before, row: id };
  };
  const onTop = profile.courseLayer !== "REFERENCE" || above.size === 0;
  const over = onTop ? [] : used.filter(color => above.has(color.ocadId)).map(layer);
  const under = onTop ? used.map(layer) : used.filter(color => !above.has(color.ocadId)).map(layer);
  const conflicts = used.filter(color => {
    const id = rowOf(color);
    const row = id ? referenceRow(state.table, id) : undefined;
    if (!row) return false;
    const side = referenceSide(state.table, row);
    return side !== "COURSE" && (side === "OVER") !== above.has(color.ocadId);
  }).map(color => color.name);
  return { over, course, under, onTop, conflicts };
}

/** Tabellens sida för en rad (för texten i raden). */
export const sideOf = (table: ReferenceTable, row: ReferenceColor) => referenceSide(table, row);

/** Kartans färger med bara en färg tänd: de andra blekta, för den lilla kartbiten. */
export function isolateAdjust(colors: readonly (Pick<MapColor, "id"> & Partial<Pick<MapColor, "cmyk">>)[], keep: number,
  base: Readonly<Record<number, MapColorAdjust>> = {}): Record<number, MapColorAdjust> {
  // En vit färg (vit för blå, vit för gul …) syns inte mot blekta färger: då blir de andra grå, så att det vita sticker ut.
  const kept = colors.find(color => color.id === keep)?.cmyk;
  const white = kept !== undefined && Math.max(kept.c, kept.m, kept.y, kept.k) < 0.05;
  const out: Record<number, MapColorAdjust> = {};
  for (const color of colors) out[color.id] = color.id === keep ? (base[color.id] ?? {})
    : white ? { ...(base[color.id] ?? {}), cmyk: { c: 0, m: 0, y: 0, k: 0.45 } } : { ...(base[color.id] ?? {}), lighten: 0.88 };
  return out;
}

/** Utsnittet för en liten kartbit (kvadrat på `sizeMm` mm i kartan kring `center`) i `px` bildpunkter. */
export function thumbnailView(center: { x: number; y: number }, sizeMm = 24, px = 192): { width: number; height: number; pxPerMm: number; origin: { x: number; y: number } } {
  return { width: px, height: px, pxPerMm: px / sizeMm, origin: { x: center.x - sizeMm / 2, y: center.y + sizeMm / 2 } };
}

/** Mapcolor-justeringen för "efter" (beslut + förslag) och delarna under och över banan enligt normen. */
export function afterViews(profile: PrintProfile, state: ProposalState, colors: readonly MapColor[], norm: PressNorm = "ISOM"):
  { adjust: Record<number, MapColorAdjust>; over: number[] | undefined; overWhite: number[] | undefined; under: number[] | undefined } {
  const preview = previewProfile(profile, state);
  const adjust = mapColorAdjust(preview, colors);
  if (profile.courseLayer !== "REFERENCE") return { adjust, over: undefined, overWhite: undefined, under: undefined };
  const order = pressOrder(state.colors, norm);
  const above = order.over;
  if (above.size === 0) return { adjust, over: undefined, overWhite: undefined, under: undefined };
  // Vitt över banan slår ut (som i PDF:en) och ritas utan multiplicering; de andra färgerna över banan multipliceras.
  const white = new Set(order.classes.filter(item => item.kind === "WHITE").map(item => item.ocadId));
  const ids = colors.map(color => color.id);
  return { adjust, over: ids.filter(id => above.has(id) && !white.has(id)), overWhite: ids.filter(id => above.has(id) && white.has(id)),
    under: ids.filter(id => !above.has(id)) };
}

/**
 * Kön för kartbilderna: en bild i taget i Workern (den ritar bara den senaste beställningen), de små kartbitarna före
 * arkens stora bilder.
 */
export class RenderQueue {
  private readonly waiting: { run: () => Promise<void>; priority: number }[] = [];
  private busy = false;

  add<T>(task: () => Promise<T>, priority = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({ priority, run: () => task().then(resolve, reject) });
      this.waiting.sort((a, b) => b.priority - a.priority);
      void this.next();
    });
  }

  private async next(): Promise<void> {
    if (this.busy) return;
    const item = this.waiting.shift();
    if (!item) return;
    this.busy = true;
    try { await item.run(); } finally { this.busy = false; void this.next(); }
  }
}

/** Jämförelsens längsta sida i pixlar: rutan är högst 40rem bred, så 1 400 px räcker också på en skärm med dubbel täthet. */
export const COMPARE_MAX_PX = 1400;

/** Upplösningen för "hela kartan före och efter": högst 220 dpi och högst `COMPARE_MAX_PX` på längsta sidan (en stor karta ritas annars i minuter). */
export function compareDpi(clip: { readonly width: number; readonly height: number }): number {
  return Math.min(220, COMPARE_MAX_PX / Math.max(1, clip.width, clip.height) * 25.4);
}

type FrameLike = Pick<SheetFrame, "clip" | "transform" | "mapArea" | "figures">;

/**
 * Utsnittet för "hela kartan före och efter": banans figurer med marginal (kartans mm), inom ramens kartyta, som en ram
 * med samma transform (så att banpåtryckets noder i papperets mm hamnar rätt). Utan figurer hela ramen.
 */
export function compareFrame<T extends FrameLike>(frame: T, marginMm = 12): T {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (point: { x: number; y: number }, pad = 0) => {
    minX = Math.min(minX, point.x - pad); maxX = Math.max(maxX, point.x + pad); minY = Math.min(minY, point.y - pad); maxY = Math.max(maxY, point.y + pad);
  };
  for (const figure of frame.figures) {
    if (figure.kind === "circle") add(figure.center, figure.diameter / 2);
    else if (figure.kind === "polyline") figure.points.forEach(point => add(point));
    else if (figure.kind === "polygon") figure.rings.forEach(ring => ring.forEach(point => add(point)));
    else if (figure.kind === "text") add(figure.at);
  }
  if (!Number.isFinite(minX)) return frame;
  const area = { minX: Math.max(frame.mapArea.minX, minX - marginMm), minY: Math.max(frame.mapArea.minY, minY - marginMm),
    maxX: Math.min(frame.mapArea.maxX, maxX + marginMm), maxY: Math.min(frame.mapArea.maxY, maxY + marginMm) };
  if (area.maxX <= area.minX || area.maxY <= area.minY) return frame;
  const s = frame.transform.scale;
  const corner = { x: s * area.minX + frame.transform.translateX, y: -s * area.maxY + frame.transform.translateY };
  return { ...frame, mapArea: area, clip: { x: corner.x, y: corner.y, width: (area.maxX - area.minX) * s, height: (area.maxY - area.minY) * s } };
}
