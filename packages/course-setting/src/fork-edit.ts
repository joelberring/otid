/**
 * Ägaren 2026-11-17 («hanteringen av gafflingar vid banläggning behöver ses över … lägga till och ta bort på delsträckor likt
 * Purple Pen på ett enkelt sätt»): en gren till i en gaffling, och gaffelpunkten eller mötespunkten flyttad en kontroll
 * framåt eller bakåt. Grenarnas banans kontroller (gaffelkontrollen i varje gren) behåller sina id, så att bokstäverna står
 * kvar (`keepForkLetters` går på id): flyttas början är det kontrollen i dem som byts.
 *
 * Modellen är Purple Pens (`CourseControlSplit`): varje gren börjar med en egen banans kontroll för gaffelkontrollen, alla med
 * samma `split`, och grenarna möts vid `split.end`. Banans huvudväg går genom första grenen.
 */
import { nextId } from "./ppen-common";
import { CourseSettingEditError, type Course, type CourseControl, type CourseControlSplit, type CourseSettingDocument } from "./types";
import { enumerateCourseControls, findCourse } from "./walk";

const invalid = (message: string) => new CourseSettingEditError("INVALID", message);
const MAX_BRANCHES = 20;

export type SplitEdge = "START" | "END";
export type SplitDirection = "FORWARD" | "BACK";

interface Parts { readonly courseControls: Record<string, CourseControl>; readonly courses: Course[] }

function without(item: CourseControl, ...keys: (keyof CourseControl)[]): CourseControl {
  const copy: Record<string, unknown> = { ...item };
  for (const key of keys) delete copy[key];
  return copy as unknown as CourseControl;
}

function splitAt(document: CourseSettingDocument, courseId: string, at: string): { split: CourseControlSplit; ids: readonly string[] } {
  findCourse(document, courseId);
  if (!enumerateCourseControls(document, courseId).includes(at)) throw new CourseSettingEditError("NOT_FOUND", `Banans kontroll ${at} på banan finns inte`);
  const split = document.courseControls[at]?.split;
  if (!split) throw invalid("Här finns ingen gaffling");
  return { split, ids: enumerateCourseControls(document, courseId) };
}

/** En gren till: tom (gaffelkontrollen direkt till mötespunkten; i en slinga tillbaka till gaffelkontrollen). */
export function addBranch(document: CourseSettingDocument, courseId: string, at: string): Parts & { readonly created: string } {
  const { split } = splitAt(document, courseId, at);
  if (split.branches.length >= MAX_BRANCHES) throw invalid(`Högst ${MAX_BRANCHES} grenar`);
  const courseControls = { ...document.courseControls };
  const id = nextId(Object.keys(courseControls));
  const template = without(courseControls[split.branches[0]!]!, "letter", "numberAt", "descriptionTextBefore", "descriptionTextAfter");
  const branches = [...split.branches, id];
  courseControls[id] = { ...template, id, next: split.end, split: { ...split, branches } };
  for (const branch of split.branches) courseControls[branch] = { ...courseControls[branch]!, split: { ...split, branches } };
  return { courseControls, courses: [...document.courses], created: id };
}

/** Banans kontroller i grenen `branch` fram till mötespunkten (inte gaffelkontrollen), med grenar i grenen. */
function branchMembers(document: CourseSettingDocument, branch: string, join: string): Set<string> {
  const members = new Set<string>();
  const queue = [document.courseControls[branch]?.next];
  while (queue.length) {
    const id = queue.pop();
    if (id === undefined || id === join || members.has(id)) continue;
    const item = document.courseControls[id];
    if (!item) continue;
    members.add(id);
    queue.push(item.next);
    if (item.split) queue.push(...item.split.branches.filter(other => other !== id));
  }
  return members;
}

/** Banans kontroller (i hela banan) vars `next` är `id`. */
const predecessors = (document: CourseSettingDocument, ids: readonly string[], id: string) => ids.filter(other => document.courseControls[other]?.next === id);

export function moveSplit(document: CourseSettingDocument, courseId: string, at: string, edge: SplitEdge, direction: SplitDirection): Parts {
  const { split, ids } = splitAt(document, courseId, at);
  if (split.kind !== "FORK") throw invalid("Bara en gaffling kan flyttas, inte en slinga");
  const courseControls: Record<string, CourseControl> = { ...document.courseControls };
  let courses = [...document.courses];
  const codeOf = (id: string) => { const point = document.controls[courseControls[id]!.control]; return point?.code ?? point?.kind ?? "?"; };
  const fresh = () => nextId(Object.keys(courseControls));
  const setSplit = (next: CourseControlSplit) => { for (const branch of next.branches) courseControls[branch] = { ...courseControls[branch]!, split: next }; };
  // Pekare till `from` (nästa, kursens första, gafflingars mötespunkt) pekar på `to` i stället.
  const repoint = (from: string, to: string, among: readonly string[] = ids) => {
    for (const id of among) {
      const item = courseControls[id];
      if (!item) continue;
      let updated = item;
      if (updated.next === from) updated = { ...updated, next: to };
      if (updated.split && updated.split.end === from) updated = { ...updated, split: { ...updated.split, end: to } };
      if (updated !== item) courseControls[id] = updated;
    }
    courses = courses.map(course => course.id === courseId && course.first === from ? { ...course, first: to } : course);
  };
  const { branches, end: join } = split;
  const first = branches[0]!;

  if (edge === "START" && direction === "FORWARD") {
    // Varje gren börjar med samma kontroll: den blir gemensam och gafflingen börjar där i stället.
    const firsts = branches.map(branch => courseControls[branch]!.next);
    if (firsts.some(id => id === undefined || id === join)) throw invalid("En gren är tom: lägg in samma kontroll först i alla grenar");
    const controls = new Set(firsts.map(id => courseControls[id!]!.control));
    if (controls.size !== 1) throw invalid(`Grenarna börjar inte med samma kontroll (${firsts.map(id => codeOf(id!)).join(", ")})`);
    if (firsts.some(id => courseControls[id!]!.split)) throw invalid("Gafflingen kan inte flyttas in i en annan gaffling");
    const common = fresh();
    const head = courseControls[first]!;
    courseControls[common] = { ...without(head, "split", "letter"), id: common, next: first };
    repoint(first, common, ids.filter(id => id !== common && !branches.includes(id)));
    const moved: CourseControlSplit = { ...split };
    for (const branch of branches) {
      const old = courseControls[branch]!, next = courseControls[old.next!]!;
      courseControls[branch] = { ...without(next, "letter", "split"), id: branch, split: moved, ...(old.letter !== undefined ? { letter: old.letter } : {}) };
      delete courseControls[next.id];
    }
    return { courseControls, courses };
  }

  if (edge === "START" && direction === "BACK") {
    // Kontrollen före gafflingen kommer in i varje gren och gafflingen börjar en kontroll tidigare.
    const before = predecessors(document, ids, first);
    if (before.length !== 1) throw invalid(before.length === 0 ? "Det finns ingen kontroll före gafflingen" : "Gafflingen börjar där en annan gaffling möts");
    const previous = courseControls[before[0]!]!;
    if (previous.split) throw invalid("Kontrollen före börjar redan en gaffling");
    const kind = document.controls[previous.control]?.kind;
    if (kind === "MAP_ISSUE") throw invalid("Gafflingen kan inte börja vid kartutdelningen");
    if (ids.some(id => courseControls[id]?.split?.branches.includes(previous.id))) throw invalid("Kontrollen före börjar en gren i en annan gaffling");
    for (const branch of branches) {
      const old = courseControls[branch]!, inBranch = fresh();
      courseControls[inBranch] = { ...without(old, "split", "letter"), id: inBranch };
      courseControls[branch] = { ...without(previous, "split", "letter", "next"), id: branch, next: inBranch, split,
        ...(old.letter !== undefined ? { letter: old.letter } : {}) };
    }
    repoint(previous.id, first, ids.filter(id => id !== previous.id));
    delete courseControls[previous.id];
    return { courseControls, courses };
  }

  const members = branches.map(branch => branchMembers(document, branch, join));
  const inFork = new Set([...branches, ...members.flatMap(set => [...set])]);
  // Banans kontroller i grenen som går till mötespunkten (gaffelkontrollen själv när grenen är tom).
  const ends = branches.map((branch, index) => [branch, ...members[index]!].filter(id => document.courseControls[id]?.next === join));

  if (edge === "END" && direction === "FORWARD") {
    // Mötespunkten kommer in i varje gren och grenarna möts vid kontrollen efter.
    const meeting = courseControls[join];
    if (!meeting || meeting.next === undefined) throw invalid("Det finns ingen kontroll efter mötespunkten");
    if (meeting.split) throw invalid("Mötespunkten börjar en annan gaffling");
    if (ids.some(id => !inFork.has(id) && courseControls[id]?.split?.end === join && !branches.includes(id))) {
      throw invalid("En annan gaffling möts vid samma kontroll");
    }
    const after = meeting.next;
    branches.forEach((branch, index) => {
      if (index === 0) return;
      const copy = fresh();
      courseControls[copy] = { ...without(meeting, "letter", "numberAt", "descriptionTextBefore", "descriptionTextAfter"), id: copy, next: after };
      repoint(join, copy, [branch, ...members[index]!]);
    });
    setSplit({ ...split, end: after });
    return { courseControls, courses };
  }

  // END BACK: grenarna slutar med samma kontroll; den blir gemensam och grenarna möts där i stället.
  if (ends.some((list, index) => list.length !== 1 || list[0] === branches[index])) {
    throw invalid("Varje gren ska sluta med en egen kontroll (inga tomma grenar och inga grenar i grenen vid slutet)");
  }
  const lasts = ends.map(list => list[0]!);
  if (new Set(lasts.map(id => courseControls[id]!.control)).size !== 1) {
    throw invalid(`Grenarna slutar inte med samma kontroll (${lasts.map(codeOf).join(", ")})`);
  }
  if (lasts.some(id => courseControls[id]!.split)) throw invalid("Mötespunkten kan inte flyttas in i en annan gaffling");
  const meeting = lasts[0]!;
  lasts.forEach((last, index) => {
    if (index === 0) return;
    repoint(last, meeting, [branches[index]!, ...members[index]!]);
    delete courseControls[last];
  });
  setSplit({ ...split, end: meeting });
  return { courseControls, courses };
}
