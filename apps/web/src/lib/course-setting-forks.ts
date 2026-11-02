import { legPath, variantLetters, variations, type CourseSettingDocument } from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { ALL_CONTROLS } from "./course-setting-hit";
import { controlLabel } from "./course-setting-text";

/**
 * ADR-0180 beslut 14: gafflingarna som i Purple Pens topologi (TopologyFormatter): banan som ett träd där grenarna står
 * bredvid varandra med bokstav och går ihop vid kontrollen där de möts. En gren börjar med en egen banans kontroll för
 * gaffelkontrollen (Purple Pens modell, `CourseControlSplit`); att arbeta i en gren = nya kontroller läggs in efter den
 * sista banans kontrollen i grenen. Varianten som visas kraftigt är den första som går genom grenen.
 */
export interface TreeControl {
  readonly kind: "control";
  readonly courseControl: string;
  readonly control: string;
  readonly label: string;
}

export interface TreeBranch {
  /** Banans kontroll som börjar grenen (gaffelkontrollen i den grenen). */
  readonly start: string;
  readonly letter: string;
  readonly rows: readonly TreeRow[];
  /** Sista banans kontroll i grenen: där nästa kontroll läggs in. */
  readonly last: string;
}

export interface TreeFork {
  readonly kind: "fork";
  readonly split: "FORK" | "LOOP";
  /** Gaffelkontrollen (första grenens banans kontroll). */
  readonly at: string;
  readonly branches: readonly TreeBranch[];
  /** Kontrollen där grenarna möts (slingan: gaffelkontrollen), som etikett. */
  readonly joinLabel: string;
}

export type TreeRow = TreeControl | TreeFork;

const label = (document: CourseSettingDocument, courseControl: string) => {
  const control = document.courseControls[courseControl]?.control;
  return control && document.controls[control] ? controlLabel(document, control) : "?";
};

/** Banan som träd. Tom lista för Alla kontroller eller en bana som inte går att gå igenom. */
export function courseTree(document: CourseSettingDocument, course: string): TreeRow[] {
  const found = document.courses.find(row => row.id === course);
  if (!found || course === ALL_CONTROLS) return [];
  const letters = variantLetters(document, course);
  const guard = { steps: 0, limit: 20 * (Object.keys(document.courseControls).length + 5) };
  const walk = (start: string | undefined, join: string | undefined): TreeRow[] => {
    const rows: TreeRow[] = [];
    let id = start;
    while (id !== undefined && id !== join && document.courseControls[id]) {
      if (++guard.steps > guard.limit) break;
      const item = document.courseControls[id]!;
      rows.push({ kind: "control", courseControl: id, control: item.control, label: label(document, id) });
      const split = item.split;
      if (split && (split.branches[0] === id)) {
        const branchIds = split.kind === "LOOP" ? split.branches.slice(1) : split.branches;
        const branches = branchIds.map(branch => {
          const inside = walk(document.courseControls[branch]?.next, split.end);
          return { start: branch, letter: letters.get(branch) ?? "?", rows: inside, last: lastIn(branch, inside) };
        });
        rows.push({ kind: "fork", split: split.kind, at: id, branches, joinLabel: label(document, split.end) });
        id = split.kind === "LOOP" ? item.next : split.end;
        continue;
      }
      id = item.next;
    }
    return rows;
  };
  return walk(found.first, undefined);
}

/** Sista banans kontroll längs grenens huvudspår (en gaffling i grenen: där den går ihop). */
function lastIn(start: string, rows: readonly TreeRow[]): string {
  let last = start;
  for (const row of rows) if (row.kind === "control") last = row.courseControl;
  return last;
}

/** Alla grenar i trädet (också i gafflingar i grenar), i ordning. */
export function allBranches(rows: readonly TreeRow[]): TreeBranch[] {
  const out: TreeBranch[] = [];
  for (const row of rows) {
    if (row.kind !== "fork") continue;
    for (const branch of row.branches) { out.push(branch); out.push(...allBranches(branch.rows)); }
  }
  return out;
}

/** Gafflingen som grenen hör till och grenens plats i den. */
export function forkOfBranch(rows: readonly TreeRow[], start: string): { fork: TreeFork; index: number } | undefined {
  for (const row of rows) {
    if (row.kind !== "fork") continue;
    const index = row.branches.findIndex(branch => branch.start === start);
    if (index >= 0) return { fork: row, index };
    for (const branch of row.branches) {
      const inner = forkOfBranch(branch.rows, start);
      if (inner) return inner;
    }
  }
  return undefined;
}

/** Den innersta grenen som banans kontroll ligger i (eller börjar), annars undefined. */
export function branchOf(rows: readonly TreeRow[], courseControl: string): TreeBranch | undefined {
  for (const row of rows) {
    if (row.kind !== "fork") continue;
    for (const branch of row.branches) {
      const inner = branchOf(branch.rows, courseControl);
      if (inner) return inner;
      if (branch.start === courseControl || branch.rows.some(item => item.kind === "control" && item.courseControl === courseControl)) return branch;
    }
  }
  return undefined;
}

/** Varianten som visas kraftigt när man arbetar i grenen: den första som går genom grenens början. */
export function branchVariant(document: CourseSettingDocument, course: string, start: string | undefined): string | undefined {
  if (!start || course === ALL_CONTROLS) return undefined;
  try {
    return variations(document, course).find(variation => variation.choices.includes(start))?.code;
  } catch {
    return undefined;
  }
}

export interface BranchLabel {
  readonly start: string;
  readonly letter: string;
  readonly at: Point;
}

/**
 * Bokstäverna på kartan: en bit ut på grenens första sträcka (från gaffelkontrollen mot grenens första kontroll, eller mot
 * kontrollen där grenarna möts när grenen är tom). Tomma slingor får bokstaven bredvid gaffelkontrollen.
 */
export function branchLabels(document: CourseSettingDocument, course: string, rows = courseTree(document, course), offsetMm = 4): BranchLabel[] {
  const out: BranchLabel[] = [];
  for (const branch of allBranches(rows)) {
    const item = document.courseControls[branch.start];
    const from = item ? document.controls[item.control] : undefined;
    const nextItem = item?.next !== undefined ? document.courseControls[item.next] : undefined;
    const to = nextItem ? document.controls[nextItem.control] : undefined;
    if (!from) continue;
    if (!to || to.id === from.id) {
      const index = out.filter(label => label.at.x > from.at.x).length;
      out.push({ start: branch.start, letter: branch.letter, at: { x: from.at.x + offsetMm * (1.4 + index), y: from.at.y + offsetMm } });
      continue;
    }
    const path = legPath(document, from.id, to.id);
    const [a, b] = [path[0]!, path[1]!];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const share = length > 0 ? Math.min(0.5, (offsetMm * 2.2) / length) : 0;
    out.push({ start: branch.start, letter: branch.letter, at: { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share } });
  }
  return out;
}
