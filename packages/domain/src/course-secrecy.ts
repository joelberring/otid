/**
 * Steg 52 (ADR-0176): banhemlighet. Banorna (gafflingsbilden, kontrollernas lägen och kontrollkartan) visas publikt först
 * när ingen deltagare är kvar, när resultaten är fastställda ("Resultaten är klara") eller när arrangören valt "Visa banorna
 * publikt nu". Arrangören och funktionärerna ser alltid allt. Variantkoden och sträcktiderna med kontrollkoder påverkas inte.
 */
export type CoursePublicReason = "REVEALED" | "FINALIZED" | "ALL_FINISHED";

export interface CourseSecrecyFacts {
  /** Ej strukna deltagare: om var och en har ett resultat eller ett beslut (även ej start). */
  readonly entries: readonly { readonly hasResult: boolean }[];
  /** Loppets resultat är fastställda (`race.official_result_finalization_id`). */
  readonly finalized: boolean;
  /** Arrangören har valt "Visa banorna publikt nu". */
  readonly revealed: boolean;
}

export interface CourseSecrecy {
  readonly public: boolean;
  /** Varför banorna är publika (det första som gäller i ordningen val, fastställt, alla i mål). */
  readonly reason: CoursePublicReason | null;
  /** Deltagare utan resultat eller beslut. */
  readonly remaining: number;
}

/**
 * Banorna är publika när arrangören valt det, när resultaten är fastställda eller när det finns minst en deltagare och
 * alla har ett resultat eller beslut. Utan deltagare är banorna hemliga (annars vore de publika innan anmälan öppnar).
 */
export function courseSecrecy(facts: CourseSecrecyFacts): CourseSecrecy {
  const remaining = facts.entries.filter(entry => !entry.hasResult).length;
  const reason: CoursePublicReason | null = facts.revealed ? "REVEALED" : facts.finalized ? "FINALIZED"
    : facts.entries.length > 0 && remaining === 0 ? "ALL_FINISHED" : null;
  return { public: reason !== null, reason, remaining };
}

/**
 * ADR-0185: före start. Variantens bokstav och kartbilden är ofta hemliga före start; publikt visas de först efter start
 * (förval) eller, om arrangören valt det under Publicera, alltid (varianten) eller direkt när tävlingen publiceras (kartan).
 * När banorna är publika enligt banhemligheten ovan visas båda.
 */
export type PublicVariantTiming = "AFTER_START" | "ALWAYS";
export type PublicMapTiming = "AFTER_START" | "ON_PUBLISH";

/** Har tiden `startTime` (ISO 8601) passerat? En saknad eller oläslig tid räknas som inte passerad. */
export function startHasPassed(startTime: string | null | undefined, now: Date): boolean {
  if (!startTime) return false;
  const at = Date.parse(startTime);
  return Number.isFinite(at) && at <= now.getTime();
}

/**
 * Löparens variant publikt: alltid med valet ALWAYS eller när banorna är publika; annars först när löparen har startat
 * (`started`, t.ex. ett resultat eller en växling) eller starttiden har passerat. Utan känd start visas den inte.
 */
export function publicVariantVisible(input: { readonly timing: PublicVariantTiming; readonly coursesPublic: boolean;
  readonly startTime?: string | null; readonly started?: boolean; readonly now: Date }): boolean {
  return input.timing === "ALWAYS" || input.coursesPublic || input.started === true || startHasPassed(input.startTime, input.now);
}

/** Kartbilden publikt: direkt med valet ON_PUBLISH eller när banorna är publika, annars när tävlingen har startat. */
export function publicMapVisible(input: { readonly timing: PublicMapTiming; readonly coursesPublic: boolean;
  readonly started: boolean }): boolean {
  return input.timing === "ON_PUBLISH" || input.coursesPublic || input.started;
}
