/**
 * Steg 65 (ADR-0184): färgerna i PDF:en. Varje kartfärg och färgroll i banpåtrycket blir en "färg att trycka" (`Paint`):
 * processfärg (DeviceCMYK) eller dekorfärger (`/Separation` för en plåt, `/DeviceN` för flera) med CMYK-alternativ, och
 * övertryck på eller av. Kartfilen ändras aldrig; utskriftsprofilen gäller bara PDF:en.
 *
 * Semantiken följer kartprogrammen: en dekorfärg med övertryck målar bara sina egna plåtar (även 0 %, som då slår ut
 * plåten), en utan övertryck (knockout) slår ut alla plåtar under sig. Det är exakt PDF:s /OP för /Separation och
 * /DeviceN. För DeviceCMYK med övertryck gäller /OPM 1: plåtar med 0 % lämnas orörda.
 */
import { adjustedColor, type MapColor, type ParsedMap, type SpotSeparation } from "@o-tid/map-file";
import { mapColorAdjust, type Cmyk100, type PrintProfile } from "@o-tid/course-setting";

export interface Cmyk { readonly c: number; readonly m: number; readonly y: number; readonly k: number }

/** Bläcket: processfärg eller dekorfärger med andel (0–1) per plåt och plåtarnas CMYK-alternativ. */
export type Ink =
  | { readonly kind: "CMYK"; readonly cmyk: Cmyk }
  | { readonly kind: "SPOT"; readonly names: readonly string[]; readonly alternates: readonly Cmyk[]; readonly tints: readonly number[] };

export interface Paint { readonly ink: Ink; readonly overprint: boolean }

/**
 * PRESS = tryckeri: kartans dekorfärger ur filen (eller profilens) och banan i egen dekorfärg med övertryck.
 * PROCESS = tryckeri med kartan i CMYK (filens övertryck behålls) och banan som dekorfärg.
 * OFFICE = kontorsskrivare: allt i CMYK utan dekorfärger och utan övertryck.
 */
export type PdfMode = "PRESS" | "PROCESS" | "OFFICE";

const clamp01 = (value: number) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
const fromPercent = (cmyk: Cmyk100): Cmyk => ({ c: clamp01(cmyk.c / 100), m: clamp01(cmyk.m / 100), y: clamp01(cmyk.y / 100), k: clamp01(cmyk.k / 100) });
export const WHITE: Paint = { ink: { kind: "CMYK", cmyk: { c: 0, m: 0, y: 0, k: 0 } }, overprint: false };
export const BLACK: Paint = { ink: { kind: "CMYK", cmyk: { c: 0, m: 0, y: 0, k: 1 } }, overprint: false };

const PROCESS_NAMES: Readonly<Record<string, string>> = { cyan: "Cyan", magenta: "Magenta", yellow: "Yellow", black: "Black" };

/** Vitt bläck (0 % på alla kanaler/plåtar, eller dekorfärg vars CMYK-alternativ är vitt): ska aldrig ha övertryck. */
export function isWhiteInk(ink: Ink): boolean {
  const cmykWhite = (cmyk: Cmyk) => Math.max(cmyk.c, cmyk.m, cmyk.y, cmyk.k) <= 0.02;
  return ink.kind === "CMYK" ? cmykWhite(ink.cmyk)
    : ink.tints.every(tint => tint <= 0.02) || ink.alternates.every(cmykWhite);
}

/**
 * Plåtens namn i PDF:en. OCAD kallar processplåtarna "Process Black" m.fl.; i PDF heter de Cyan, Magenta, Yellow och
 * Black och hamnar då på processplåten i stället för en egen extra plåt. Reserverade PDF-namn (`All`, `None`) spärras.
 */
export function plateName(name: string): string {
  const trimmed = name.trim();
  const process = /^process\s+(cyan|magenta|yellow|black)$/i.exec(trimmed);
  if (process) return PROCESS_NAMES[process[1]!.toLowerCase()]!;
  if (trimmed === "") return "Spot";
  if (/^all$/i.test(trimmed)) return "Spot_All";
  if (/^none$/i.test(trimmed)) return "Spot_None";
  return trimmed;
}

/** Bläcket med andelen `factor` (rastrerad yta, mönster som tonad yta): CMYK skalas, dekorfärgernas andelar likaså. */
export function tinted(paint: Paint, factor: number): Paint {
  if (factor >= 0.9995) return paint;
  const f = clamp01(factor);
  const ink: Ink = paint.ink.kind === "CMYK"
    ? { kind: "CMYK", cmyk: { c: paint.ink.cmyk.c * f, m: paint.ink.cmyk.m * f, y: paint.ink.cmyk.y * f, k: paint.ink.cmyk.k * f } }
    : { ...paint.ink, tints: paint.ink.tints.map(tint => tint * f) };
  return { ...paint, ink };
}

const sameCmyk = (a: Cmyk, b: Cmyk) => Math.abs(a.c - b.c) < 0.0005 && Math.abs(a.m - b.m) < 0.0005 && Math.abs(a.y - b.y) < 0.0005 && Math.abs(a.k - b.k) < 0.0005;
const percentText = (cmyk: Cmyk) => [cmyk.c, cmyk.m, cmyk.y, cmyk.k].map(value => String(Math.round(value * 1000) / 10).replace(".", ",")).join("/");

/** Plåtarna i dokumentet: ett CMYK-alternativ per namn (den första definitionen gäller, avvikelser blir en notis per plåt). */
export class Plates {
  readonly alternates = new Map<string, Cmyk>();
  private readonly conflicts = new Map<string, Map<string, string[]>>();
  constructor(private readonly notes: Set<string>) {}
  define(name: string, cmyk: Cmyk, where: string): Cmyk {
    const known = this.alternates.get(name);
    if (!known) { this.alternates.set(name, cmyk); return cmyk; }
    if (!sameCmyk(known, cmyk)) {
      const byCmyk = this.conflicts.get(name) ?? new Map<string, string[]>();
      byCmyk.set(percentText(cmyk), [...(byCmyk.get(percentText(cmyk)) ?? []), where]);
      this.conflicts.set(name, byCmyk);
    }
    return known;
  }
  /** Notiserna om dekorfärger med olika CMYK (skrivs när alla färger är definierade). */
  report(): void {
    for (const [name, byCmyk] of this.conflicts) {
      const used = percentText(this.alternates.get(name)!);
      const others = [...byCmyk].map(([cmyk, where]) => `${cmyk} i ${where.slice(0, 3).join(", ")}${where.length > 3 ? ` m.fl. (${where.length})` : ""}`).join("; ");
      this.notes.add(`Dekorfärgen ${name} skrivs med CMYK-alternativet ${used}; avvikande värden: ${others}.`);
    }
  }
}

export interface PaintOptions {
  readonly mode: PdfMode;
  readonly profile: PrintProfile;
}

/**
 * Banans färg (COURSE och COURSE_LOWER): profilens dekorfärg med övertryck, eller CMYK på kontorsskrivaren. BL-profilerna
 * (`course.process` eller `processColors`) ger banan som CMYK-processfärg med profilens övertryck.
 */
export function coursePaint(options: PaintOptions, plates: Plates): Paint {
  const cmyk = fromPercent(options.profile.course.cmyk);
  if (options.mode === "OFFICE") return { ink: { kind: "CMYK", cmyk }, overprint: false };
  if (options.profile.course.process || options.profile.processColors) return { ink: { kind: "CMYK", cmyk }, overprint: options.profile.course.overprint };
  const name = plateName(options.profile.course.spotName || "Purple");
  const alternate = plates.define(name, cmyk, "banans färg i profilen");
  return { ink: { kind: "SPOT", names: [name], alternates: [alternate], tints: [1] }, overprint: options.profile.course.overprint };
}

/** Passmärken och skärmarker: registerfärgen (/All, alla plåtar) i dekorfärgstryck, process-svart på kontorsskrivare och CMYK/BL-profiler. */
export function registrationPaint(options: PaintOptions): Paint {
  if (options.mode === "OFFICE" || options.profile.reference !== undefined || options.profile.processColors === true) return BLACK;
  return { ink: { kind: "SPOT", names: ["All"], alternates: [{ c: 1, m: 1, y: 1, k: 1 }], tints: [1] }, overprint: false };
}

/** En CUSTOM-färg i banpåtrycket (andelar 0–1). */
export function customPaint(cmyk: readonly [number, number, number, number] | undefined): Paint {
  if (!cmyk) return BLACK;
  return { ink: { kind: "CMYK", cmyk: { c: clamp01(cmyk[0]), m: clamp01(cmyk[1]), y: clamp01(cmyk[2]), k: clamp01(cmyk[3]) } }, overprint: false };
}

function separationsOf(color: MapColor): readonly SpotSeparation[] {
  if (!color.spot) return [];
  if (color.spot.separations && color.spot.separations.length > 0) return color.spot.separations;
  // Äldre modell utan separationer: namnet som en plåt med färgens egen CMYK.
  return [{ name: color.spot.name, factor: 1, cmyk: color.cmyk }];
}

/** Ljusare/mörkare på andelar (samma formel som `adjustedColor` använder på CMYK). */
const lightened = (value: number, lighten: number | undefined) => clamp01(value * (1 - Math.max(-1, Math.min(1, lighten ?? 0))));

/**
 * Kartans färger att trycka per färgens id. `null` = dold i profilen (ritas inte). I PRESS blir en dekorfärg ur filen
 * `/Separation` eller `/DeviceN` med filens övertryck; profilens "ny CMYK" gör den till processfärg och profilens
 * dekorfärg ger en egen plåt. I PROCESS och OFFICE skrivs allt i CMYK (PROCESS med filens övertryck och /OPM 1).
 */
export function mapPaints(map: Pick<ParsedMap, "colors">, options: PaintOptions, plates: Plates, notes: Set<string>): Map<number, Paint | null> {
  const adjust = mapColorAdjust(options.profile, map.colors);
  const out = new Map<number, Paint | null>();
  const paintOf = (ink: Ink, overprint: boolean): Paint => ({ ink, overprint: isWhiteInk(ink) ? false : overprint });
  let spotsInFile = false;
  for (const color of map.colors) {
    const setting = adjust[color.id];
    if (setting?.hidden) { out.set(color.id, null); continue; }
    const adjusted = adjustedColor(color, setting);
    const cmyk: Cmyk = adjusted.cmyk;
    if (options.mode === "OFFICE") { out.set(color.id, paintOf({ kind: "CMYK", cmyk }, false)); continue; }
    const separations = separationsOf(color);
    if (separations.length > 0) spotsInFile = true;
    // Kartfilens egen övertrycksflagga (gäller även rena CMYK-färger med OCAD `o1`).
    const fileOverprint = color.overprint ?? color.spot?.overprint ?? false;
    // I PROCESS (inkl. BL): aldrig /Separation-plåtar, inte ens om profilen har `setting.spot`.
    if (options.mode === "PROCESS") {
      const overprint = setting?.spot === null ? false : (setting?.spot?.overprint ?? fileOverprint);
      out.set(color.id, paintOf({ kind: "CMYK", cmyk }, overprint));
      continue;
    }
    // `spot: null` stänger av kartfilens dekorfärg och övertryck även i PRESS.
    if (setting?.spot === null) {
      out.set(color.id, paintOf({ kind: "CMYK", cmyk }, false));
      continue;
    }
    if (setting?.spot) {
      const name = plateName(setting.spot.name);
      // Plåtens CMYK-alternativ ur o-ljusad färg; `lighten` styr plåtens andel (`tints`).
      const baseCmyk: Cmyk = setting.cmyk ?? color.cmyk;
      const alternate = plates.define(name, baseCmyk, `profilens rad för "${color.name}"`);
      const tint = lightened(1, setting.lighten);
      out.set(color.id, paintOf({ kind: "SPOT", names: [name], alternates: [alternate], tints: [tint] }, setting.spot.overprint));
      continue;
    }
    if (separations.length === 0 || setting?.cmyk) {
      out.set(color.id, paintOf({ kind: "CMYK", cmyk }, fileOverprint));
      continue;
    }
    const names: string[] = [], alternates: Cmyk[] = [], tints: number[] = [];
    for (const separation of separations) {
      const name = plateName(separation.name);
      const index = names.indexOf(name);
      const tint = lightened(separation.factor, setting?.lighten);
      if (index >= 0) { tints[index] = Math.min(1, tints[index]! + tint); continue; }
      // Dekorfärgens CMYK ur filen; saknas den räknas den ur färgens CMYK och andelen.
      const own = separation.cmyk ?? (separation.factor > 0 ? { c: clamp01(color.cmyk.c / separation.factor), m: clamp01(color.cmyk.m / separation.factor),
        y: clamp01(color.cmyk.y / separation.factor), k: clamp01(color.cmyk.k / separation.factor) } : color.cmyk);
      names.push(name); alternates.push(plates.define(name, own, `"${color.name}"`)); tints.push(tint);
    }
    out.set(color.id, paintOf({ kind: "SPOT", names, alternates, tints }, fileOverprint));
  }
  if (options.mode === "PROCESS" && spotsInFile) notes.add("Kartans dekorfärger skrivs som CMYK (kartfärgernas egna CMYK-värden) med filens övertryck.");
  return out;
}
