/**
 * Banpåtrycket för träningen (ADR-0192 beslut 5–7): sista säkra, markeringar vid avsnitten, kepsens etiketter "1a"/"1b",
 * linjen i linjeorientering och ett avsnitt i taget (stjärnans udd, en kartbit). Läggs på `layout` för banan och varianten.
 */
import type { Point } from "@o-tid/map-file";
import { sizesFor, type Sizes } from "./appearance";
import { legKey } from "./ppen-common";
import type { CourseSettingDocument, OverprintOptions, OverprintPrimitive } from "./types";
import type { CourseTraining, SectionForm, TrainingSection } from "./training-types";
import { controlSequences, sectionRange } from "./training-regions";
import { trainingOf } from "./training-passes";

const POINT_ROLES = new Set(["START", "CONTROL", "FINISH", "CROSSING_POINT", "MAP_EXCHANGE", "NUMBER"]);
const LEG_ROLES = new Set(["LEG", "FLAGGING"]);

/** Formens namn för markeringen vid bytet. */
export const SECTION_MARKER_TEXT: Readonly<Record<SectionForm, string>> = {
  CORRIDOR: "Korridor", WINDOW: "Fönster", BAND: "Område", NO_MAP: "Utan karta"
};
const PRESET_MARKER: Readonly<Record<string, string>> = {
  CONTOURS: "Kurvbild", CONTOURS_WATER_ROCK: "Kurvbild", NO_VEGETATION: "Utan vegetation", NO_PATHS: "Utan stigar", PATHS_ROADS: "Stigar"
};

/** Texten vid avsnittets början ("Kurvbild →"). */
export function sectionMarkerText(section: TrainingSection): string {
  if (section.marker.text !== undefined && section.marker.text.trim() !== "") return section.marker.text;
  const name = section.form === "BAND" ? PRESET_MARKER[section.filter.preset] ?? SECTION_MARKER_TEXT.BAND : SECTION_MARKER_TEXT[section.form];
  return `${name} →`;
}

/** Ringen streckad: 12 avbrott (som en streckad linje). */
export function dashedGaps(count = 12, fraction = 0.4): { startDegrees: number; endDegrees: number }[] {
  const step = 360 / count;
  return Array.from({ length: count }, (_, i) => ({ startDegrees: i * step, endDegrees: i * step + step * fraction }));
}

const unit = (a: Point, b: Point) => { const l = Math.hypot(b.x - a.x, b.y - a.y); return l > 0 ? { x: (b.x - a.x) / l, y: (b.y - a.y) / l } : { x: 0, y: 1 }; };

/** Kepsens etiketter per kontroll (kontrollens id → "1a"), och vilka som är a respektive b. */
export function pairLabels(document: CourseSettingDocument, training: CourseTraining | undefined): { labels: Map<string, string>; a: Set<string>; b: Set<string> } {
  const labels = new Map<string, string>(), a = new Set<string>(), b = new Set<string>();
  (training?.pairs?.pairs ?? []).forEach(([first, second], index) => {
    const ca = document.courseControls[first]?.control, cb = document.courseControls[second]?.control;
    if (ca !== undefined) { labels.set(ca, `${index + 1}a`); a.add(ca); }
    if (cb !== undefined) { labels.set(cb, `${index + 1}b`); b.add(cb); }
  });
  return { labels, a, b };
}

/** Figurerna med träningen för banan i `options`. */
export function withTraining(document: CourseSettingDocument, options: OverprintOptions, figures: readonly OverprintPrimitive[], printScale: number): OverprintPrimitive[] {
  const view = options.training;
  if (options.course === "ALL_CONTROLS" || view?.off || !document.training) return [...figures];
  const training = trainingOf(document);
  const ct = training.courses[options.course];
  const sizes = sizesFor(document, printScale);
  const sequences = controlSequences(document, options.course, options.variant);
  const controlOfCc = (ccId: string | undefined) => ccId === undefined ? undefined : document.courseControls[ccId]?.control;
  const controlOfRef = (ref: string | undefined) => controlOfCc(ref) ?? ref;

  // Avsnittet som skrivs ut (stjärnans udd, en kartbit): kontrollerna och sträckorna i det.
  let keepControls: Set<string> | undefined, keepLegs: Set<string> | undefined;
  if (view?.section) {
    const sequence = sequences[0] ?? [];
    keepControls = new Set(); keepLegs = new Set();
    for (let i = Math.max(0, view.section.from); i <= Math.min(sequence.length - 1, view.section.to); i++) {
      const control = controlOfCc(sequence[i]);
      if (control !== undefined) keepControls.add(control);
      const next = i < view.section.to ? controlOfCc(sequence[i + 1]) : undefined;
      if (control !== undefined && next !== undefined) keepLegs.add(legKey(control, next));
    }
  }
  const lineRunner = ct?.line && ct.line.points.length >= 2 && view?.view !== "CONTROLLER";
  const pairs = pairLabels(document, ct);
  const pairing = ct?.pairs && pairs.labels.size > 0;
  const takeIn = view?.pairMap === "A" ? pairs.b : view?.pairMap === "B" ? pairs.a : undefined;

  const out: OverprintPrimitive[] = [];
  for (const figure of figures) {
    const role = figure.role;
    if (keepControls && POINT_ROLES.has(role)) { const control = controlOfRef(figure.ref); if (control !== undefined && !keepControls.has(control)) continue; }
    if (keepLegs && LEG_ROLES.has(role) && figure.ref !== undefined && !keepLegs.has(figure.ref)) continue;
    if (lineRunner && (LEG_ROLES.has(role) || role === "CONTROL" || role === "NUMBER" || role === "CROSSING_POINT" || role === "MAP_EXCHANGE")) continue;
    if (pairing && !ct.pairs.legs && LEG_ROLES.has(role)) continue;
    if (pairing && role === "NUMBER" && figure.kind === "text") {
      const label = pairs.labels.get(controlOfRef(figure.ref) ?? "");
      if (label) { out.push({ ...figure, text: label }); continue; }
    }
    if (takeIn && role === "CONTROL" && figure.kind === "circle" && takeIn.has(controlOfRef(figure.ref) ?? "")) {
      out.push({ ...figure, gaps: [...(figure.gaps ?? []), ...dashedGaps()] });
      continue;
    }
    out.push(figure);
  }

  if (ct?.line && ct.line.points.length >= 2) {
    out.push({ kind: "polyline", role: "TRAINING", color: "COURSE", points: ct.line.points, width: sizes.line, cap: "round", ref: "line" });
  }
  out.push(...attackFigures(document, sequences, sizes, keepLegs));
  if (ct && !view?.section) out.push(...markerFigures(document, ct, sequences, sizes));
  return out;
}

function attackFigures(document: CourseSettingDocument, sequences: readonly (readonly string[])[], sizes: Sizes, keepLegs: Set<string> | undefined): OverprintPrimitive[] {
  const training = trainingOf(document);
  const attacks = Object.values(training.attackPoints);
  if (attacks.length === 0) return [];
  const legs = new Set<string>();
  for (const sequence of sequences) for (let i = 0; i + 1 < sequence.length; i++) {
    const from = document.courseControls[sequence[i]!]?.control, to = document.courseControls[sequence[i + 1]!]?.control;
    if (from !== undefined && to !== undefined) legs.add(legKey(from, to));
  }
  const style = training.attackStyle ?? { sizeRatio: 0.6, style: "SOLID" as const };
  return attacks.filter(attack => legs.has(legKey(attack.from, attack.to)) && (!keepLegs || keepLegs.has(legKey(attack.from, attack.to))))
    .map(attack => ({ kind: "circle", role: "TRAINING", color: "COURSE", center: attack.at, diameter: sizes.control * style.sizeRatio,
      lineWidth: style.style === "THIN" ? sizes.line / 2 : sizes.line, ...(style.style === "DASHED" ? { gaps: dashedGaps() } : {}),
      ref: `attack:${attack.id}` }) as OverprintPrimitive);
}

function markerFigures(document: CourseSettingDocument, training: CourseTraining, sequences: readonly (readonly string[])[], sizes: Sizes): OverprintPrimitive[] {
  const out: OverprintPrimitive[] = [];
  const seen = new Set<string>();
  for (const section of training.sections) {
    if (section.marker.kind === "NONE" || section.from === null) continue;
    for (const sequence of sequences) {
      const range = sectionRange(document, sequence, section);
      if (!range || range.start >= sequence.length - 1) continue;
      const here = document.controls[document.courseControls[sequence[range.start]!]?.control ?? ""];
      const nextControl = document.controls[document.courseControls[sequence[range.start + 1]!]?.control ?? ""];
      if (!here || !nextControl || seen.has(`${section.id}:${here.id}`)) continue;
      seen.add(`${section.id}:${here.id}`);
      const bend = document.legs[legKey(here.id, nextControl.id)]?.bends[0] ?? nextControl.at;
      const d = unit(here.at, bend);
      const n = { x: -d.y, y: d.x };
      const radius = sizes.control / 2 + sizes.line;
      if (section.marker.kind === "BAR") {
        const at = { x: here.at.x + d.x * (radius + 1.2 * sizes.ratio), y: here.at.y + d.y * (radius + 1.2 * sizes.ratio) };
        const half = 1.6 * sizes.ratio;
        out.push({ kind: "polyline", role: "TRAINING", color: "COURSE", points: [{ x: at.x - n.x * half, y: at.y - n.y * half }, { x: at.x + n.x * half, y: at.y + n.y * half }],
          width: sizes.line * 1.5, ref: `section:${section.id}` });
      } else {
        const height = sizes.numberHeight * 0.75;
        const full = sectionMarkerText(section);
        // Pilen sist ritas som figur (tecknet → finns inte i alla typsnitt, t.ex. PDF:ens), i sträckans riktning.
        const arrow = /\s*→\s*$/.test(full);
        const label = full.replace(/\s*→\s*$/, "");
        const em = height * 1.39;
        const width = Math.max(1, label.length) * 0.55 * em;
        // Texten på sträckans vänstra sida, strax efter ringen.
        const along = radius + width / 2;
        const at = { x: here.at.x + d.x * along + n.x * (height * 1.1), y: here.at.y + d.y * along + n.y * (height * 1.1) };
        out.push({ kind: "text", role: "TRAINING", color: "COURSE", at, text: label, heightMm: em, align: "center", ref: `section:${section.id}` });
        if (arrow) {
          const shaft = 2.2 * sizes.ratio, head = 0.8 * sizes.ratio;
          const from = { x: at.x + width / 2 + 0.6 * sizes.ratio, y: at.y };
          const to = { x: from.x + d.x * shaft, y: from.y + d.y * shaft };
          const back = (side: number) => ({ x: to.x - d.x * head + side * n.x * head * 0.6, y: to.y - d.y * head + side * n.y * head * 0.6 });
          out.push({ kind: "polyline", role: "TRAINING", color: "COURSE", points: [from, to], width: sizes.line, ref: `section:${section.id}` });
          out.push({ kind: "polyline", role: "TRAINING", color: "COURSE", points: [back(1), to, back(-1)], width: sizes.line, ref: `section:${section.id}` });
        }
      }
    }
  }
  return out;
}
