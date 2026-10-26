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
