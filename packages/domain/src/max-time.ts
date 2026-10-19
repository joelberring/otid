/**
 * PLAN.md steg 25: maxtid per klass. Ett godkänt resultat med längre löptid än klassens maxtid får status
 * `OVERTIME` ("Maxtid överskriden"): det redovisas efter de godkända och får ingen placering. Felstämpling går före.
 * Rogaining har egen tidsgräns med straff och berörs inte. Exakt maxtid är godkänt.
 */
export function maxTimeMs(maxTimeMinutes: number | null | undefined): number | undefined {
  return typeof maxTimeMinutes === "number" && Number.isSafeInteger(maxTimeMinutes) && maxTimeMinutes > 0
    ? maxTimeMinutes * 60_000 : undefined;
}

/**
 * Status och orsak för ett fullständigt resultat (alla kontroller) med given löptid. Andra utfall (felstämpling)
 * lämnas orörda. Används av bedömningen och när arrangören rättar start- eller måltid.
 */
export function withMaxTime<T extends { readonly status: string; readonly reason: string; readonly elapsedMs?: number | undefined }>(
  outcome: T, maxTimeMinutes: number | null | undefined): T {
  const complete = (outcome.status === "OK" && outcome.reason === "COMPLETE") ||
    (outcome.status === "OVERTIME" && outcome.reason === "MAX_TIME_EXCEEDED");
  if (!complete || outcome.elapsedMs === undefined) return outcome;
  const limit = maxTimeMs(maxTimeMinutes);
  const over = limit !== undefined && outcome.elapsedMs > limit;
  return over ? { ...outcome, status: "OVERTIME", reason: "MAX_TIME_EXCEEDED" }
    : { ...outcome, status: "OK", reason: "COMPLETE" };
}
