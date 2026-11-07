/** Papperet (ADR-0197): variablerna i texterna ({bana}, {längd} …, ADR-0213 löparens) och deras Purple Pen-makron. */
import { courseLength } from "./summary";
import type { CourseSettingDocument } from "./types";
import { RUNNER_PAPER_VARIABLES } from "./paper-items";

/** Det som variablerna fylls i för: ramens bana, variant, skala och (i en karta per löpare) löparen. */
export interface PaperTextFrame {
  readonly course: string;
  readonly variant?: string | undefined;
  /** Kartbyten (ADR-0203): delen av banan. */
  readonly part?: number | undefined;
  readonly printScale: number;
  readonly runner?: { readonly kind: "RUNNER" | "VACANT" | "RESERVE"; readonly name: string | null; readonly club?: string | null | undefined;
    readonly className: string | null; readonly startTime: string | null; readonly startNumber: number | null;
    /** Stafett (ADR-0213): laget och sträckan. */
    readonly team?: { readonly number: number; readonly name: string } | undefined; readonly leg?: number | undefined } | undefined;
  /**
   * ADR-0213: utan löpare står löparens variabler kvar som {namn} … (förhandsvisningen av banor, så att man ser var de hamnar);
   * annars blir de tomma (PDF:en och utskriften av banor).
   */
  readonly runnerPlaceholders?: boolean | undefined;
}

const thousands = (value: number) => Math.round(value).toLocaleString("sv-SE").replace(/\s/g, " ");

function lengthMeters(document: CourseSettingDocument, course: string, variant: string | undefined): number | undefined {
  const found = document.courses.find(item => item.id === course);
  if (!found) return undefined;
  return courseLength(document, found.id, { variant }).meters;
}

/** Variablernas värden för ramen. */
export function paperTextValues(document: CourseSettingDocument, frame: PaperTextFrame | undefined, date?: string): Record<string, string> {
  const course = frame ? document.courses.find(item => item.id === frame.course) : undefined;
  const meters = frame ? lengthMeters(document, frame.course, frame.variant) : undefined;
  const runner = frame?.runner;
  const classes = (course?.secondaryTitle ?? "").replace(/\|/g, " ");
  return {
    "tävling": document.event.title.replace(/\|/g, " "),
    bana: frame ? course?.name ?? "Alla kontroller" : "",
    variant: frame?.variant ?? "",
    "längd": meters === undefined ? "" : `${(Math.round(meters / 100) / 10).toFixed(1).replace(".", ",")} km`,
    stigning: course?.climbMeters !== undefined && course.climbMeters >= 0 ? `${Math.round(course.climbMeters / 5) * 5} m` : "",
    skala: frame ? `1:${thousands(frame.printScale)}` : "",
    datum: date ?? document.event.paperValues?.date ?? "",
    ekvidistans: document.event.paperValues?.contourInterval ?? "",
    klasser: classes,
    // Klassen: löparens i en karta per löpare, annars banans klasser.
    klass: runner ? runner.className ?? "" : classes,
    ...runnerValues(frame)
  };
}

/** Löparens variabler (ADR-0213); utan löpare tomma, eller som platshållare i förhandsvisningen av banor. */
function runnerValues(frame: PaperTextFrame | undefined): Record<string, string> {
  const runner = frame?.runner;
  if (!runner) {
    const keep = frame?.runnerPlaceholders === true;
    return Object.fromEntries(["löpare", ...RUNNER_PAPER_VARIABLES].map(key => [key, keep ? `{${key}}` : ""]));
  }
  const name = runner.name ?? (runner.kind === "VACANT" ? "Ledig" : runner.kind === "RESERVE" ? "Reserv" : "");
  return {
    "löpare": name, namn: name,
    klubb: runner.club ?? "",
    starttid: runner.startTime ?? "",
    startnummer: runner.startNumber !== null && runner.startNumber !== undefined ? String(runner.startNumber) : "",
    lag: runner.team?.name ?? "",
    lagnummer: runner.team ? String(runner.team.number) : "",
    "sträcka": runner.leg !== undefined ? String(runner.leg) : ""
  };
}

/** Texten med variablerna ifyllda ({bana}, {längd} …); okända lämnas kvar. Raderna behålls, tomma rader i slutet tas bort. */
export function expandPaperText(text: string, document: CourseSettingDocument, frame: PaperTextFrame | undefined, date?: string): string {
  const values = paperTextValues(document, frame, date);
  return text.split("\n").map(line => line.replace(/\{([a-zåäö]+)\}/gi, (whole, key: string) => values[key.toLowerCase()] ?? whole)
    .replace(/ {2,}(?=\S)/g, "  ").trimEnd()).join("\n").replace(/\n+$/, "").replace(/^\s+$/, "");
}

/** Purple Pens makron för variablerna; datum och ekvidistans har inget makro och skrivs som text. */
const PPEN_MACROS: Readonly<Record<string, string>> = {
  bana: "$(CourseName)", "tävling": "$(EventTitle)", "längd": "$(CourseLength) km", stigning: "$(CourseClimb) m", skala: "$(PrintScale)",
  klass: "$(ClassList)", klasser: "$(ClassList)", variant: "$(Variation)"
};

/** Texten för Purple Pens textobjekt: variablerna som Purple Pens makron, datum och ekvidistans ifyllda. */
export function paperTextForPpen(text: string, document: CourseSettingDocument): string {
  return text.replace(/\{([a-zåäö]+)\}/gi, (whole, key: string) => {
    const name = key.toLowerCase();
    const macro = PPEN_MACROS[name];
    if (macro) return macro;
    if (name === "datum") return document.event.paperValues?.date ?? "";
    if (name === "ekvidistans") return document.event.paperValues?.contourInterval ?? "";
    return whole;
  });
}
