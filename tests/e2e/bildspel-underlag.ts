import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { readMapFile, type MapGeoreference } from "../../packages/map-file/src/index";
import { demoMapFile } from "./bildspel-karta";

/**
 * Kartan och banläggningen i bildspelet (`bildspel.spec.ts`): Tallbacken och banan Lång som förval, eller ägarens egna filer
 * utanför repot (ägaren 2026-11-24; kartor har upphovsrätt, så filerna checkas aldrig in, bara skärmbilderna):
 *   BILDSPEL_KARTA   kartfilen (.omap, .xmap eller .ocd)
 *   BILDSPEL_BANOR   banläggningen (.ppen från Purple Pen eller O-Tid); utan den läggs banan Lång för hand på kartan
 *   BILDSPEL_BANA    banan som visas (förval: den första i filen)
 *   BILDSPEL_STRACKA sträckan som zoomas in i vägvalsbilden, kontrollernas nummer i banan (förval 2-3)
 * Övrig tävlingsdata (löpare, klasser, klubbarkivets namn) är påhittad i båda fallen.
 */
export type XY = readonly [number, number];
export type SlideCourse = { name: string; start: XY; controls: readonly XY[]; codes: readonly string[]; finish: XY };

/** Tallbackens bana Lång: start, åtta kontroller och mål (kartans mm); sträckan 2–3 går runt sjön, norr eller söder om. */
const DEMO_COURSE: SlideCourse = { name: "Lång", start: [-74, 22], controls: [[-52, 46], [-30, 12], [34, 12], [62, 44], [90, -20], [42, -50], [-8, -42],
  [-44, -26]], codes: ["31", "32", "33", "34", "35", "36", "37", "38"], finish: [-70, 10] };

const env = process.env;
export const ownMap = Boolean(env.BILDSPEL_KARTA);
if (env.BILDSPEL_BANOR && !ownMap) throw new Error("BILDSPEL_BANOR kräver BILDSPEL_KARTA (banorna hör till en karta)");

export type SlideMap = { bytes: Uint8Array; fileName: string; name: string; georeference: MapGeoreference | null };
export function slideMap(): SlideMap {
  if (!env.BILDSPEL_KARTA) {
    const bytes = demoMapFile();
    return { bytes, fileName: "Tallbacken.omap", name: "Tallbacken", georeference: readMapFile(bytes, "Tallbacken.omap").georeference ?? null };
  }
  const bytes = new Uint8Array(readFileSync(env.BILDSPEL_KARTA));
  const fileName = basename(env.BILDSPEL_KARTA);
  return { bytes, fileName, name: basename(fileName, extname(fileName)), georeference: readMapFile(bytes, fileName).georeference ?? null };
}

const attribute = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** Banan ur en .ppen: kontrollerna i ordning (första grenen vid gafflingar), i kartans mm. */
export function ppenCourse(text: string, wanted?: string): SlideCourse {
  const controls = new Map<string, { kind: string; at: XY; code: string }>();
  for (const match of text.matchAll(/<control\b([^>]*)>([\s\S]*?)<\/control>/g)) {
    const location = /<location\b[^>]*>/.exec(match[2]!)?.[0] ?? "";
    controls.set(attribute(match[1]!, "id")!, { kind: attribute(match[1]!, "kind") ?? "normal",
      at: [Number(attribute(location, "x")), Number(attribute(location, "y"))], code: /<code>([^<]*)<\/code>/.exec(match[2]!)?.[1] ?? "" });
  }
  const links = new Map<string, { control: string; next?: string }>();
  for (const match of text.matchAll(/<course-control\b([^>]*)>([\s\S]*?)<\/course-control>|<course-control\b([^>]*)\/>/g)) {
    const head = match[1] ?? match[3]!;
    const next = /<next\b[^>]*>/.exec(match[2] ?? "")?.[0];
    links.set(attribute(head, "id")!, { control: attribute(head, "control")!, ...(next ? { next: attribute(next, "course-control")! } : {}) });
  }
  const courses = [...text.matchAll(/<course(\s[^>]*)>([\s\S]*?)<\/course>/g)].map(match => ({
    order: Number(attribute(match[1]!, "order") ?? 0), name: /<name>([^<]*)<\/name>/.exec(match[2]!)?.[1] ?? "",
    first: attribute(/<first\b[^>]*>/.exec(match[2]!)?.[0] ?? "", "course-control") })).sort((a, b) => a.order - b.order);
  const course = wanted ? courses.find(entry => entry.name === wanted) : courses[0];
  if (!course?.first) throw new Error(wanted ? `Banan «${wanted}» finns inte i banfilen` : "Banfilen har ingen bana");
  const points: { kind: string; at: XY; code: string }[] = [];
  for (let id: string | undefined = course.first, guard = 0; id && guard < 500; guard += 1) {
    const link = links.get(id);
    if (!link) break;
    const control = controls.get(link.control);
    if (control) points.push(control);
    id = link.next;
  }
  const start = points.find(point => point.kind === "start")?.at, finish = [...points].reverse().find(point => point.kind === "finish")?.at;
  const normal = points.filter(point => point.kind === "normal");
  if (!start || !finish || normal.length < 2) throw new Error(`Banan «${course.name}» behöver start, mål och minst två kontroller`);
  return { name: course.name, start, controls: normal.map(point => point.at), codes: normal.map(point => point.code), finish };
}

/** Banfilen (eller null för Tallbacken, där banan läggs för hand) och banan som visas. */
export function slideCourses(): { ppen: Buffer | null; course: SlideCourse } {
  if (!env.BILDSPEL_BANOR) return { ppen: null, course: DEMO_COURSE };
  const ppen = readFileSync(env.BILDSPEL_BANOR);
  return { ppen, course: ppenCourse(ppen.toString("utf8"), env.BILDSPEL_BANA) };
}

/** Sträckan som zoomas in: index i `controls` för från- och tillkontrollen (BILDSPEL_STRACKA "2-3" ger 1 och 2). */
export function slideLeg(course: SlideCourse): readonly [number, number] {
  const [from, to] = (env.BILDSPEL_STRACKA ?? "2-3").split("-").map(Number) as [number, number];
  if (!(from >= 1 && to === from + 1 && to <= course.controls.length)) {
    throw new Error(`BILDSPEL_STRACKA ska vara två följande kontroller i banan, t.ex. 2-3 (banan har ${course.controls.length})`);
  }
  return [from - 1, to - 1];
}

/**
 * Klubbarkivets banfiler: kopian av en .ppen med en annan kartsökväg och titel och med banorna flyttade `shift` mm (så att
 * Tallbackens träningar får olika små bilder; för egna filer flyttas inget).
 */
export function archivePpen(source: Buffer, mapPath: string, title: string, shift: XY = [0, 0]): Buffer {
  const escaped = mapPath.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const move = (value: string, by: number) => String(Number(value) + by);
  // Kartans sökväg i <map> (Purple Pen skriver <map kind="none" … /> när ingen karta är vald).
  const text = source.toString("utf8").replace(/(<map\b[^>]*>)[^<]*(<\/map>)/, `$1${escaped}$2`)
    .replace(/<map\b([^>]*?)\s*\/>/, (_, rest: string) => `<map${rest.replace(/\bkind="none"/, 'kind="OCAD"')}>${escaped}</map>`)
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/<location\b[^>]*>/g, tag => tag.replace(/\bx="([^"]*)"/, (_, x: string) => `x="${move(x, shift[0])}"`)
      .replace(/\by="([^"]*)"/, (_, y: string) => `y="${move(y, shift[1])}"`))
    .replace(/<print-area\b[^>]*>/g, tag => tag.replace(/\b(left|right)="([^"]*)"/g, (_, key: string, value: string) => `${key}="${move(value, shift[0])}"`)
      .replace(/\b(top|bottom)="([^"]*)"/g, (_, key: string, value: string) => `${key}="${move(value, shift[1])}"`));
  return Buffer.from(text, "utf8");
}
