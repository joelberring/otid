import type { OrganizerMyEventsResponse, RaceType } from "@o-tid/contracts";
import { splitMyEvents, todayIn } from "./my-events-order";

/**
 * Översynen av navet 2026-11-17 (Mitt O-Tid): logiken bakom de fyra valen överst, "Lägg banor" och Kom igång för den som är ny.
 * Ren TypeScript; lagringen i webbläsaren är bara bekvämlighet (utan den visas allt som för en ny besökare).
 */
type MyEvent = OrganizerMyEventsResponse["events"][number];

/** Förvalt namn på träningen som "Lägg banor" skapar, med dagens datum i Stockholms tid. */
export function quickCourseName(now: Date, template: (date: string) => string): string {
  return template(todayIn("Europe/Stockholm", now));
}

export interface CourseSettingCandidate { raceId: string; eventName: string; raceName: string; raceDate: string }

/**
 * Loppen som "Lägg banor" erbjuder att fortsätta i: idag och kommande, närmast först, där kontot får lägga banor (ägare,
 * administratör eller banläggningens behörighet utom kartritarens, som bara ser kartfelen). Högst `limit`.
 */
export function courseSettingCandidates(events: readonly MyEvent[], now: Date, limit = 5): CourseSettingCandidate[] {
  const rows: CourseSettingCandidate[] = [];
  for (const event of splitMyEvents(events, now).current) {
    const today = todayIn(event.timeZone, now);
    for (const race of event.races) {
      if (race.raceDate < today) continue;
      const allowed = event.role === "OWNER" || event.role === "ADMIN" || (race.courseSetting !== undefined && race.courseSetting !== "MAP");
      if (allowed) rows.push({ raceId: race.raceId, eventName: event.eventName, raceName: race.raceName, raceDate: race.raceDate });
    }
  }
  return rows.slice(0, limit);
}

/** Knappens namn i "Skapa träning eller tävling" följer vald typ ("Skapa träning" för Träning). */
export function createSubmitLabel(type: RaceType, labels: Readonly<Record<Exclude<RaceType, "FORKED">, string>>): string {
  return labels[type === "FORKED" ? "STANDARD" : type];
}

/** "Min klubb": en klubbyta öppnas direkt, annars remsans Mina klubbar (flera att välja bland, eller gå med eller starta en). */
export function myClubHref(clubs: readonly { clubId: string }[] | undefined): string {
  return clubs?.length === 1 ? `/organizer/clubs/${encodeURIComponent(clubs[0]!.clubId)}` : "#mina-klubbar";
}

const CLUB_STEP_SEEN = "otid.hub.clubStepSeen";
const START_HIDDEN = "otid.hub.startHidden";

function read(key: string): boolean {
  try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
}
function write(key: string): void {
  try { window.localStorage.setItem(key, "1"); } catch { /* utan lagring visas det som för en ny besökare */ }
}

/** Klubbfrågan har visats som block en gång i den här webbläsaren; därefter står den på en rad. */
export const clubStepSeen = (): boolean => read(CLUB_STEP_SEEN);
export const markClubStepSeen = (): void => write(CLUB_STEP_SEEN);
/** "Dölj" på Kom igång i navet. */
export const hubStartHidden = (): boolean => read(START_HIDDEN);
export const hideHubStart = (): void => write(START_HIDDEN);
