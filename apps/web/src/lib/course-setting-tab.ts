/**
 * Översynen 2026-11-17: banläggningen kan öppnas direkt på en flik med `?flik=…` (t.ex. från bingo-ledarens sida och
 * arbetsytans "Övning i mobilen"). Bara fliken Träning har ett värde än; okända värden ger banläggningens vanliga flik.
 */
const TABS = { traning: "training" } as const;
type LinkedTab = (typeof TABS)[keyof typeof TABS];

/** Fliken i `?flik=…` (också med å, ä, ö och versaler), eller undefined. */
export function linkedCourseSettingTab(search: string): LinkedTab | undefined {
  const value = new URLSearchParams(search).get("flik");
  const slug = (value ?? "").trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return Object.hasOwn(TABS, slug) ? TABS[slug as keyof typeof TABS] : undefined;
}

/** Banläggningen med fliken Träning öppen (där Bingo, Sänka skepp och virtuella kontroller slås på). */
export function courseSettingTrainingPath(raceId: string): string {
  return `/admin/${raceId}/course-setting?flik=traning`;
}
