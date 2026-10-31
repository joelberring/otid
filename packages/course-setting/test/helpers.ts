/** Hjälp för testerna: Purple Pens testfiler och normaliserad XML. */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { attr, childElements, parseXml, textOf, type XmlElement } from "../src/xml";

/** Purple Pens testfiler (BSD, finns inte i repot); sökvägen sätts med `OTID_PURPLE_PEN_TESTFILES`. */
export const testFilesDir = process.env.OTID_PURPLE_PEN_TESTFILES
  ?? "/tmp/claude-0/-home-claude/002e7d1a-c2f2-5e79-9caf-4b3181a5b50f/scratchpad/purplepen/src/TestFiles";

export function ppenFiles(): string[] {
  if (!existsSync(testFilesDir)) return [];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".ppen")) files.push(path);
    }
  };
  walk(testFilesDir);
  return files;
}

export const readText = (path: string) => readFileSync(path, "utf8");

const NUMBER = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

function value(text: string): string {
  const trimmed = text.trim();
  if (NUMBER.test(trimmed)) return `#${Math.fround(Number(trimmed))}`;
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase();
  return text;
}

const idOf = (element: XmlElement) => element.attrs.find(([k]) => k === "id")?.[1];

/**
 * Normaliserad form för jämförelse: attribut i bokstavsordning, tal som 32-bitarstal (Purple Pen lagrar float), barnen
 * grupperade per namn. Ordningen inom ett namn behålls, utom för objekt med id och för relay-branch som sorteras.
 */
export function normalize(element: XmlElement): unknown {
  const attrs = [...element.attrs].map(([k, v]) => [k, value(v)]).sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
  const text = element.children.filter((c): c is string => typeof c === "string").join("");
  const kids = element.children.filter((c): c is XmlElement => typeof c !== "string");
  const groups: [string, unknown[]][] = [];
  for (const name of [...new Set(kids.map(k => k.name))].sort()) {
    let members = kids.filter(k => k.name === name);
    if (members.every(m => idOf(m) !== undefined)) members = [...members].sort((a, b) => Number(idOf(a)) - Number(idOf(b)));
    let normalized: unknown[] = members.map(normalize);
    if (name === "relay-branch") normalized = normalized.map(n => JSON.stringify(n)).sort();
    groups.push([name, normalized]);
  }
  return { name: element.name, attrs, text: kids.length === 0 ? value(text) : "", children: groups };
}

export const normalizedXml = (xml: string) => normalize(parseXml(xml).root);

const child = (element: XmlElement, name: string) => childElements(element).find(c => c.name === name);

export interface IofCourse { readonly name: string; readonly family: string; readonly length: number; readonly codes: readonly string[] }

/** Banorna i en IOF CourseData 3.0 (Purple Pens export): namn, familj, längd och kodsiffrorna i ordning. */
export function iofCourses(xml: string): IofCourse[] {
  const root = parseXml(xml).root;
  const raceCourseData = child(root, "RaceCourseData")!;
  return childElements(raceCourseData).filter(c => c.name === "Course").map(course => ({
    name: textOf(child(course, "Name")!),
    family: textOf(child(course, "CourseFamily") ?? child(course, "Name")!),
    length: Number(textOf(child(course, "Length") ?? { name: "Length", attrs: [], children: ["NaN"] })),
    codes: childElements(course).filter(c => c.name === "CourseControl" && attr(c, "type") === "Control").map(c => textOf(child(c, "Control")!))
  }));
}
