import {
  bakeDetailGaps, detailCircleCenters, type CircleArc, type CircleCutting, type CourseSettingDocument, type CourseSettingEdit, type DetailCircle
} from "@o-tid/course-setting";

/**
 * Ringklipp i editorn (ADR-0180 beslut 10) utan React: valen i dokumentet, beställningen av detaljgapen från kartans
 * Worker och vilka svar som fortfarande gäller medan kontroller flyttas.
 */
export type DetailGaps = Readonly<Record<string, readonly CircleArc[]>>;

/** Detaljgapen räknas om så här länge efter senaste ändringen (en dragning ger många ändringar). */
export const DETAIL_GAPS_DELAY_MS = 400;

const OFF: CircleCutting = { overlap: false, details: false };

/** Valen i dokumentet; saknas = av (som Purple Pen). */
export function circleCuttingOf(document: CourseSettingDocument): CircleCutting {
  return document.event.circleCutting ?? OFF;
}

/** Ändringen som slår på eller av ett av valen. */
export function circleCuttingEdit(document: CourseSettingDocument, change: Partial<CircleCutting>): CourseSettingEdit {
  return { type: "SET_EVENT", changes: { circleCutting: { ...circleCuttingOf(document), ...change } } };
}

/** Vad Workern ska räkna: ringarna, om sprintens symboler gäller och en nyckel som ändras när någon ring ändras. */
export interface DetailRequest {
  readonly circles: readonly DetailCircle[];
  readonly sprint: boolean;
  readonly key: string;
}

const ringKey = (circle: DetailCircle) =>
  `${circle.id}:${circle.at.x.toFixed(3)},${circle.at.y.toFixed(3)}:${circle.radiusMm.toFixed(3)}:${(circle.blockedDegrees ?? []).map(angle => angle.toFixed(1)).join("/")}`;

export function detailRequest(document: CourseSettingDocument): DetailRequest {
  const circles = detailCircleCenters(document);
  const sprint = document.event.overprintStandard === "ISSPROM2019";
  return { circles, sprint, key: `${sprint ? "S" : "F"}|${circles.map(ringKey).join("|")}` };
}

/** Ett svar från Workern: gapen och ringarna de räknades för. */
export interface DetailResult {
  readonly circles: readonly DetailCircle[];
  readonly gaps: DetailGaps;
}

/**
 * Gapen som gäller nu: bara för ringar som ligger kvar där de låg när gapen räknades (en flyttad kontroll ritas hel tills
 * de räknats om, i stället för med gap som inte längre stämmer).
 */
export function currentDetailGaps(result: DetailResult | undefined, request: DetailRequest | undefined): DetailGaps | undefined {
  if (!result || !request) return undefined;
  const then = new Map(result.circles.map(circle => [circle.id, ringKey(circle)]));
  const out: Record<string, readonly CircleArc[]> = {};
  for (const circle of request.circles) {
    const gaps = result.gaps[circle.id];
    if (gaps && then.get(circle.id) === ringKey(circle)) out[circle.id] = gaps;
  }
  return out;
}

/** Ändringarna som gör klippen fasta (en per kontroll) och hur många kontroller som får nya avbrott. */
export function bakeEdits(document: CourseSettingDocument, gaps: DetailGaps | undefined): { edits: CourseSettingEdit[]; controls: number } {
  if (!gaps) return { edits: [], controls: 0 };
  const edits = bakeDetailGaps(document, gaps);
  return { edits, controls: edits.length };
}
