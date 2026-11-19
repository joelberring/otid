import type { BingoMode, CourseSettingLevel, RaceType } from "@o-tid/contracts";
import { inRaceDay } from "@o-tid/domain";
import { mobileExerciseLink } from "./mobile-exercise";
import { profileForRole, raceTypeProfile, visibleSections, workspacePath, type SectionId, type SectionLabel,
  type WorkspaceRole } from "./race-sections";

/**
 * Tävlingsraden (ägaren 2026-11-18, ADR-0227 tillägg): i telefonbredd byts flikraden mot arrangemangets egen rad inne i
 * `/admin/{id}/…`. Ren TypeScript: vilka flikar och vilka rader under Mer som gäller för typen, läget och rollen, vilken som
 * är aktiv och vilket läge som väljs automatiskt. Behörigheten följer arbetsytans (`profileForRole`); servern prövar ändå
 * varje anrop som förut.
 */
export type RaceMode = "PREPARE" | "RACE_DAY";

export type RaceNavKey = "courses" | "classes" | "entries" | "start" | "publish" | "secretariat" | "results" | "party" | "people" |
  "settings" | "readout" | "speaker" | "exercise" | "mastermind" | "courseSetting";

/** Namnet på en rad: arbetsytans delnamn (utom Avläsning-delen, som här heter Sekretariat) eller en egen sida. */
export type RaceNavLabel = Exclude<SectionLabel, "READOUT"> | "SECRETARIAT" | "READOUT_STATION" | "PARTY_DESK" | "SPEAKER" |
  "COURSE_SETTING" | "MAP_ERRORS" | "EXERCISE_SETUP" | "MASTERMIND" | BingoMode;

export interface RaceNavItem {
  key: RaceNavKey;
  label: RaceNavLabel;
  href: string;
  /** Delen i arbetsytan; där byts delen utan att sidan laddas om. */
  section?: SectionId | undefined;
}

/** Det raden vet om arrangemanget och kontot (från servern, `loadRaceNavigationContext`). */
export interface RaceNavInput {
  raceId: string;
  raceType: RaceType;
  role: WorkspaceRole;
  courseSetting?: CourseSettingLevel | undefined;
  bingo?: { enabled: boolean; mode: BingoMode } | undefined;
}

/** Det layouten skickar till klienten: raden och överraden (namnet, datumet och tidszonen för det automatiska läget). */
export interface RaceNavContext extends RaceNavInput {
  eventName: string;
  raceName: string;
  raceDate: string;
  timeZone: string;
}

const SECTION_KEYS: Record<SectionId, RaceNavKey> = { COURSES: "courses", CLASSES: "classes", ENTRIES: "entries", START: "start",
  PUBLISH: "publish", READOUT: "secretariat", RESULTS: "results", PARTY: "party", PEOPLE: "people", SETTINGS: "settings" };

/** Flikarna i varje läge, i ordning; de som typen eller rollen saknar hoppas över och högst fyra visas (plus Mer). */
const TAB_ORDER: Record<RaceMode, readonly RaceNavKey[]> = {
  PREPARE: ["party", "courses", "classes", "entries", "start", "publish"],
  RACE_DAY: ["readout", "secretariat", "party", "results", "speaker", "exercise"]
};
const MAX_TABS = 4;

/** Alla rader som rollen får använda i arrangemanget, i Mer-listans ordning. */
export function raceNavItems(input: RaceNavInput): RaceNavItem[] {
  const profile = profileForRole(raceTypeProfile(input.raceType), input.role);
  const admin = input.role === "ADMIN";
  const party = profile.type === "PARTY";
  const base = `/admin/${input.raceId}`;
  const section = (id: SectionId, label: SectionLabel): RaceNavItem =>
    ({ key: SECTION_KEYS[id], label: label === "READOUT" ? "SECRETARIAT" : label, href: workspacePath(input.raceId, id), section: id });
  const sections = visibleSections(profile);
  const course = sections.filter(row => row.id !== "PEOPLE" && row.id !== "SETTINGS").map(row => section(row.id, row.label));
  const items: RaceNavItem[] = [...course,
    { key: "readout", label: party ? "PARTY_DESK" : "READOUT_STATION", href: `${base}/readout` }];
  if (profile.features.speaker) items.push({ key: "speaker", label: "SPEAKER", href: `${base}/speaker` });
  const exercise = mobileExerciseLink({ raceId: input.raceId, raceType: input.raceType, admin, bingo: input.bingo });
  if (exercise) items.push({ key: "exercise", label: exercise.target === "LEADER" && exercise.mode ? exercise.mode : "EXERCISE_SETUP",
    href: exercise.href });
  // PR #2: Mastermind med kontroller (stationen i ett eget statiskt skal, som avläsningen) i en träning; ett val för den som
  // sköter stationen, inte en övning i mobilen. Resultaten sparas på servern per träning (ADR-0228).
  if (input.raceType === "TRAINING") items.push({ key: "mastermind", label: "MASTERMIND", href: `${base}/mastermind` });
  if (input.courseSetting) items.push({ key: "courseSetting", label: input.courseSetting === "MAP" ? "MAP_ERRORS" : "COURSE_SETTING",
    href: `${base}/${input.courseSetting === "MAP" ? "course-setting/map-errors" : "course-setting"}` });
  for (const row of sections) if (row.id === "PEOPLE" || row.id === "SETTINGS") items.push(section(row.id, row.label));
  return items;
}

/**
 * Raden för läget: flikarna och resten under Mer. Övningen är bara en flik när den är på (ledarens sida). Har rollen ingen
 * flik i Förbereda (funktionären i en träning) visas tävlingsdagens, så att raden aldrig bara är Mer.
 */
export function raceNavigation(input: RaceNavInput, mode: RaceMode): { tabs: RaceNavItem[]; more: RaceNavItem[]; all: RaceNavItem[] } {
  const all = raceNavItems(input);
  const pick = (order: readonly RaceNavKey[]) => order.map(key => all.find(item => item.key === key))
    .filter((item): item is RaceNavItem => !!item && !(item.key === "exercise" && item.label === "EXERCISE_SETUP")).slice(0, MAX_TABS);
  let tabs = pick(TAB_ORDER[mode]);
  if (tabs.length === 0) tabs = pick(TAB_ORDER.RACE_DAY);
  return { tabs, more: all.filter(item => !tabs.includes(item)), all };
}

/** Var i arrangemanget sidan ligger: arbetsytan, en egen sida med rad, en stressvy med smal rad eller ingen rad. */
export type RaceNavPlacement = "workspace" | "page" | "narrow" | "none";

const ADMIN_RACE = /^\/admin\/([^/]+)(\/.*)?$/;

export function raceNavPlacement(pathname: string): RaceNavPlacement {
  const match = ADMIN_RACE.exec(trim(pathname));
  if (!match) return "none";
  const rest = match[2] ?? "";
  if (rest === "" || rest === "/manage") return "workspace";
  if (rest === "/speaker") return "narrow";
  // Helskärmslägen och kioskvyer: banläggningen, stationerna och avläsningen (som är ett eget statiskt skal med egen smal rad).
  if (/^\/(course-setting|stations|readout|mastermind)(\/|$)/.test(rest)) return "none";
  return "page";
}

/** Raden som hör till sidan; i arbetsytan delen som visas. Undersidorna hör till delen de nås från. */
export function activeRaceNavKey(pathname: string, section?: SectionId): RaceNavKey | undefined {
  const match = ADMIN_RACE.exec(trim(pathname));
  if (!match) return undefined;
  const rest = match[2] ?? "";
  if (rest === "" || rest === "/manage") return section ? SECTION_KEYS[section] : undefined;
  const page = /^\/([^/]+)/.exec(rest)?.[1];
  const pages: Record<string, RaceNavKey> = { readout: "readout", speaker: "speaker", bingo: "exercise", mastermind: "mastermind", "course-setting": "courseSetting",
    maps: "start", imports: "entries", "party-labels": "party", stations: "secretariat" };
  return page ? pages[page] : undefined;
}

/**
 * Läget som väljs automatiskt: Tävlingsdag under tävlingsdygnet (ADR-0178: 00:00 på tävlingsdagen till kl 12 dagen efter, i
 * arrangemangets tidszon), annars Förbereda. Bara den som har en roll ser raden.
 */
export function autoRaceMode(raceDate: string, timeZone: string, now: Date): RaceMode {
  return inRaceDay(now, raceDate, timeZone) ? "RACE_DAY" : "PREPARE";
}

/** Det manuella valet sparas per arrangemang i webbläsarens session (sessionStorage), inte på servern. */
export const raceModeStorageKey = (raceId: string) => `otid.raceMode.${raceId}`;

export function parseRaceMode(value: string | null | undefined): RaceMode | undefined {
  return value === "PREPARE" || value === "RACE_DAY" ? value : undefined;
}

function trim(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? "";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}
