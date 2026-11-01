import type {
  ControlPoint, CourseSettingDocument, DescriptionKind, DescriptionLanguage, DescriptionLayout, DescriptionPrimitive
} from "@o-tid/course-setting";
import { ALL_CONTROLS } from "./course-setting-hit";
import type { Selection } from "./course-setting-editor";

/**
 * Steg 63 (ADR-0180): kontrollbeskrivningen i editorn. Beskrivningens markerbara ytor (`hit`) pekar med `ref` på en rad,
 * som banpåtrycket: banans kontroll-id när en bana visas, kontrollens id i Alla kontroller. Här översätts det till
 * editorns val och tillbaka, och här finns tävlingens inställningar för beskrivningen (språk och visningssätt).
 */
export const DESCRIPTION_LANGUAGES = ["sv", "en"] as const;
export const DESCRIPTION_KINDS: readonly DescriptionKind[] = ["SYMBOLS", "TEXT", "SYMBOLS_AND_TEXT"];

export interface DescriptionSettings {
  readonly language: DescriptionLanguage;
  readonly kind: DescriptionKind;
}

/** Kontrollen (och banans kontroll) som en rad i beskrivningen gäller. */
export function targetOfRef(document: CourseSettingDocument, view: string, ref: string): Selection | undefined {
  if (view !== ALL_CONTROLS) {
    const courseControl = document.courseControls[ref];
    if (courseControl && document.controls[courseControl.control]) return { kind: "control", control: courseControl.control, courseControl: ref };
  }
  return document.controls[ref] ? { kind: "control", control: ref } : undefined;
}

/** Raden i beskrivningen som ska markeras för editorns val (en vald kontroll; inget för en sträcka). */
export function refOfSelection(view: string, selection: Selection | undefined): string | undefined {
  if (selection?.kind !== "control") return undefined;
  return view !== ALL_CONTROLS && selection.courseControl ? selection.courseControl : selection.control;
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
 * Textraden före eller efter kontrollens rad (Purple Pens `<description-text line="before|after">`). Paketet kan ha
 * den i modellen; annars ligger den orörd i kontrollens `raw`.
 */
export function descriptionTextLine(control: ControlPoint | undefined, location: "before" | "after"): string {
  if (!control) return "";
  const field = (control as unknown as { descriptionTextLines?: Partial<Record<"before" | "after", string>> }).descriptionTextLines?.[location];
  if (typeof field === "string") return field;
  for (const raw of control.raw ?? []) {
    const match = new RegExp(`<description-text\\b[^>]*\\bline="${location}"[^>]*>([\\s\\S]*?)</description-text>`).exec(raw.xml);
    if (match) return unescapeXml(match[1]!);
  }
  return "";
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const settingsKey = (raceId: string) => `otid.course-setting.descriptions.${raceId}`;

const isLanguage = (value: unknown): value is DescriptionLanguage => typeof value === "string" && (DESCRIPTION_LANGUAGES as readonly string[]).includes(value);
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
