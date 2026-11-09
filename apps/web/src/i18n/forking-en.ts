/** Engelska texter för gafflingarna (ADR-0218). Samma nycklar som forkingSv. */
import type { ForkingProblem } from "@o-tid/domain";
import type { Texts } from "../lib/language";
import type { forkingSv } from "./forking-sv";

type LegPoint = "START" | "FINISH" | number;
const point = (value: LegPoint) => value === "START" ? "Start" : value === "FINISH" ? "Finish" : String(value);
const km = (meters: number) => `${(meters / 1000).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} km`;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const forkingEn: Texts<typeof forkingSv> = {
  start: "Start",
  finish: "Finish",
  courseDiagram: (course: string) => `Course diagram for ${course}: start to finish with the forks`,
  runnerDiagram: (name: string, code: string) => `Course diagram: ${name} ran variant ${code}`,
  legButton: (from: string, to: string) => `Leg ${from}–${to}`,
  controlButton: (code: number, center: boolean) => center ? `Butterfly centre control ${code}` : `Control ${code}`,
  branchButton: (letter: string, loop: boolean) => loop ? `Loop ${letter}` : `Option ${letter}`,
  branchCountShort: (entries: number, readOut: number) => `${entries}/${readOut}`,
  branchCountLong: (entries: number, readOut: number) => `${count(entries, "entry", "entries")}, ${readOut} read out`,
  branchCount: (description: string) => `Branch ${description}`,
  variantsBelow: (n: number) => n === 1 ? "1 variant (see below)" : `${n} variants (see below)`,
  title: "Forks",
  editForking: "Edit forks",
  editForkingLabel: (course: string) => `Edit forks on ${course}`,
  makeForked: "Fork the course",
  makeForkedLabel: (course: string) => `Fork the course ${course}`,
  convert: "Convert to structure",
  convertLabel: (course: string) => `Convert ${course} to structure`,
  convertHelp: (added: number) => added === 0 ? "The variants can be described as forks. Then you can edit them in the diagram."
    : `The variants can be described as forks. The structure adds ${count(added, "variant", "variants")}.`,
  derivedHelp: "The diagram is worked out from the course file's variants. Edit the variants one by one.",
  mode: "Forking type",
  modes: { BALANCED: "Balanced", UNEQUAL: "Unequal forking" },
  modeHelp: {
    BALANCED: "Butterflies and balanced forks: every variant should have the same legs. You get a warning otherwise.",
    UNEQUAL: "The options need not be equal, only close. The difference is shown as a note."
  },
  modeSaved: (mode: "BALANCED" | "UNEQUAL") => mode === "BALANCED" ? "The course is balanced." : "The course has unequal forking.",
  warning: (legs: readonly { from: LegPoint; to: LegPoint; variantCodes: readonly string[] }[]) =>
    `The variants do not have the same legs: ${legs.slice(0, 6).map(leg =>
      `${point(leg.from)}–${point(leg.to)} (${[...new Set(leg.variantCodes)].join(", ")})`).join("; ")}${legs.length > 6 ? " …" : ""}`,
  notice: "Unequal forking: the options are not balanced. This blocks nothing.",
  lengths: (shortest: number, longest: number) => shortest === longest ? `All variants ${km(shortest)}`
    : `${km(shortest)}–${km(longest)}, difference ${Math.round(longest - shortest)} m`,
  length: (meters: number | null) => meters === null ? "–" : km(meters),
  difference: (meters: number | null) => meters === null || meters === 0 ? "" : `+${meters} m`,
  lengthColumn: "Length",
  editorTitle: (course: string) => `Forks on ${course}`,
  editorHelp: "Tap a control or a leg in the diagram to add a butterfly or a fork. Type the controls in each option.",
  addLoop: (code: number) => `Add butterfly at ${code}`,
  removeLoop: "Remove the butterfly",
  addFork: (from: string, to: string) => `Add fork on ${from}–${to}`,
  removeFork: "Remove the fork",
  addControl: "Add control",
  addControlCode: "Code",
  removeControl: (code: number) => `Remove control ${code}`,
  invalidCode: "Type a control code (a whole number).",
  forkLegend: (number: number, letters: string) => `Fork ${number} (${letters})`,
  loopLegend: (center: number, letters: string) => `Butterfly at ${center} (${letters})`,
  branchField: (letter: string) => `Option ${letter}`,
  loopField: (letter: string) => `Loop ${letter}`,
  addBranch: "Add option",
  addLoopBranch: "Add loop",
  removeBranch: (letter: string) => `Remove ${letter}`,
  branchHelp: "Control codes separated by spaces, e.g. 41 42.",
  selectionHelp: "Choose a control or leg in the diagram.",
  generated: (n: number) => count(n, "variant", "variants"),
  generatedTitle: "The variants the course gives",
  noForks: "No fork yet: the course is saved as an ordinary course.",
  previewForking: (variants: number, removed: number, renamed: number, reassigned: number) => [
    `${count(variants, "variant", "variants")}.`,
    removed > 0 ? `${count(removed, "variant", "variants")} will be removed.` : "",
    renamed > 0 ? `${renamed} ${renamed === 1 ? "runner keeps" : "runners keep"} their control order under a new code.` : "",
    reassigned > 0 ? `${reassigned} ${reassigned === 1 ? "runner gets" : "runners get"} a new variant through the allocation.` : ""
  ].filter(Boolean).join(" "),
  previewExcluded: (codes: readonly string[]) =>
    `${codes.length === 1 ? "The variant" : "The variants"} ${codes.join(", ")} ${codes.length === 1 ? "is" : "are"} left out in course setting and will not be included.`,
  previewStaleExcluded: (codes: readonly string[]) =>
    `Choices to leave out in course setting that no longer match any variant: ${codes.join(", ")}. They no longer apply after the change; ` +
    "leave them out again in course setting if needed.",
  saved: (recalculated: number) => recalculated === 0 ? "The forks are saved." : `The forks are saved. ${count(recalculated, "result was", "results were")} recalculated.`,
  problem: (problem: ForkingProblem) => {
    switch (problem.kind) {
      case "EMPTY_COURSE": return "The course needs at least one control.";
      case "TOO_FEW_BRANCHES": return "A fork or butterfly needs at least two options.";
      case "TOO_MANY_BRANCHES": return "A fork or butterfly can have at most four options.";
      case "EMPTY_BRANCH": return "Every option and loop needs at least one control.";
      case "SAME_BRANCHES": return "Two options have the same controls.";
      case "LOOP_CONTAINS_CENTER": return "A loop cannot contain the butterfly's centre control.";
      case "TOO_MANY_LETTERS": return "The course has too many options (at most 26 letters).";
      case "TOO_MANY_VARIANTS": return `The course gives ${problem.count} variants; at most 100 are allowed.`;
    }
  },
  showForking: "Show forks",
  variantLength: (code: string, meters: number | null, difference: number | null) =>
    `Variant ${code}${meters === null ? "" : ` · ${km(meters)}`}${difference ? ` (+${difference} m)` : ""}`,
  loopOrder: "The numbers show the order in which the loops were run.",
  byLeg: "By leg",
  byVariant: "By variant",
  splitModeLabel: "Compare legs",
  legHeading: (from: string, to: string) => `${from}–${to}`
};
