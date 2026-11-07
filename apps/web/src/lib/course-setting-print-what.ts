import type { MapBundleResponse } from "@o-tid/contracts";
import { classLayoutOf, MAIN_LAYOUT, printVariants, type CourseSettingDocument, type SheetItem } from "@o-tid/course-setting";
import { mapReserveCount } from "@o-tid/domain";

/**
 * ADR-0217 beslut 8: vad Utskrift-fliken skriver ut. Alla ark i en layout, klassernas kartor (bana i klassens layout),
 * en karta per löpare (som förut) eller provark (ett av varje ark). Antalet: anmälda + reserver (som Kartor till starten
 * räknar) eller ett eget antal per ark.
 */
export type PrintCount = { readonly kind: "ENTERED" } | { readonly kind: "OWN"; readonly copies: number };
type Bundles = Pick<MapBundleResponse, "classes" | "rows" | "reserve">;

const MAX_COPIES = 500;

/** Kartorna per variant för klasserna (anmälda och lediga plus reserv); nyckel "" = ogafflad. */
function classMaps(bundles: Bundles | undefined, classes: readonly string[], courseName: string): Map<string, number> {
  const names = new Set(classes);
  const byVariant = new Map<string, number>();
  if (!bundles) return byVariant;
  for (const row of bundles.classes) if (names.has(row.name) && row.courseName === courseName) for (const code of row.variantCodes) byVariant.set(code, byVariant.get(code) ?? 0);
  for (const row of bundles.rows) if (names.has(row.className) && row.courseName === courseName) byVariant.set(row.variantCode ?? "", (byVariant.get(row.variantCode ?? "") ?? 0) + 1);
  return new Map([...byVariant].map(([code, count]) => [code, count + mapReserveCount(count, bundles.reserve)]));
}

const repeat = (item: SheetItem, copies: number): SheetItem[] => Array.from({ length: Math.max(0, Math.min(MAX_COPIES, Math.floor(copies))) }, () => item);

/** Klasserna (namn) som har banan i layouten. */
export function classesIn(document: CourseSettingDocument, bundles: Pick<MapBundleResponse, "classes"> | undefined, courseName: string, layout: string): string[] {
  return [...new Set((bundles?.classes ?? []).filter(row => row.courseName === courseName && classLayoutOf(document, row.name) === layout).map(row => row.name))];
}

/**
 * Antalet för en karta: eget antal, eller anmälda + reserver för klasserna i layouten (per variant om kartan har en variant,
 * annars alla varianter tillsammans). Utan klasser blir det ett ark (provtryck).
 */
export function copiesOf(document: CourseSettingDocument, bundles: Bundles | undefined, item: SheetItem, count: PrintCount, classes?: readonly string[]): number {
  if (count.kind === "OWN") return count.copies;
  const courseName = document.courses.find(row => row.id === item.course)?.name;
  if (!courseName) return 1;
  const maps = classMaps(bundles, classes ?? classesIn(document, bundles, courseName, item.layout ?? MAIN_LAYOUT), courseName);
  if (maps.size === 0) return 0;
  return item.variant ? maps.get(item.variant) ?? 0 : [...maps.values()].reduce((sum, value) => sum + value, 0);
}

/** Alla ark i en layout för de valda banorna (huvudlayouten: de valda; en annan layout: de som har ett ark i den). */
export function layoutItems(document: CourseSettingDocument, layout: string, chosen: readonly string[], eachVariant: boolean,
  bundles?: Pick<MapBundleResponse, "classes">  ): SheetItem[] {
  const courses = [...document.courses].sort((a, b) => a.order - b.order);
  const ids = ["ALL_CONTROLS", ...courses.map(course => course.id)].filter(id => chosen.includes(id)).filter(id => layout === MAIN_LAYOUT
    || document.event.layoutSheets?.[layout]?.[id] !== undefined
    || (id !== "ALL_CONTROLS" && classesIn(document, bundles, courses.find(row => row.id === id)!.name, layout).length > 0));
  return ids.flatMap(course => printVariants(document, course, eachVariant).map(variant => ({ course, ...(variant ? { variant } : {}),
    ...(layout !== MAIN_LAYOUT ? { layout } : {}) })));
}

/** Klassernas kartor: klassens bana i klassens layout, per variant när banan är gafflad. */
export function classItems(document: CourseSettingDocument, bundles: Bundles | undefined, classes: readonly string[], count: PrintCount): SheetItem[] {
  const out: SheetItem[] = [];
  for (const name of classes) {
    const layout = classLayoutOf(document, name);
    const done = new Set<string>();
    for (const row of (bundles?.classes ?? []).filter(item => item.name === name)) {
      const course = document.courses.find(item => item.name === row.courseName);
      // Stafett: en rad per sträcka; samma bana skrivs ut en gång för klassen.
      if (!course || done.has(course.id)) continue;
      done.add(course.id);
      const variants = row.variantCodes.length > 0 ? row.variantCodes : [""];
      for (const variant of variants) {
        const item: SheetItem = { course: course.id, ...(variant ? { variant } : {}), ...(layout !== MAIN_LAYOUT ? { layout } : {}) };
        out.push(...repeat(item, copiesOf(document, bundles, item, count, [name])));
      }
    }
  }
  return out;
}

/** Provark: ett av varje ark (banorna i huvudlayouten och arken i de andra layouterna). */
export function proofItems(document: CourseSettingDocument, bundles: Pick<MapBundleResponse, "classes"> | undefined): SheetItem[] {
  const courses = [...document.courses].sort((a, b) => a.order - b.order);
  const out: SheetItem[] = courses.map(course => ({ course: course.id }));
  for (const layout of document.event.layouts ?? []) for (const course of courses) {
    if (document.event.layoutSheets?.[layout.id]?.[course.id] !== undefined || classesIn(document, bundles, course.name, layout.id).length > 0) {
      out.push({ course: course.id, layout: layout.id });
    }
  }
  return out;
}

/** Kartorna med antalet: varje karta så många gånger som antalet säger (i följd). */
export function withCopies(document: CourseSettingDocument, bundles: Bundles | undefined, items: readonly SheetItem[], count: PrintCount): SheetItem[] {
  return items.flatMap(item => repeat(item, copiesOf(document, bundles, item, count)));
}
