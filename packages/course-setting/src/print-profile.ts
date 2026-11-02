/**
 * Steg 64 (ADR-0183): utskriftsprofilen. Kartans färger rättas för en skrivare eller ett tryckeri utan OCAD och utan
 * att kartfilen sparas om: profilen gäller bara utskriften (macpurplepens integritetsregel). Formatet är versionerat
 * (`schemaVersion`); en okänd version avvisas i stället för att tolkas med dagens antaganden. Förhandskontrollen följer
 * macpurplepens ColorPreflight.cs och de inbyggda BL-profilerna dess PrintProfiles.cs (BSD, Purple Pen Next); reglerna
 * ändrar ingenting, de ger en rapport med information, varningar och blockerande fel.
 */
import type { MapColor } from "@o-tid/map-file";
import { CourseSettingEditError } from "./types";

export const PRINT_PROFILE_SCHEMA_VERSION = 1;

/** CMYK i procent 0–100 (som OCAD och tryckeriernas tabeller). */
export interface Cmyk100 { readonly c: number; readonly m: number; readonly y: number; readonly k: number }

/** Vilka kartfärger en rad gäller: OCAD-id, exakt namn eller del av namnet (skiftlägesokänsligt, "grön|green"). */
export interface ColorMatch {
  readonly ocadIds?: readonly number[] | undefined;
  readonly names?: readonly string[] | undefined;
  readonly namePattern?: string | undefined;
}

/** Ändringen av matchade kartfärger vid utskrift. `lighten` −100…100: positivt ljusare, negativt mörkare. */
export interface MapColorSetting {
  readonly match: ColorMatch;
  readonly hidden?: boolean | undefined;
  readonly lighten?: number | undefined;
  readonly cmyk?: Cmyk100 | undefined;
  /** Dekorfärg med eller utan övertryck (steg 65 skriver den som egen separation). */
  readonly spot?: { readonly name: string; readonly overprint: boolean } | undefined;
}

/** En regel i förhandskontrollen (macpurplepens PrintProfileColorRule). */
export interface PreflightRule {
  readonly id: string;
  readonly name: string;
  readonly match: ColorMatch;
  readonly cmyk: Cmyk100;
  readonly overprint: boolean;
  /** Regler som färgen ska ligga under respektive över i kartans färgordning. */
  readonly below?: readonly string[] | undefined;
  readonly above?: readonly string[] | undefined;
}

export interface PrintProfile {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly description?: string | undefined;
  /** Varifrån värdena kommer (t.ex. tryckeriets färgtabell och datum). */
  readonly source?: string | undefined;
  /** Banans färg: CMYK, dekorfärgens namn och övertryck. */
  readonly course: { readonly cmyk: Cmyk100; readonly spotName: string; readonly overprint: boolean };
  /** Kartans färger vid utskrift; den första raden som matchar en färg gäller. */
  readonly mapColors: readonly MapColorSetting[];
  readonly rules: readonly PreflightRule[];
  /** Vad trycket kräver (blockerar i rapporten tills steg 65 kan det). */
  readonly requirements: { readonly pdfX: boolean; readonly icc: boolean; readonly trueOverprint: boolean };
}

/** Purple Pens lila (CourseAppearance: 20/100/0/0) som dekorfärg med övertryck. */
export const PURPLE_PEN_COURSE = { cmyk: { c: 20, m: 100, y: 0, k: 0 }, spotName: "Purple", overprint: true } as const;

const NO_REQUIREMENTS = { pdfX: false, icc: false, trueOverprint: false } as const;
const rule = (id: string, name: string, cmyk: [number, number, number, number], match: ColorMatch, extra: Partial<PreflightRule> = {}): PreflightRule =>
  ({ id, name, match, cmyk: { c: cmyk[0], m: cmyk[1], y: cmyk[2], k: cmyk[3] }, overprint: false, ...extra });
const named = (name: string, ocadIds: number[] = []) => ({ names: [name], ...(ocadIds.length > 0 ? { ocadIds } : {}) });

/** Färdiga profiler: som i filen, kontorsskrivare och BL Idrottsservice skog och sprint (ur macpurplepen). */
export const BUILT_IN_PRINT_PROFILES: readonly PrintProfile[] = [
  {
    schemaVersion: 1, id: "as-file", name: "Tryckeri (som i filen)", description: "Kartans färger som i kartfilen; banan i Purple Pens lila med övertryck.",
    course: PURPLE_PEN_COURSE, mapColors: [], rules: [], requirements: NO_REQUIREMENTS
  },
  {
    schemaVersion: 1, id: "office", name: "Kontorsskrivare (ljusare grönt)",
    description: "Kontorsskrivare trycker grönt och gult för mörkt: gröna ytor 30 % ljusare, gula 15 %.",
    course: { cmyk: { c: 20, m: 100, y: 0, k: 0 }, spotName: "Purple", overprint: false },
    mapColors: [{ match: { namePattern: "grön|green" }, lighten: 30 }, { match: { namePattern: "gul|yellow" }, lighten: 15 }],
    rules: [], requirements: NO_REQUIREMENTS
  },
  {
    schemaVersion: 1, id: "bl-forest-2026-08-27", name: "BL skog", source: "BL Idrottsservice, färginställningar kartnormen (2026-08-27)",
    course: { cmyk: { c: 35, m: 95, y: 0, k: 0 }, spotName: "Violett transparent", overprint: true },
    mapColors: [],
    rules: [
      rule("violet-opaque", "Violett", [35, 95, 0, 0], named("Violett", [50])),
      rule("black", "Svart", [0, 0, 0, 100], named("Svart")),
      rule("road-fill", "Vägfyllning", [0, 28, 45, 12], named("Vägfyllning")),
      rule("blue-line-point", "Blå linje och punkt", [100, 0, 0, 0], named("Blå linje och punkt")),
      rule("brown-contours", "Brun för höjdkurvor mm", [0, 75, 100, 33], named("Brun för höjdkurvor mm")),
      rule("violet-transparent", "Violett transparent", [35, 95, 0, 0], named("Violett transparent", [52]),
        { overprint: true, below: ["brown-contours", "black", "blue-area"], above: ["blue-70", "blue-50"] }),
      rule("blue-area", "Blå yta", [100, 0, 0, 0], named("Blå yta")),
      rule("blue-70", "Blå 70%", [70, 0, 0, 0], named("Blå 70%")),
      rule("blue-50", "Blå 50%", [50, 0, 0, 0], named("Blå 50%")),
      rule("green-100", "Grön 100%", [76, 0, 91, 0], named("Grön 100%")),
      rule("green-60", "Grön 60%", [44, 0, 54, 0], named("Grön 60%")),
      rule("green-30", "Grön 30%", [20, 0, 26, 0], named("Grön 30%")),
      rule("yellow-100", "Gul 100%", [0, 27, 94, 0], named("Gul 100%")),
      rule("yellow-50", "Gul 50%", [0, 20, 44, 0], named("Gul 50%"))
    ],
    requirements: NO_REQUIREMENTS
  },
  {
    schemaVersion: 1, id: "bl-sprint-2025-05-01", name: "BL sprint", source: "BL Idrottsservice, färginställning sprintnormen (2025-05-01)",
    course: { cmyk: { c: 35, m: 100, y: 0, k: 0 }, spotName: "Violett (kontrollringar mm)", overprint: true },
    mapColors: [],
    rules: [
      rule("black", "Svart", [0, 0, 0, 100], named("Svart")),
      rule("blue", "Blå", [100, 0, 0, 0], named("Blå")),
      rule("brown", "Brun", [0, 80, 100, 25], named("Brun")),
      rule("course-violet", "Violett (kontrollringar mm)", [35, 100, 0, 0], named("Violett (kontrollringar mm)"), { overprint: true }),
      rule("green-area", "Grön (ytor)", [74, 0, 91, 0], named("Grön (ytor)")),
      rule("green-60", "Grön 60%", [42, 0, 54, 0], named("Grön 60%")),
      rule("green-30", "Grön 30%", [21, 0, 26, 0], named("Grön 30%")),
      rule("yellow", "Gul", [0, 28, 95, 0], named("Gul")),
      rule("yellow-50", "Gul 50%", [0, 21, 44, 0], named("Gul 50%"))
    ],
    requirements: NO_REQUIREMENTS
  }
];

const invalid = (message: string) => new CourseSettingEditError("INVALID", `Utskriftsprofilen: ${message}`);
const percent = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
const isCmyk = (value: unknown): value is Cmyk100 => typeof value === "object" && value !== null
  && ["c", "m", "y", "k"].every(key => percent((value as Record<string, unknown>)[key]));

function checkMatch(match: unknown, where: string): void {
  if (typeof match !== "object" || match === null) throw invalid(`${where} saknar vilka färger den gäller`);
  const { ocadIds, names, namePattern } = match as ColorMatch;
  if (ocadIds !== undefined && !(Array.isArray(ocadIds) && ocadIds.every(id => Number.isInteger(id)))) throw invalid(`${where}: OCAD-id är inte heltal`);
  if (names !== undefined && !(Array.isArray(names) && names.every(name => typeof name === "string"))) throw invalid(`${where}: namnen är inte text`);
  if (namePattern !== undefined) {
    if (typeof namePattern !== "string" || namePattern.length > 200) throw invalid(`${where}: mönstret är inte text`);
    try { new RegExp(namePattern, "i"); } catch { throw invalid(`${where}: mönstret går inte att läsa`); }
  }
}

/** Kontrollerar en profil (ur JSON eller en ändring). Okänd `schemaVersion` avvisas. */
export function validatePrintProfile(value: unknown): PrintProfile {
  if (typeof value !== "object" || value === null) throw invalid("inte ett objekt");
  const profile = value as PrintProfile;
  if (profile.schemaVersion !== PRINT_PROFILE_SCHEMA_VERSION) throw invalid(`schemaVersion ${String(profile.schemaVersion)} stöds inte`);
  if (typeof profile.id !== "string" || profile.id === "" || typeof profile.name !== "string" || profile.name.trim() === "") throw invalid("saknar id eller namn");
  if (!profile.course || !isCmyk(profile.course.cmyk) || typeof profile.course.spotName !== "string" || typeof profile.course.overprint !== "boolean") {
    throw invalid("banans färg är inte CMYK 0–100 med dekorfärg och övertryck");
  }
  if (!Array.isArray(profile.mapColors) || profile.mapColors.length > 500) throw invalid("kartans färger saknas");
  (profile.mapColors as readonly MapColorSetting[]).forEach((setting, index) => {
    checkMatch(setting.match, `rad ${index + 1}`);
    if (setting.lighten !== undefined && !(Number.isFinite(setting.lighten) && Math.abs(setting.lighten) <= 100)) throw invalid(`rad ${index + 1}: ljusare −100…100`);
    if (setting.cmyk !== undefined && !isCmyk(setting.cmyk)) throw invalid(`rad ${index + 1}: CMYK 0–100`);
    if (setting.spot !== undefined && !(typeof setting.spot.name === "string" && typeof setting.spot.overprint === "boolean")) throw invalid(`rad ${index + 1}: dekorfärgen`);
  });
  if (!Array.isArray(profile.rules) || profile.rules.length > 500) throw invalid("reglerna saknas");
  for (const item of profile.rules as readonly PreflightRule[]) {
    if (typeof item.id !== "string" || !isCmyk(item.cmyk) || typeof item.overprint !== "boolean") throw invalid(`regeln ${String(item.id)}`);
    checkMatch(item.match, `regeln ${item.id}`);
  }
  if (!profile.requirements || typeof profile.requirements.pdfX !== "boolean") throw invalid("kraven saknas");
  return profile;
}

/** En profil ur JSON (export/import mellan tävlingar). */
export function parsePrintProfile(json: string): PrintProfile {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw invalid("inte JSON"); }
  return validatePrintProfile(value);
}

/** Kartans färg som förhandskontrollen ser den: OCAD-id, namn, CMYK i procent, övertryck och ordning (0 = underst). */
export interface SourceMapColor { readonly ocadId: number; readonly name: string; readonly cmyk: Cmyk100; readonly overprint: boolean; readonly drawOrder: number }

/** Kartfilens färger i ritordning (underst först, som `drawMap` ritar dem). */
export function sourceMapColors(colors: readonly Pick<MapColor, "id" | "name" | "rank" | "cmyk" | "spot">[]): SourceMapColor[] {
  const order = [...colors].sort((left, right) => right.rank - left.rank || left.id - right.id);
  const round = (value: number) => Math.round(value * 100_000) / 1000;
  return order.map((color, drawOrder) => ({ ocadId: color.id, name: color.name,
    cmyk: { c: round(color.cmyk.c), m: round(color.cmyk.m), y: round(color.cmyk.y), k: round(color.cmyk.k) },
    overprint: color.spot?.overprint ?? false, drawOrder }));
}

function matches(match: ColorMatch, color: { ocadId: number; name: string }): boolean {
  if (match.ocadIds?.includes(color.ocadId)) return true;
  if (match.names?.some(name => name.toLowerCase() === color.name.toLowerCase())) return true;
  return match.namePattern !== undefined && new RegExp(match.namePattern, "i").test(color.name);
}

/** Justeringen per kartfärg (id) för `drawMap` och PDF:en: dold, CMYK 0–1 och ljusare (andel). */
export interface MapColorAdjust { readonly hidden?: boolean; readonly cmyk?: { c: number; m: number; y: number; k: number }; readonly lighten?: number;
  readonly spot?: { readonly name: string; readonly overprint: boolean } }

/** Profilens ändringar av kartans färger; färger som ingen rad gäller är som i filen. */
export function mapColorAdjust(profile: PrintProfile | undefined, colors: readonly Pick<MapColor, "id" | "name">[]): Record<number, MapColorAdjust> {
  const out: Record<number, MapColorAdjust> = {};
  if (!profile) return out;
  for (const color of colors) {
    const setting = profile.mapColors.find(item => matches(item.match, { ocadId: color.id, name: color.name }));
    if (!setting) continue;
    out[color.id] = {
      ...(setting.hidden ? { hidden: true } : {}),
      ...(setting.cmyk ? { cmyk: { c: setting.cmyk.c / 100, m: setting.cmyk.m / 100, y: setting.cmyk.y / 100, k: setting.cmyk.k / 100 } } : {}),
      ...(setting.lighten ? { lighten: setting.lighten / 100 } : {}),
      ...(setting.spot ? { spot: setting.spot } : {})
    };
  }
  return out;
}

export type PreflightSeverity = "INFO" | "WARNING" | "BLOCKING";
export type PreflightMatch = "NOT_PRESENT" | "MATCHED" | "NEEDS_CONFIRMATION" | "AMBIGUOUS";

export interface PreflightFinding { readonly severity: PreflightSeverity; readonly rule?: string | undefined; readonly text: string }
export interface PreflightRuleResult { readonly rule: string; readonly name: string; readonly status: PreflightMatch; readonly candidates: readonly SourceMapColor[];
  readonly confirmed: boolean }
export interface PreflightReport { readonly profile: string; readonly results: readonly PreflightRuleResult[]; readonly findings: readonly PreflightFinding[];
  readonly canPrint: boolean }

/** Vad utskriften kan: webbläsarens utkast inget av det; PDF:en (steg 65) äkta övertryck men inte PDF/X och ICC (inte verifierat). */
export interface PrintCapabilities { readonly pdfX: boolean; readonly icc: boolean; readonly trueOverprint: boolean }
export const BROWSER_DRAFT_CAPABILITIES: PrintCapabilities = { pdfX: false, icc: false, trueOverprint: false };
/** Steg 65 (ADR-0184): PDF:en från `@o-tid/print-pdf`. PDF/X och ICC påstås inte förrän de är verifierade hos ett tryckeri. */
export const PDF_PRINT_CAPABILITIES: PrintCapabilities = { pdfX: false, icc: false, trueOverprint: true };

const sameCmyk = (a: Cmyk100, b: Cmyk100) => Math.abs(a.c - b.c) <= 0.01 && Math.abs(a.m - b.m) <= 0.01 && Math.abs(a.y - b.y) <= 0.01 && Math.abs(a.k - b.k) <= 0.01;
const hasInk = (cmyk: Cmyk100) => cmyk.c > 0.01 || cmyk.m > 0.01 || cmyk.y > 0.01 || cmyk.k > 0.01;
const cmykText = (cmyk: Cmyk100) => `${cmyk.c}/${cmyk.m}/${cmyk.y}/${cmyk.k}`;

/**
 * Förhandskontrollen (ColorPreflight.Analyze): varje regel matchas mot kartans färger på namn och OCAD-id (annars CMYK),
 * en delvis träff behöver bekräftas och flera träffar är tvetydiga (blockerande tills de bekräftas eller väljs). Avvikande
 * CMYK, saknat övertryck och fel ordning är varningar. Ändrar ingenting.
 */
export function colorPreflight(profile: PrintProfile, colors: readonly SourceMapColor[], capabilities: PrintCapabilities = BROWSER_DRAFT_CAPABILITIES,
  confirmed: ReadonlySet<string> = new Set()): PreflightReport {
  const findings: PreflightFinding[] = [];
  const need = (required: boolean, supported: boolean, text: string) => { if (required && !supported) findings.push({ severity: "BLOCKING", text }); };
  need(profile.requirements.pdfX, capabilities.pdfX, "Profilen kräver PDF/X med OutputIntent, som O-Tid inte kan ge än (inte verifierat).");
  need(profile.requirements.icc, capabilities.icc, "Profilen kräver en inbäddad ICC-profil, som O-Tid inte kan ge än (inte verifierat).");
  need(profile.requirements.trueOverprint, capabilities.trueOverprint, "Profilen kräver äkta övertryck, som bara PDF:en för tryck kan ge (inte webbläsarens utskrift).");
  const results: PreflightRuleResult[] = [];
  for (const item of profile.rules) {
    let candidates = colors.filter(color => matches(item.match, color));
    let status: PreflightMatch;
    if (candidates.length > 1) {
      const byCmyk = candidates.filter(color => sameCmyk(color.cmyk, item.cmyk));
      if (byCmyk.length === 1) { candidates = byCmyk; status = "NEEDS_CONFIRMATION"; } else status = "AMBIGUOUS";
    } else if (candidates.length === 0) {
      candidates = hasInk(item.cmyk) ? colors.filter(color => sameCmyk(color.cmyk, item.cmyk)) : [];
      status = candidates.length === 1 ? "NEEDS_CONFIRMATION" : candidates.length > 1 ? "AMBIGUOUS" : "NOT_PRESENT";
    } else {
      const color = candidates[0]!;
      const nameOk = !item.match.names?.length || item.match.names.some(name => name.toLowerCase() === color.name.toLowerCase());
      const idOk = !item.match.ocadIds?.length || item.match.ocadIds.includes(color.ocadId);
      status = nameOk && idOk ? "MATCHED" : "NEEDS_CONFIRMATION";
    }
    const isConfirmed = status === "NEEDS_CONFIRMATION" && confirmed.has(item.id) && candidates.length === 1;
    results.push({ rule: item.id, name: item.name, status, candidates, confirmed: isConfirmed });
    if (status === "NOT_PRESENT") findings.push({ severity: "INFO", rule: item.id, text: `${item.name} finns inte i kartan.` });
    else if (status === "NEEDS_CONFIRMATION") findings.push({ severity: isConfirmed ? "WARNING" : "BLOCKING", rule: item.id,
      text: isConfirmed ? `${item.name}: bara delvis samma namn eller id, bekräftad.` : `${item.name}: behöver bekräftas (${candidates[0]!.name}, OCAD ${candidates[0]!.ocadId}).` });
    else if (status === "AMBIGUOUS") findings.push({ severity: "BLOCKING", rule: item.id, text: `${item.name}: tvetydig, ${candidates.length} kartfärger passar.` });
    if ((status === "MATCHED" || isConfirmed) && candidates.length === 1) {
      const color = candidates[0]!;
      if (!sameCmyk(color.cmyk, item.cmyk)) findings.push({ severity: "WARNING", rule: item.id,
        text: `${item.name} ska ha CMYK ${cmykText(item.cmyk)}, kartan har ${cmykText(color.cmyk)}.` });
      if (item.overprint && !color.overprint) findings.push({ severity: "WARNING", rule: item.id, text: `${item.name} ska ha övertryck men är utslagen i kartan.` });
    }
  }
  const resolved = new Map(results.filter(result => (result.status === "MATCHED" || result.confirmed) && result.candidates.length === 1)
    .map(result => [result.rule, result.candidates[0]!]));
  for (const item of profile.rules) {
    const color = resolved.get(item.id);
    if (!color) continue;
    for (const [list, below] of [[item.below ?? [], true], [item.above ?? [], false]] as const) {
      for (const other of list) {
        const related = resolved.get(other);
        if (!related) continue;
        if (below ? color.drawOrder >= related.drawOrder : color.drawOrder <= related.drawOrder) {
          findings.push({ severity: "WARNING", rule: item.id, text: `${item.name} ska ligga ${below ? "under" : "över"} ${profile.rules.find(rule => rule.id === other)?.name ?? other}.` });
        }
      }
    }
  }
  return { profile: profile.id, results, findings, canPrint: !findings.some(finding => finding.severity === "BLOCKING") };
}

/** CMYK i procent som skärmfärg (förhandsvisningen; tryckets färger står i PDF:en). */
export function cmykToCss(cmyk: Cmyk100): string {
  const k = 1 - cmyk.k / 100;
  const channel = (value: number) => Math.round(255 * (1 - value / 100) * k);
  return `rgb(${channel(cmyk.c)}, ${channel(cmyk.m)}, ${channel(cmyk.y)})`;
}
