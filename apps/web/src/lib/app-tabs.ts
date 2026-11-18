/**
 * Förslag B (ägaren 2026-11-18, ADR-0227 tillägg): flikraden nertill för inloggade i telefonbredd. Ren TypeScript: vilken flik som är
 * aktiv för en sökväg och var raden inte visas. Raden ritas bara av de inloggade delarnas layouter (`/organizer`, `/admin`,
 * `/konto`, `/superadmin`); publika sidor har den aldrig.
 */
export type AppTab = "home" | "maps" | "courses" | "events" | "club";

export interface AppTabLink { tab: AppTab; href: string; /** Vanlig länk (hela sidan laddas) i stället för Next-länk. */ plain?: boolean }

/**
 * Flikarnas mål. Det finns ingen egen listsida för banor, träningar eller klubbar: Banor öppnar panelen Lägg banor i Mitt O-Tid
 * (`#lagg-banor`), Träningar listan Dina tävlingar och Klubb remsan Mina klubbar (där man också går med i en klubb).
 * Banor är en vanlig länk så att webbläsaren ger `hashchange` även när Mitt O-Tid redan är öppet.
 */
export const APP_TAB_LINKS: readonly AppTabLink[] = [
  { tab: "home", href: "/organizer" },
  { tab: "maps", href: "/organizer/map-projects" },
  { tab: "courses", href: "/organizer#lagg-banor", plain: true },
  { tab: "events", href: "/organizer#dina-tavlingar" },
  { tab: "club", href: "/organizer#mina-klubbar" }
];

/** Ankaret i Mitt O-Tid som öppnar panelen Lägg banor. */
export const COURSE_TAB_HASH = "#lagg-banor";

const ADMIN = /^\/admin\/[^/]+(\/.*)?$/;

/**
 * Sidor i de inloggade delarna där raden inte visas: helskärmslägen och kioskvyer. Kartredigeraren, banläggningen med sina
 * undersidor (rityta, layout, utskrift, kontrollbeskrivningar, kartfel), speakern, stationerna, avläsningen och klubbens
 * utskrift av terminsplaneringen.
 */
export function appTabsHidden(pathname: string): boolean {
  const path = trim(pathname);
  if (/^\/organizer\/map-projects\/[^/]+\/map$/.test(path)) return true;
  if (/^\/organizer\/clubs\/[^/]+\/planering\/utskrift$/.test(path)) return true;
  const admin = ADMIN.exec(path);
  if (admin) {
    const rest = admin[1] ?? "";
    return /^\/(course-setting|speaker|stations|readout)(\/|$)/.test(rest);
  }
  return false;
}

/** Fliken som hör till sidan, eller null (Mitt konto, superadmin). */
export function activeAppTab(pathname: string): AppTab | null {
  const path = trim(pathname);
  if (path === "/organizer") return "home";
  if (path === "/organizer/map-projects" || path.startsWith("/organizer/map-projects/")) return "maps";
  if (/^\/organizer\/(clubs|groups)(\/|$)/.test(path)) return "club";
  const admin = ADMIN.exec(path);
  if (admin) return /^\/course-setting(\/|$)/.test(admin[1] ?? "") ? "courses" : "events";
  return null;
}

/** Utan avslutande snedstreck (utom för roten) och utan fråga eller ankare. */
function trim(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? "";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}
