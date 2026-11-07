import type { ClubView } from "@o-tid/contracts";

/**
 * ADR-0209 (ändrat 2026-11-07): "Kom igång" överst i klubbytan för ägare och administratörer. Stegen läses ur `ClubView`
 * (ingen egen fråga till servern): kopplingen till Eventor, fler ledare eller administratörer (medlemmar eller inbjudningar),
 * kartor (en karta räcker) och Vem ser vad (förvalet gäller alltid, så det steget är klart från början).
 */
export type ClubStartStep = "eventor" | "people" | "maps" | "access";
export const CLUB_START_STEPS: readonly ClubStartStep[] = ["eventor", "people", "maps", "access"];

export interface ClubStartStatus {
  done: Record<ClubStartStep, boolean>;
  /** Kopplad till Eventor och minst en karta: kortet behövs inte längre. */
  ready: boolean;
  /** Ingenting gjort än (en ny klubbyta): kortet säger att nästa steg är kopplingen. */
  fresh: boolean;
  /** Första steget som inte är klart. */
  next: ClubStartStep | null;
}

const isAdmin = (role: ClubView["viewer"]["role"]) => role === "OWNER" || role === "ADMIN";

export function clubStartStatus(club: ClubView): ClubStartStatus {
  const eventor = club.eventorClub !== null;
  // Fler som kan leda klubbytan: någon annan än den inloggade som ledare, administratör eller ägare (med eller inbjuden).
  const people = club.members.some(member => member.accountId !== club.viewer.accountId && member.role !== "READER")
    || club.invitations.some(invitation => invitation.role !== "READER");
  const maps = club.usage.maps > 0;
  const done: Record<ClubStartStep, boolean> = { eventor, people, maps, access: true };
  return {
    done,
    ready: eventor && maps,
    fresh: !eventor && !people && !maps && club.usage.entries === 0,
    next: CLUB_START_STEPS.find(step => !done[step]) ?? null
  };
}

/** Kortet visas bara för ägare och administratörer, tills klubbytan är klar eller kortet är dolt. */
export function showClubStart(club: ClubView, dismissed: boolean): boolean {
  return isAdmin(club.viewer.role) && !dismissed && !clubStartStatus(club).ready;
}

/** "Dölj" sparas i webbläsaren per klubbyta (ingen kolumn för det i `club_setting`); utan lagring visas kortet igen. */
const storageKey = (clubId: string) => `otid.clubStart.hidden.${clubId}`;
export function clubStartHidden(clubId: string): boolean {
  try { return window.localStorage.getItem(storageKey(clubId)) === "1"; } catch { return false; }
}
export function hideClubStart(clubId: string): void {
  try { window.localStorage.setItem(storageKey(clubId), "1"); } catch { /* utan lagring döljs kortet bara tills sidan laddas om */ }
}

/** En mailto-länk utan mottagare: den som skickar väljer själv vem. */
export function mailtoHref(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
