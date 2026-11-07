/**
 * Körs en gång när servern startar (inte under `next build`). Skriver fel inställningar i loggen (ADR-0186), varnar för gamla
 * Eventor-variabler i miljön (PLAN.md steg 27)
 * och startar pollern för radiokontroller (ADR-0172 beslut 5, `lib/radio-poller.ts`) och underhållet (ADR-0189,
 * `lib/maintenance-runner.ts`) och serverns bevakning (ADR-0216, `lib/server-watch-runner.ts`) i Node-körningen.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  // ADR-0186: fel inställningar skrivs i loggen direkt i stället för att bara ge tomma 500-svar senare.
  const { logConfigurationProblems } = await import("./lib/startup-check");
  logConfigurationProblems(process.env);
  const { legacyEventorEnvironmentWarning } = await import("./lib/eventor-runtime");
  const warning = legacyEventorEnvironmentWarning(process.env);
  if (warning) console.warn(warning);
  const { startRadioPoller } = await import("./lib/radio-poller");
  startRadioPoller();
  // ADR-0189: kartinnehåll utan tävling och den valfria gallringen, en gång i timmen.
  const { startMaintenanceRunner } = await import("./lib/maintenance-runner");
  startMaintenanceRunner();
  // ADR-0216: serverns bevakning – mätningen, larmen och veckorapporten till superadmin.
  const { startServerWatch } = await import("./lib/server-watch-runner");
  startServerWatch();
}
