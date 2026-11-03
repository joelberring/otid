/** Beskedet som banläggningens editor visar när den öppnas efter ett sidbyte (Använd igen, Banor → Banfil). */
const noticeKey = (raceId: string) => `otid:course-setting-notice:${raceId}`;

/** `stays`: beskedet står kvar tills det stängs (ägaren 2026-11-03: varianter som blev egna banor), annars försvinner det. */
export interface CourseSettingNotice { readonly text: string; readonly stays: boolean }

/** Beskedet som editorn visar när den öppnas efter Använd igen (sidbytet tappar annars det). Per flik. */
export function rememberCourseSettingNotice(raceId: string, notice: CourseSettingNotice): void {
  try { window.sessionStorage.setItem(noticeKey(raceId), JSON.stringify(notice)); } catch { /* utan lagring visas inget besked; banorna finns ändå */ }
}

/** Beskedet som väntar (tas inte bort; `forgetCourseSettingNotice` när editorn visat det). */
export function pendingCourseSettingNotice(raceId: string): CourseSettingNotice | undefined {
  try {
    const value = window.sessionStorage.getItem(noticeKey(raceId));
    if (value === null) return undefined;
    try {
      const parsed = JSON.parse(value) as Partial<CourseSettingNotice>;
      if (typeof parsed.text === "string") return { text: parsed.text, stays: parsed.stays === true };
    } catch { /* en äldre flik sparade bara texten */ }
    return { text: value, stays: false };
  } catch { return undefined; }
}

export function forgetCourseSettingNotice(raceId: string): void {
  try { window.sessionStorage.removeItem(noticeKey(raceId)); } catch { /* inget att ta bort */ }
}
