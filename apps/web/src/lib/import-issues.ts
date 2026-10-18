import { iofImportErrorResponseSchema } from "@o-tid/contracts";

/**
 * Tolkens fel i klartext från ett 422-svar (PLAN.md steg 22), t.ex. vilken anmälan som har ett ogiltigt
 * bricknummer eller vilken bana som redan finns. `fallback` när svaret saknar felen.
 */
export async function importIssues(response: Response, fallback: string): Promise<string> {
  const parsed = iofImportErrorResponseSchema.safeParse(await response.json().catch(() => undefined));
  return parsed.success && parsed.data.issues?.length ? parsed.data.issues.join(" · ") : fallback;
}
