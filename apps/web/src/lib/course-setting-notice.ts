/** Beskedet som banläggningens editor visar när den öppnas efter ett sidbyte (Använd igen, Banor → Banfil). */
const noticeKey = (raceId: string) => `otid:course-setting-notice:${raceId}`;

/** Beskedet som editorn visar när den öppnas efter Använd igen (sidbytet tappar annars det). Per flik. */
export function rememberCourseSettingNotice(raceId: string, notice: string): void {
  try { window.sessionStorage.setItem(noticeKey(raceId), notice); } catch { /* utan lagring visas inget besked; banorna finns ändå */ }
}

export function takeCourseSettingNotice(raceId: string): string | undefined {
  try {
    const value = window.sessionStorage.getItem(noticeKey(raceId));
    if (value !== null) window.sessionStorage.removeItem(noticeKey(raceId));
    return value ?? undefined;
  } catch { return undefined; }
}
