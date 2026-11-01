import {
  courseControlOrder, DESCRIPTION_LANGUAGES as SYMBOL_LANGUAGES, type ControlPoint, type CourseSettingDocument, type DescriptionKind, type DescriptionLanguage, type DescriptionLayout,
  type DescriptionPrimitive
} from "@o-tid/course-setting";
import { ALL_CONTROLS } from "./course-setting-hit";
import type { Selection } from "./course-setting-editor";

/**
 * Steg 63 (ADR-0180): kontrollbeskrivningen i editorn. Beskrivningens markerbara ytor (`hit`) pekar med `ref` på
 * kontrollen (kontrollens id, inte banans kontroll). Här översätts det till editorns val och tillbaka, och här finns
 * tävlingens inställningar för beskrivningen (språk och visningssätt).
 */
/** Språken som symbolerna har texter på (paketet), svenska och engelska först. */
export const DESCRIPTION_LANGUAGES: readonly { readonly id: string; readonly name: string }[] = [...SYMBOL_LANGUAGES]
  .sort((left, right) => rank(left.id) - rank(right.id) || left.name.localeCompare(right.name, "sv"));
function rank(id: string) { return id === "sv" ? 0 : id === "en" ? 1 : 2; }
export const DESCRIPTION_KINDS: readonly DescriptionKind[] = ["SYMBOLS", "TEXT", "SYMBOLS_AND_TEXT"];

export interface DescriptionSettings {
  readonly language: DescriptionLanguage;
  readonly kind: DescriptionKind;
}

/**
 * Kontrollen som en rad i beskrivningen gäller, med banans kontroll när en bana visas (den valda om kontrollen redan är
 * vald, annars första gången kontrollen finns på banan eller varianten), så att kartan väljer samma som ett klick där.
 */
export function targetOfRef(document: CourseSettingDocument, view: string, ref: string, variant?: string,
  current?: Selection): Selection | undefined {
  if (!document.controls[ref]) return undefined;
  if (view === ALL_CONTROLS) return { kind: "control", control: ref };
  if (current?.kind === "control" && current.control === ref && current.courseControl) return current;
  let order: readonly string[] = [];
  try { order = courseControlOrder(document, view, variant); } catch { order = []; }
  const courseControl = order.find(id => document.courseControls[id]?.control === ref);
  return { kind: "control", control: ref, ...(courseControl ? { courseControl } : {}) };
}

/** Raden i beskrivningen som ska markeras för editorns val (en vald kontroll; inget för en sträcka). */
export function refOfSelection(selection: Selection | undefined): string | undefined {
  return selection?.kind === "control" ? selection.control : undefined;
}

export type HitPrimitive = Extract<DescriptionPrimitive, { kind: "hit" }>;

/** Beskrivningens markerbara ytor: hela rader (utan `box`) och rutor. */
export function hitAreas(layout: DescriptionLayout): HitPrimitive[] {
  return layout.primitives.filter((primitive): primitive is HitPrimitive => primitive.kind === "hit");
}

/** Raden att markera för ett val: radens yta, annars rutornas sammanlagda yta. */
export function rowArea(layout: DescriptionLayout, ref: string | undefined): { x: number; y: number; width: number; height: number } | undefined {
  if (!ref) return undefined;
  const hits = hitAreas(layout).filter(hit => hit.ref === ref);
  const row = hits.find(hit => !hit.box) ?? hits[0];
  if (!row || hits.length === 0) return undefined;
  if (!row.box) return row;
  const minX = Math.min(...hits.map(hit => hit.x)), minY = Math.min(...hits.map(hit => hit.y));
  return { x: minX, y: minY, width: Math.max(...hits.map(hit => hit.x + hit.width)) - minX, height: Math.max(...hits.map(hit => hit.y + hit.height)) - minY };
}

const unescapeXml = (value: string) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Språket som .ppen-filen har för beskrivningarna (`<descriptions lang="sv">` i `<event>`), om det finns. */
export function ppenDescriptionLanguage(document: CourseSettingDocument): DescriptionLanguage | undefined {
  for (const raw of document.event.raw ?? []) {
    const lang = /<descriptions\b[^>]*\blang="([^"]+)"/.exec(raw.xml)?.[1];
    if (lang) return unescapeXml(lang);
  }
  return undefined;
}

/**
 * Kontrollens textrad före eller efter raden (Purple Pens description-text-line, på alla banor; "|" = ny rad).
 * Samma fält finns på banans kontroll för en textrad som bara gäller den banan; den visas men ändras inte här.
 */
export function descriptionTextLine(control: Pick<ControlPoint, "descriptionTextBefore" | "descriptionTextAfter"> | undefined,
  location: "before" | "after"): string {
  return (location === "before" ? control?.descriptionTextBefore : control?.descriptionTextAfter) ?? "";
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const settingsKey = (raceId: string) => `otid.course-setting.descriptions.${raceId}`;

const isLanguage = (value: unknown): value is DescriptionLanguage => typeof value === "string" && DESCRIPTION_LANGUAGES.some(language => language.id === value);
const isKind = (value: unknown): value is DescriptionKind => typeof value === "string" && (DESCRIPTION_KINDS as readonly string[]).includes(value);

/**
 * Tävlingens språk och visningssätt. Språket utgår från .ppen-filen (svenska om den inte säger något); det banläggaren
 * väljer sparas i webbläsaren per tävling, så att editorn och utskriftssidan visar samma sak.
 */
export function readDescriptionSettings(storage: Storage | undefined, raceId: string, document: CourseSettingDocument): DescriptionSettings {
  const fromFile = ppenDescriptionLanguage(document);
  const fallback: DescriptionSettings = { language: isLanguage(fromFile) ? fromFile : "sv", kind: "SYMBOLS" };
  try {
    const value = JSON.parse(storage?.getItem(settingsKey(raceId)) ?? "null") as Partial<Record<keyof DescriptionSettings, unknown>> | null;
    if (!value || typeof value !== "object") return fallback;
    return { language: isLanguage(value.language) ? value.language : fallback.language, kind: isKind(value.kind) ? value.kind : fallback.kind };
  } catch { return fallback; }
}

export function writeDescriptionSettings(storage: Storage | undefined, raceId: string, settings: DescriptionSettings): void {
  try { storage?.setItem(settingsKey(raceId), JSON.stringify(settings)); } catch { /* Avstängd lagring: valet gäller tills sidan laddas om. */ }
}

/** Webbläsarens lagring, eller inget (privat fönster, avstängd lagring, servern). */
export function browserStorage(): Storage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}
