import type { Language } from "./language";

/**
 * Engelska namn på det som O-Tid själv skapar med svenska namn och som sparas i dokumenten (färdiga arkmallar och läget
 * «Från Purple Pen»). Det sparade namnet ändras aldrig: koden känner igen mallarna på id och läget på källan, och namnet
 * byts bara i visningen, och bara när det fortfarande är O-Tids eget svenska namn (ett namn som användaren har ändrat visas
 * som det är).
 */
const SHEET_LAYOUT_EN: Readonly<Record<string, readonly [sv: string, en: string]>> = {
  "a4-one": ["A4, en karta", "A4, one map"],
  "a4-two": ["A4 liggande, två kartor", "A4 landscape, two maps"],
  "a4-four": ["A4, fyra kartor", "A4, four maps"],
  "a3-two": ["A3 liggande, två kartor", "A3 landscape, two maps"],
  "a4-strip": ["A4, en karta med remsa (rullad karta)", "A4, one map with a strip (rolled map)"]
};

export function sheetLayoutName(layout: { readonly id: string; readonly name: string }, language: Language): string {
  const known = SHEET_LAYOUT_EN[layout.id];
  return language === "en" && known && known[0] === layout.name ? known[1] : layout.name;
}

const PPEN_STATE_SV = "Från Purple Pen", PPEN_STATE_EN = "From Purple Pen";

/** Läget som sparas när en .ppen läses in heter på det språk som den som läste in filen hade. */
export function layoutStateName(state: { readonly name: string; readonly source?: string | undefined }, language: Language): string {
  if (state.source !== "PPEN") return state.name;
  if (language === "en" && state.name === PPEN_STATE_SV) return PPEN_STATE_EN;
  if (language === "sv" && state.name === PPEN_STATE_EN) return PPEN_STATE_SV;
  return state.name;
}

/** Pappret som `paperText` skriver det ("A4 liggande", "A3 stående" eller måtten), på sidans språk. */
export function paperName(paper: string, language: Language): string {
  return language === "en" ? paper.replace(/ liggande$/, " landscape").replace(/ stående$/, " portrait") : paper;
}
