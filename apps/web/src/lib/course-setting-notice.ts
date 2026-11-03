/** Beskedet som banläggningens editor visar när den öppnas efter ett sidbyte (Använd igen, Banor → Banfil). */
const noticeKey = (raceId: string) => `otid:course-setting-notice:${raceId}`;

/** Beskedet som editorn visar när den öppnas efter Använd igen (sidbytet tappar annars det). Per flik. */
export function rememberCourseSettingNotice(raceId: string, notice: string): void {
  try { window.sessionStorage.setItem(noticeKey(raceId), notice); } catch { /* utan lagring visas inget besked; banorna finns ändå */ }
}

/** Beskedet som väntar (tas inte bort; `forgetCourseSettingNotice` när editorn visat det). */
export function pendingCourseSettingNotice(raceId: string): string | undefined {
  try { return window.sessionStorage.getItem(noticeKey(raceId)) ?? undefined; } catch { return undefined; }
}

export function forgetCourseSettingNotice(raceId: string): void {
  try { window.sessionStorage.removeItem(noticeKey(raceId)); } catch { /* inget att ta bort */ }
}
