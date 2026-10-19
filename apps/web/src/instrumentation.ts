/**
 * Körs en gång när servern startar (inte under `next build`). Varnar för gamla Eventor-variabler i miljön (PLAN.md steg 27)
 * och startar pollern för radiokontroller (ADR-0172 beslut 5, `lib/radio-poller.ts`) i Node-körningen.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { legacyEventorEnvironmentWarning } = await import("./lib/eventor-runtime");
  const warning = legacyEventorEnvironmentWarning(process.env);
  if (warning) console.warn(warning);
  const { startRadioPoller } = await import("./lib/radio-poller");
  startRadioPoller();
}
