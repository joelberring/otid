import type { RaceAdministratorAction } from "./race-administrator-route-context";

/**
 * Demoläget (ADR-0220, tillägg 2026-11-16, ägaren: "prova men inte spara eller skriva ut"): det gästkontot inte får göra på
 * sin demotävling. Allt som lämnar tävlingen som en fil (utskrift, PDF, säkerhetskopia, export, den inlästa banfilen), tar in
 * filer från okända besökare (banfil, kartbild, kartfil, papper, logga) eller når tjänster utanför O-Tid (Eventor,
 * löpardatabasen med riktiga namn, radiokontrollerna). Publicering, kartlänk och mejl är redan stängda i applikationslagret.
 *
 * Kartbilden och kartfilen som banläggningen ritar ur går att läsa, eftersom webbläsaren visar kartan ur dem.
 */
const BLOCKED: Readonly<Partial<Record<RaceAdministratorAction["kind"], readonly string[] | "ALL">>> = {
  "race-export": "ALL", "race-backup-status": "ALL", "result-export": "ALL", "start-list-export": "ALL",
  "map-print": "ALL", "map-bundles": "ALL",
  "course-setting-original": "ALL", "course-setting-import": "ALL", "course-file-preview": "ALL",
  "course-setting-print-jobs": ["POST"], "course-setting-print-job-pdf": "ALL",
  "course-setting-print-files": ["POST"], "course-setting-print-file": ["GET"],
  "course-setting-paper-images": "ALL", "course-setting-paper-library": ["POST"],
  "race-map": ["PUT", "DELETE"], "race-map-source": ["POST", "DELETE"], "race-map-georeference": "ALL",
  "party-logo": "ALL",
  eventor: "ALL", "eventor-events": "ALL", "eventor-event": "ALL", "eventor-test": "ALL", "eventor-sync-preview": "ALL",
  "runner-database": "ALL", "runner-search": "ALL", radio: ["PUT"], "radio-fetch": "ALL"
};

/** Får ett gästkonto göra åtgärden med metoden? */
export function guestMayUse(kind: RaceAdministratorAction["kind"], method: string): boolean {
  const blocked = BLOCKED[kind];
  if (!blocked) return true;
  return blocked !== "ALL" && !blocked.includes(method);
}
