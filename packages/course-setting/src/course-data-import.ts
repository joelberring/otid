/**
 * En banfil (IOF XML CourseData, 3.0 eller 2.0.3) som banläggningsdokument, när det inte finns någon .ppen: kontrollerna
 * med koder och lägen, start, mål och passager, banorna i filens ordning med längd, stigning och klasser, poängbanor, och
 * gafflingar när de går att återskapa exakt. Ren funktion; filen tolkas av `@o-tid/iof-xml` (`readCourseLayout`) och
 * lämnas hit som `CourseDataLayout` (samma form).
 *
 * - Lägena: filens `MapPosition` är kartfilens mm med y uppåt, samma som dokumentet och Purple Pens `location` (Purple Pen
 *   skriver `location` rakt av som `MapPosition`, OCAD sina papperskoordinater). Ingen omräkning. Saknas `MapPosition` men
 *   finns `Position` (WGS 84) räknas läget om med kartfilens georeferens (`fromWgs84`).
 * - Varianterna i en familj (`CourseFamily`, eller 2.0.3:s `CourseVariation`) blir en gafflad bana när gafflingarna ger
 *   exakt samma varianter (kontrollerna i samma ordning). Ger gafflingarna fler varianter än filen väljs de som saknas bort
 *   (ADR-0198, så blir en banfil med färre varianter, t.ex. ur O-Tid, samma gafflade bana). Går det inte blir varje variant
 *   en egen bana och det sägs i ett besked.
 * - Klasserna blir banans undertitel ("H21, D21"), som Purple Pen och överföringen till tävlingen läser dem.
 * - Kontrollbeskrivningar finns inte i CourseData: vanliga kontroller och start får inga, mål och passager samma
 *   riktningsrad som en ny kontroll i editorn (snitslat mål och passage genom förbjudet område ur `specialInstruction`).
 *   Beskrivningsförslaget (ADR-0180 beslut 13) körs inte.
 * - Längden räknas alltid ur lägena (ingen fast längd); skiljer filens längd mer än 50 m (Purple Pen avrundar till 100 m)
 *   sägs det i ett besked.
 */
import type { Point } from "@o-tid/map-file";
import { createEmptyDocument } from "./empty";
import { summaries, courseVariantList } from "./summary";
import type { ControlKind, ControlPoint, Course, CourseControl, CourseSettingDocument, DescriptionBox } from "./types";
import { CourseSettingEditError } from "./types";

export type CourseDataLayoutKind = "START" | "CONTROL" | "FINISH" | "CROSSING_POINT";

/** Samma form som `CourseLayoutImport` i `@o-tid/iof-xml`. */
export interface CourseDataLayout {
  readonly eventName?: string | undefined;
  readonly mapScale?: number | undefined;
  readonly controls: readonly {
    readonly id: string; readonly kind: CourseDataLayoutKind; readonly code?: string | undefined;
    readonly mapPosition?: Point | undefined; readonly position?: { readonly latitude: number; readonly longitude: number } | undefined;
  }[];
  readonly courses: readonly {
    readonly name: string; readonly family?: string | undefined; readonly variantCode?: string | undefined;
    readonly lengthMeters?: number | undefined; readonly climbMeters?: number | undefined; readonly score: boolean;
    readonly controls: readonly {
      readonly control: string; readonly kind: CourseDataLayoutKind | "MAP_EXCHANGE"; readonly score?: number | undefined;
      readonly specialInstruction?: string | undefined;
    }[];
  }[];
  readonly classes: readonly { readonly className: string; readonly courseName: string }[];
}

export interface CourseDataDocumentOptions {
  /** Dokumentets titel; saknas = filens tävlingsnamn. */
  readonly title?: string | undefined;
  /** Kartfilens skala (går före filens `Map/Scale`). */
  readonly mapScale?: number | undefined;
  /** WGS 84 → kartans mm, när kartfilen är georefererad (för kontroller utan `MapPosition`). */
  readonly fromWgs84?: ((position: { readonly latitude: number; readonly longitude: number }) => Point | undefined) | undefined;
}

export interface CourseDataNotice {
  readonly code: "FORKS_AS_COURSES" | "SCALE_DIFFERS" | "LENGTH_DIFFERS";
  /** En rad på svenska. */
  readonly text: string;
}

/** Hur långt filens längd får skilja från den uppmätta innan det sägs (Purple Pen avrundar till 100 m). */
export const COURSE_DATA_LENGTH_TOLERANCE_METERS = 50;

const KIND_OF: Readonly<Record<CourseDataLayoutKind | "MAP_EXCHANGE", ControlKind>> = {
  START: "START", CONTROL: "NORMAL", FINISH: "FINISH", CROSSING_POINT: "CROSSING_POINT", MAP_EXCHANGE: "MAP_EXCHANGE"
};

/** Riktningsraden: samma förval som en ny kontroll i editorn, eller filens `specialInstruction`. */
function directive(kind: ControlKind, instruction: string | undefined): DescriptionBox[] {
  if (kind === "FINISH") return [{ box: "all", ref: instruction === "TapedRoute" ? "14.1" : instruction === "FunnelTapedRoute" ? "14.2" : "14.3" }];
  if (kind === "CROSSING_POINT") return [{ box: "all", ref: instruction === "MandatoryOutOfBoundsAreaPassage" ? "13.4" : "13.3" }];
  return [];
}

class Fail extends Error {}

/** "850 m", "4,2 km" (en decimal, svensk decimal). */
function distance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(Math.round(meters / 100) / 10).toFixed(1).replace(".", ",")} km`;
}

/** Banans kontroller (banans kontroll-id) som skapas medan gafflingarna byggs. */
class Builder {
  readonly courseControls: Record<string, CourseControl> = {};
  private next = 1;
  /**
   * `relaxed`: grenarna behöver inte kombineras på alla sätt; gafflingarna ger då fler varianter än filen och de som
   * saknas väljs bort (ADR-0198, t.ex. en banfil som O-Tid skrivit med bortvalda varianter).
   */
  constructor(private readonly points: (control: string, index: number) => number | undefined, private readonly relaxed = false) {}
  create(control: string, next: string | undefined, index = -1): string {
    const id = String(this.next++);
    const points = this.points(control, index);
    this.courseControls[id] = { id, control, ...(next !== undefined ? { next } : {}), ...(points !== undefined ? { points } : {}) };
    return id;
  }
  /** En rak bana (som slutar i `after`). */
  chain(controls: readonly string[], after?: string): string | undefined {
    let head = after;
    for (let index = controls.length - 1; index >= 0; index--) head = this.create(controls[index]!, head, index);
    return head;
  }
  /**
   * Banans kontroller för alla sekvenserna (varianterna) som en kedja med gafflingar, som slutar i `after`. Kastar `Fail`
   * när varianterna inte är alla kombinationer av grenarna (då går de inte att skriva som gafflingar).
   */
  forks(sequences: readonly (readonly string[])[], after: string | undefined): string | undefined {
    const unique = uniqueSequences(sequences);
    if (unique.every(sequence => sequence.length === 0)) return after;
    if (unique.some(sequence => sequence.length === 0)) throw new Fail();
    const first = unique[0]![0]!;
    if (unique.some(sequence => sequence[0] !== first)) throw new Fail();
    const tails = uniqueSequences(unique.map(sequence => sequence.slice(1)));
    const heads = new Set(tails.map(tail => tail[0] ?? ""));
    if (heads.size <= 1) return this.create(first, this.forks(tails, after));
    const loops = loopsAt(first, tails);
    if (loops) {
      // Slingor (Purple Pens LOOP): gaffelkontrollen är utgången, varje slinga börjar med en kopia av den och går tillbaka dit.
      const exit = this.create(first, this.forks(loops.rests, after));
      const branches = [exit, ...loops.loops.map(loop => this.create(first, this.chain(loop, exit)))];
      for (const id of branches) this.courseControls[id] = { ...this.courseControls[id]!, split: { kind: "LOOP", branches, end: exit } };
      return exit;
    }
    const split = splitAtMerge(tails, this.relaxed);
    const end = this.forks(split.rests, after);
    if (end === undefined) throw new Fail();
    const branches = split.groups.map(group => this.create(first, this.forks(group, end)));
    for (const id of branches) this.courseControls[id] = { ...this.courseControls[id]!, split: { kind: "FORK", branches, end } };
    return branches[0];
  }
}

const key = (sequence: readonly string[]) => sequence.join("\u0000");

function uniqueSequences(sequences: readonly (readonly string[])[]): (readonly string[])[] {
  const seen = new Set<string>();
  return sequences.filter(sequence => { const k = key(sequence); if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Var grenarna möts: den första kontrollen (i den första variantens ordning) som alla varianter passerar, där varje gren
 * kombineras med samma fortsättningar. Grenarna i den ordning de först förekommer (Purple Pen skriver AC, AD, BC, BD).
 */
function splitAtMerge(tails: readonly (readonly string[])[], relaxed: boolean): { groups: (readonly string[])[][]; rests: (readonly string[])[] } {
  // Utan krav på alla kombinationer: där grenarna först möts (som banläggaren gafflat), annars där alla kombineras.
  return (relaxed ? mergeAt(tails, false) : mergeAt(tails, true)) ?? (() => { throw new Fail(); })();
}

function mergeAt(tails: readonly (readonly string[])[], product: boolean): { groups: (readonly string[])[][]; rests: (readonly string[])[] } | undefined {
  for (const merge of new Set(tails[0])) {
    if (!tails.every(tail => tail.includes(merge))) continue;
    const parts = tails.map(tail => ({ part: tail.slice(0, tail.indexOf(merge)), rest: tail.slice(tail.indexOf(merge)) }));
    const rests = uniqueSequences(parts.map(row => row.rest));
    const partKeys = [...new Set(parts.map(row => key(row.part)))];
    if (product) {
      if (parts.length !== partKeys.length * rests.length) continue;
      const restKeys = new Set(rests.map(key));
      const combined = partKeys.every(partKey => {
        const with_ = new Set(parts.filter(row => key(row.part) === partKey).map(row => key(row.rest)));
        return with_.size === restKeys.size && [...with_].every(restKey => restKeys.has(restKey));
      });
      if (!combined) continue;
    }
    const groups = new Map<string, (readonly string[])[]>();
    for (const row of parts) {
      const head = row.part[0] ?? "";
      const group = groups.get(head) ?? [];
      if (!group.some(part => key(part) === key(row.part))) group.push(row.part);
      groups.set(head, group);
    }
    if (groups.size < 2) continue;
    return { groups: [...groups.values()], rests };
  }
  return undefined;
}

/**
 * Slingor vid `fork`: varje variant går slingorna i någon ordning (varje slinga en gång, tillbaka till gaffelkontrollen
 * efter var och en) och sedan vidare. Slingorna i den första variantens ordning (Purple Pens A, B, C …). Undefined när
 * varianterna inte är alla ordningar av samma slingor med samma fortsättningar.
 */
function loopsAt(fork: string, tails: readonly (readonly string[])[]): { loops: (readonly string[])[]; rests: (readonly string[])[] } | undefined {
  const rows = tails.map(tail => {
    const loops: string[][] = [];
    let current: string[] = [];
    let last = -1;
    tail.forEach((control, index) => {
      if (control === fork) { loops.push(current); current = []; last = index; } else current.push(control);
    });
    return { loops, rest: tail.slice(last + 1) };
  });
  const count = rows[0]!.loops.length;
  if (count < 2 || rows.some(row => row.loops.length !== count || row.loops.some(loop => loop.length === 0))) return undefined;
  const loops = rows[0]!.loops;
  const loopKeys = new Set(loops.map(key));
  if (loopKeys.size !== count || rows.some(row => !sameSet(row.loops.map(key), [...loopKeys]))) return undefined;
  const rests = uniqueSequences(rows.map(row => row.rest));
  let orders = 1;
  for (let n = 2; n <= count; n++) orders *= n;
  return uniqueSequences(tails).length === orders * rests.length ? { loops, rests } : undefined;
}

const sameSet = (left: readonly string[], right: readonly string[]) => {
  const a = [...left].sort(), b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

type LayoutCourse = CourseDataLayout["courses"][number];

/** Banfilen som banläggningsdokument, med besked om det som inte kunde föras över exakt. */
export function courseDataDocument(layout: CourseDataLayout, options: CourseDataDocumentOptions = {})
  : { readonly document: CourseSettingDocument; readonly notices: readonly CourseDataNotice[] } {
  const notices: CourseDataNotice[] = [];
  const mapScale = options.mapScale ?? layout.mapScale;
  if (mapScale === undefined) throw new CourseSettingEditError("INVALID", "Banfilen säger inte kartans skala och ingen kartfil är vald");
  if (options.mapScale !== undefined && layout.mapScale !== undefined && layout.mapScale !== options.mapScale) {
    notices.push({ code: "SCALE_DIFFERS", text: `Banfilen är gjord för 1:${layout.mapScale} och kartfilen är 1:${options.mapScale}; lägena är filens millimeter på kartan.` });
  }
  const base = createEmptyDocument({ title: options.title?.trim() || layout.eventName?.trim() || "Banor", mapScale });

  // Kontrollerna: slaget ur banorna (en start mitt i en bana är ett kartbyte), läget ur filen.
  const used = new Map<string, { kind: ControlKind; instruction?: string | undefined }>();
  for (const course of layout.courses) {
    for (const item of course.controls) {
      if (!used.has(item.control) || item.kind === "MAP_EXCHANGE") used.set(item.control, { kind: KIND_OF[item.kind], instruction: item.specialInstruction });
    }
  }
  const controls: Record<string, ControlPoint> = {};
  const idOf = new Map<string, string>();
  let nextControl = 1;
  for (const source of layout.controls) {
    const at = source.mapPosition ?? (source.position ? options.fromWgs84?.(source.position) : undefined);
    const usage = used.get(source.id);
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) {
      if (!usage) continue;
      throw new CourseSettingEditError("INVALID", `${source.kind === "CONTROL" ? `Kontrollen ${source.code ?? source.id}` : source.kind === "START" ? "Starten"
        : source.kind === "FINISH" ? "Målet" : `Passagen ${source.id}`} saknar läge på kartan i banfilen`);
    }
    const kind = usage?.kind ?? KIND_OF[source.kind];
    const id = String(nextControl++);
    idOf.set(source.id, id);
    controls[id] = { id, kind, ...(kind === "NORMAL" && source.code ? { code: source.code } : {}), at: { x: at.x, y: at.y },
      descriptions: directive(kind, usage?.instruction), ...(kind === "CROSSING_POINT" ? { orientation: 0 } : {}) };
  }
  for (const control of used.keys()) if (!idOf.has(control)) throw new CourseSettingEditError("INVALID", `Kontrollen ${control} finns inte i banfilen`);

  // Banorna i filens ordning; en familj på den första variantens plats.
  const entries: { name: string; members: LayoutCourse[] }[] = [];
  for (const course of layout.courses) {
    const family = course.family;
    const existing = family !== undefined ? entries.find(entry => entry.members[0]?.family === family) : undefined;
    if (existing) existing.members.push(course);
    else entries.push({ name: family ?? course.name, members: [course] });
  }
  const classesOf = (names: readonly string[]) => [...new Set(layout.classes.filter(row => names.includes(row.courseName)).map(row => row.className))];

  const courseControls: Record<string, CourseControl> = {};
  const courses: Course[] = [];
  const asCourses: string[] = [];
  let ccNext = 1;
  const add = (name: string, members: readonly LayoutCourse[], forked: boolean, classNames: readonly string[], relaxed = false) => {
    const score = members.some(member => member.score);
    const pointsOf = (control: string, index: number) => {
      if (!score || index < 0) return undefined;
      const item = members[0]!.controls[index];
      return item && idOf.get(item.control) === control ? item.score : undefined;
    };
    const builder = new Builder(pointsOf, relaxed);
    const sequences = members.map(member => member.controls.map(item => idOf.get(item.control)!));
    const first = forked ? builder.forks(sequences, undefined) : builder.chain(sequences[0]!);
    // Banans kontroller får löpnummer i hela dokumentet.
    const renumber = new Map(Object.keys(builder.courseControls).map(id => [id, String(ccNext++)]));
    const mapped = (id: string | undefined) => id === undefined ? undefined : renumber.get(id)!;
    for (const item of Object.values(builder.courseControls)) {
      const id = mapped(item.id)!;
      courseControls[id] = { ...item, id, ...(item.next !== undefined ? { next: mapped(item.next) } : {}),
        ...(item.split ? { split: { ...item.split, branches: item.split.branches.map(branch => mapped(branch)!), end: mapped(item.split.end)! } } : {}) };
    }
    const climb = Math.max(0, ...members.map(member => member.climbMeters ?? 0));
    courses.push({ id: String(courses.length + 1), name, kind: score ? "SCORE" : "NORMAL", order: courses.length + 1, ...(first ? { first: mapped(first) } : {}),
      labelKind: score ? "CODE" : "SEQUENCE", ...(classNames.length > 0 ? { secondaryTitle: classNames.join(", ") } : {}),
      ...(climb > 0 ? { climbMeters: climb } : {}) });
  };

  for (const entry of entries) {
    const familyClasses = (member: LayoutCourse) => [entry.name, member.name];
    if (entry.members.length === 1 && entry.members[0]!.family === undefined) {
      add(entry.name, entry.members, false, classesOf([entry.name]));
      continue;
    }
    // Gafflad: bygg gafflingarna och kontrollera att varianterna blir exakt filens. Går det inte med alla kombinationer
    // byggs gafflingarna med fler varianter och de som inte står i filen väljs bort (ADR-0198).
    const before = { courseControls: { ...courseControls }, courses: [...courses], ccNext };
    const restore = () => {
      for (const id of Object.keys(courseControls)) if (!(id in before.courseControls)) delete courseControls[id];
      courses.length = before.courses.length;
      ccNext = before.ccNext;
    };
    const wanted = entry.members.map(member => key(member.controls.map(item => idOf.get(item.control)!)));
    const tryForks = (relaxed: boolean): boolean => {
      try {
        add(entry.name, entry.members, true, classesOf([entry.name, ...entry.members.map(member => member.name)]), relaxed);
        const added = courses[courses.length - 1]!;
        const draft: CourseSettingDocument = { ...base, controls, courseControls, courses };
        const all = courseVariantList(draft, added.id);
        const built = all.map(variant => key(variant.courseControls.map(id => courseControls[id]!.control)));
        if (!relaxed) return built.length === wanted.length && sameSet(built, wanted);
        const wantedKeys = new Set(wanted);
        if (new Set(built).size !== built.length || !wanted.every(row => built.includes(row))) return false;
        const excludedVariants = all.filter((_, index) => !wantedKeys.has(built[index]!))
          .map(variant => ({ code: variant.code, controls: [...variant.controlCodes] }));
        courses[courses.length - 1] = { ...added, ...(excludedVariants.length > 0 ? { excludedVariants } : {}) };
        return true;
      } catch (error) {
        if (!(error instanceof Fail || error instanceof CourseSettingEditError)) throw error;
        return false;
      }
    };
    // Filens variantkoder avgör när båda går: samma koder som i filen (t.ex. O-Tid:s eller Purple Pens "AC", "BD") vinner.
    const fileCodes = entry.members.map(member => member.variantCode ?? "");
    const codesMatch = () => sameSet(courseVariantList({ ...base, controls, courseControls, courses }, courses[courses.length - 1]!.id)
      .map(variant => variant.code), fileCodes);
    const score = entry.members.some(member => member.score);
    if (score) { restore(); } else {
      const strict = tryForks(false);
      if (strict && codesMatch()) continue;
      restore();
      const relaxed = tryForks(true);
      if (relaxed && (codesMatch() || !strict)) continue;
      restore();
      if (strict && tryForks(false)) continue;
      restore();
    }
    for (const member of entry.members) add(member.name, [member], false, classesOf(familyClasses(member)));
    asCourses.push(entry.name);
  }
  if (asCourses.length > 0) {
    notices.push({ code: "FORKS_AS_COURSES", text: `${asCourses.join(", ")}: varianterna gick inte att göra till gafflingar och är egna banor.` });
  }

  const document: CourseSettingDocument = { ...base, controls, courseControls, courses };
  // Längden räknas alltid ur lägena (ägaren 2026-11-03), så att en flyttad kontroll ändrar den. Skiljer filens längd mer än
  // 50 m från den uppmätta sägs det en gång; ingen fast längd sparas.
  const measured = new Map(summaries(document).map(summary => [summary.course, summary.lengthMeters]));
  for (const course of document.courses) {
    if (course.kind !== "NORMAL") continue;
    const members = layout.courses.filter(member => member.name === course.name || member.family === course.name);
    const lengths = members.map(member => member.lengthMeters).filter((value): value is number => value !== undefined);
    if (lengths.length === 0) continue;
    const length = Math.max(...lengths), computed = measured.get(course.id) ?? 0;
    if (Math.abs(length - computed) > COURSE_DATA_LENGTH_TOLERANCE_METERS) {
      notices.push({ code: "LENGTH_DIFFERS", text: `Banfilens längd för ${course.name} var ${distance(length)}, uppmätt ${distance(computed)}.` });
    }
  }
  return { document, notices };
}
