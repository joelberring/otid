"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { CourseSettingNoteTarget } from "@o-tid/contracts";
import { applyEdit, type CourseSettingDocument } from "@o-tid/course-setting";
import type { MapGeoreference, Point } from "@o-tid/map-file";
import { courseSettingFieldSv as text } from "../../i18n/course-setting-field-sv";
import { offlineSv as copy } from "../../i18n/course-setting-offline-sv";
import { applySteps, undo, type EditorState } from "../../lib/course-setting-editor";
import type { SyncStatus } from "../../lib/course-setting-sync";
import { withFieldDescription } from "../../lib/course-setting-field";
import {
  averagePositions, compassHeading, insideBounds, metersPerMm, POOR_ACCURACY_M, stepPoint, toMapPosition, type MapPosition, type PositionFix,
  type StepDirection
} from "../../lib/course-setting-geo";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import type { Inspection } from "../../lib/course-setting-inspections";
import type { Bounds } from "../../lib/course-setting-viewport";
import { DetailsSheet, NoteHereSheet, type Photo } from "./course-setting-field-sheets";
import { photoFromFile } from "./course-setting-notes";
import css from "./course-setting-field.module.css";

/**
 * Fältläget (ADR-0181 beslut 6–7): min position på kartan, "Flytta hit" (medelvärdet under 5 s), finjustering 1 m per
 * tryck och, på smal skärm, kartan på hela skärmen med stora knappar och kolumn F och G.
 *
 * Steg 67: "Kollad" för vald kontroll, "Notis här" (kameran öppnas direkt, notisen fästs vid vald kontroll eller din
 * position), kompassens kon på positionen, "Följ" som släpper när kartan dras, noggrannheten med varning över 15 m, och
 * knapparna till listan över kollade kontroller och "Utan nät". Den som bara läser och kommenterar får kolla och skriva
 * notiser men inte flytta.
 */

type Mode = "off" | "on" | "follow";
type Note = { readonly tone: "ok" | "error" | "warning"; readonly text: string };

const NARROW = "(max-width: 699px)";
function subscribeNarrow(callback: () => void) {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
/** Smal skärm (under 700 px). På servern och första gången: bred. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);
}

function geolocationError(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) return text.denied;
  if (error.code === error.TIMEOUT) return text.timeout;
  return text.unavailable;
}

const labelOf = (document: CourseSettingDocument, control: string | undefined): string | undefined => {
  const found = control ? document.controls[control] : undefined;
  if (!found) return undefined;
  if (found.kind === "NORMAL") return text.control(found.code ?? "?");
  return found.kind === "START" ? text.start : found.kind === "FINISH" ? text.finish : text.crossing;
};

type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };
const screenAngle = () => (typeof screen !== "undefined" && screen.orientation ? screen.orientation.angle : 0);

/** Kompassen medan positionen visas (iOS frågar om lov vid trycket på Min position). Uppdateras högst en gång per bildruta. */
function useCompass(enabled: boolean): number | undefined {
  const [heading, setHeading] = useState<number>();
  useEffect(() => {
    if (!enabled) { setHeading(undefined); return; }
    let frame = 0, next: number | undefined, absoluteSeen = false;
    const read = (event: DeviceOrientationEvent, absoluteEvent: boolean) => {
      if (absoluteEvent) absoluteSeen = true;
      else if (absoluteSeen) return;
      const value = compassHeading({ webkitCompassHeading: (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading,
        absolute: absoluteEvent || event.absolute, alpha: event.alpha }, screenAngle());
      if (value === undefined) return;
      next = value;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; setHeading(next); });
    };
    const absolute = (event: Event) => read(event as DeviceOrientationEvent, true);
    const relative = (event: Event) => read(event as DeviceOrientationEvent, false);
    window.addEventListener("deviceorientationabsolute", absolute);
    window.addEventListener("deviceorientation", relative);
    return () => {
      window.removeEventListener("deviceorientationabsolute", absolute);
      window.removeEventListener("deviceorientation", relative);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return heading;
}

export interface FieldInput {
  readonly raceId: string;
  readonly state: EditorState;
  readonly apply: (next: (current: EditorState) => EditorState) => void;
  /** Kartfilens georeferens: `undefined` medan kartan läses, `null` om filen saknar georeferens. */
  readonly georeference: MapGeoreference | null | undefined;
  readonly mapBounds: Bounds | undefined;
  readonly status: SyncStatus;
  readonly statusText: string;
  /** Utan nät (steg 67): statusen visas som det. */
  readonly offline: boolean;
  /** Läsa och kommentera: inga flyttar eller uppgifter, men kollad och notiser. */
  readonly readOnly: boolean;
  /** Byt bana/variant (smal skärm har ingen banlista). */
  readonly onView?: ((view: string, variant?: string) => void) | undefined;
  /** Varianterna per bana (koder), för väljaren. */
  readonly variants?: Readonly<Record<string, readonly string[]>> | undefined;
  /** Steg 67: vald kontrolls bock och om kontrollen finns på servern (en ny osparad kontroll kan inte bockas än). */
  readonly inspection: Inspection | undefined;
  readonly saved: (control: string) => boolean;
  readonly onInspect: (control: string, checked: boolean, position: Point | null) => void;
  readonly onNote: (input: { target: CourseSettingNoteTarget; at: Point | null; text: string; photo: Photo | null }) => Promise<void>;
  readonly onList: () => void;
  readonly onOffline: () => void;
  /** ADR-0180 beslut 12: raden "Förslag: sten, norra sidan — Godta" för vald kontroll. */
  readonly suggestion?: ReactNode | undefined;
}

export interface FieldMode {
  readonly narrow: boolean;
  /** Till kartan: positionen, om kartan följer den och kompassens riktning. */
  readonly position: { readonly position: MapPosition; readonly follow: boolean; readonly heading?: number | undefined } | undefined;
  /** Kartan drogs: "Följ" släpper. */
  readonly onPan: () => void;
  /** Knapparna på kartan (bred skärm). */
  readonly tools: ReactNode;
  /** Raden nertill (smal skärm). */
  readonly bar: ReactNode;
  /**
   * Smal skärm: "Mer" är öppnat (verktygen, flikarna och de mindre vanliga knapparna syns). Annars är raden så liten som
   * möjligt så att kartan får plats (ägaren 2026-11-01: "måste kunna se kartan … oftast vill man bara justera och
   * lägga in info om kontrollpunkten").
   */
  readonly expanded: boolean;
}

export function useFieldMode(input: FieldInput): FieldMode {
  const { state, apply, georeference, mapBounds, status, readOnly } = input;
  const narrow = useNarrow();
  const document = state.document;
  const selected = state.selection?.kind === "control" ? state.selection.control : undefined;
  const selectedPoint = selected ? document.controls[selected] : undefined;
  const perMm = metersPerMm(georeference, document.event.mapScale);

  // Positionen: ett tryck visar den, ett andra följer den, ett tredje stänger av.
  const [mode, setMode] = useState<Mode>("off");
  const [fix, setFix] = useState<PositionFix>();
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<Note>();
  const georeferenceRef = useRef(georeference);
  georeferenceRef.current = georeference;
  const collector = useRef<MapPosition[] | undefined>(undefined);
  const active = mode !== "off";
  useEffect(() => {
    if (!active) { setFix(undefined); setError(undefined); return; }
    if (typeof window !== "undefined" && !window.isSecureContext) { setError(text.insecure); return; }
    if (!("geolocation" in navigator)) { setError(text.noGeolocation); return; }
    const id = navigator.geolocation.watchPosition(position => {
      const next = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyM: position.coords.accuracy };
      setFix(next);
      setError(undefined);
      const reference = georeferenceRef.current;
      if (collector.current && reference) {
        try { collector.current.push(toMapPosition(reference, next)); } catch { /* koordinatsystemet: visas nedan */ }
      }
    }, failure => setError(geolocationError(failure)), { enableHighAccuracy: true, maximumAge: 0 });
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);
  const heading = useCompass(active);

  const located = useMemo<{ position?: MapPosition; problem?: string }>(() => {
    if (!fix || !georeference) return {};
    try { return { position: toMapPosition(georeference, fix) }; } catch { return { problem: text.unsupportedCrs }; }
  }, [fix, georeference]);
  const position = located.position;
  const latest = useRef(position);
  latest.current = position;

  // Flytta hit: medelvärdet av positionerna under 5 s, avvikare kastas.
  const [measuring, setMeasuring] = useState<number>();
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  function stopMeasuring() {
    if (timer.current) clearInterval(timer.current);
    timer.current = undefined; collector.current = undefined; setMeasuring(undefined);
  }
  function moveHere() {
    if (measuring !== undefined) { stopMeasuring(); return; }
    const control = selected;
    if (!control) return;
    if (!latest.current) { setNote({ tone: "error", text: text.noFix }); return; }
    collector.current = [latest.current];
    setNote(undefined);
    let left = 5;
    setMeasuring(left);
    timer.current = setInterval(() => {
      left -= 1;
      if (left > 0) { setMeasuring(left); return; }
      const averaged = averagePositions(collector.current ?? []);
      stopMeasuring();
      if (!averaged) { setNote({ tone: "error", text: text.noFix }); return; }
      if (mapBounds && !insideBounds(averaged.at, mapBounds)) { setNote({ tone: "error", text: text.outside }); return; }
      apply(current => applySteps(current, [{ type: "MOVE_CONTROL", control, at: averaged.at }], applyEdit));
      const meters = Math.max(1, Math.round(averaged.accuracyM));
      setNote(averaged.accuracyM > POOR_ACCURACY_M ? { tone: "warning", text: copy.movedPoor(meters) } : { tone: "ok", text: text.moved(meters) });
    }, 1000);
  }

  function step(direction: StepDirection) {
    const control = selected;
    if (!control) return;
    apply(current => {
      const at = current.document.controls[control]?.at;
      return at ? applySteps(current, [{ type: "MOVE_CONTROL", control, at: stepPoint(at, direction, 1, perMm) }], applyEdit) : current;
    });
  }

  // Kollad: bara vanliga kontroller som finns på servern.
  const canInspect = selected !== undefined && selectedPoint?.kind === "NORMAL";
  const inspected = Boolean(input.inspection);
  function inspect() {
    if (!selected || !selectedPoint) return;
    if (!input.saved(selected)) { setNote({ tone: "error", text: copy.inspection.notSaved }); return; }
    input.onInspect(selected, !inspected, inspected ? null : selectedPoint.at);
    setNote(undefined);
  }

  // Notis här: vald kontroll (sparad) eller positionen. Knappen öppnar kameran direkt (samma tryck, så att webbläsaren tillåter det).
  const camera = useRef<HTMLInputElement>(null);
  const [noteTarget, setNoteTarget] = useState<{ target: CourseSettingNoteTarget; at: Point | null; label: string }>();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoMessage, setPhotoMessage] = useState<string>();
  const [savingNote, setSavingNote] = useState(false);
  const label = labelOf(document, selected);
  const noteHere = () => {
    if (selected && selectedPoint && input.saved(selected)) {
      setNoteTarget({ target: { kind: "CONTROL", control: selected }, at: selectedPoint.at, label: label ?? "" });
    } else if (latest.current) {
      setNoteTarget({ target: { kind: "POINT", at: latest.current.at }, at: latest.current.at, label: copy.noteHere.atPosition });
    } else if (selectedPoint) {
      setNoteTarget({ target: { kind: "POINT", at: selectedPoint.at }, at: selectedPoint.at, label: label ?? "" });
    } else return;
    setPhoto(null); setPhotoMessage(undefined);
    camera.current?.click();
  };
  const cameraInput = <input ref={camera} className={css.hidden} type="file" accept="image/*" capture="environment"
    data-testid="course-setting-note-camera" aria-label={copy.noteHere.takePhoto} onChange={event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setPhotoMessage(undefined);
      void photoFromFile(file).then(result => "error" in result ? setPhotoMessage(result.error) : setPhoto(result));
    }} />;
  const noteSheet = noteTarget && <NoteHereSheet target={noteTarget.label} photo={photo} photoMessage={photoMessage} busy={savingNote}
    onPhoto={() => camera.current?.click()} onClose={() => setNoteTarget(undefined)}
    onSave={value => {
      setSavingNote(true);
      void input.onNote({ target: noteTarget.target, at: noteTarget.at, text: value, photo }).then(() => {
        setNoteTarget(undefined);
        setNote({ tone: "ok", text: input.offline ? copy.noteHere.queued : copy.noteHere.saved });
      }, () => setNote({ tone: "error", text: copy.noteHere.queued })).finally(() => setSavingNote(false));
    }} />;

  const [details, setDetails] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const canMove = active && selected !== undefined && Boolean(position) && !readOnly;
  const problem = georeference === null && active ? text.noGeoreference : error ?? located.problem;
  const positionTitle = mode === "off" ? text.positionOff : mode === "on" ? text.positionOn : text.positionFollow;
  const cycle = () => {
    // iOS: kompassen kräver lov, och frågan måste komma från ett tryck. Utan lov kommer inga riktningar (ingen kon).
    if (mode === "off") {
      const orientation = (typeof DeviceOrientationEvent === "undefined" ? undefined : DeviceOrientationEvent) as OrientationPermission | undefined;
      if (typeof orientation?.requestPermission === "function") {
        orientation.requestPermission().then(answer => { if (answer !== "granted") console.info("Kompassen: inget lov", answer); },
          error => console.info("Kompassen: frågan gick inte", error));
      }
    }
    setMode(current => current === "off" ? "on" : current === "on" ? "follow" : "off");
  };
  const meters = position ? Math.max(1, Math.round(position.accuracyM)) : undefined;
  const poor = position !== undefined && position.accuracyM > POOR_ACCURACY_M;
  const info = problem ?? (active ? (meters !== undefined ? (poor ? copy.poorAccuracy(meters) : text.accuracy(meters)) : text.waiting) : undefined);

  const positionButton = <button type="button" className={css.big} aria-label={text.position} title={positionTitle}
    data-mode={mode} aria-pressed={active} onClick={cycle}>
    <span aria-hidden="true" className={css.icon}>{mode === "follow" ? "◉" : "◎"}</span>
    {narrow && mode === "follow" && <span className={css.small}>{copy.follow}</span>}
  </button>;
  const moveButton = <button type="button" className={css.big} data-testid="course-setting-move-here"
    disabled={!canMove && measuring === undefined} onClick={moveHere}>
    {measuring !== undefined ? `${text.moveHereCountdown(measuring)} · ${text.cancel}` : text.moveHere}
  </button>;
  const arrows = <div className={css.arrows} role="group" aria-label={text.stepGroup}>
    {(["W", "N", "S", "E"] as const).map(direction => <button key={direction} type="button" className={css.big} aria-label={text.step[direction]}
      title={text.step[direction]} disabled={!selected || readOnly} onClick={() => step(direction)}>
      {{ N: "↑", S: "↓", E: "→", W: "←" }[direction]}</button>)}
  </div>;
  const inspectButton = <button type="button" className={css.big} aria-pressed={inspected} disabled={!canInspect}
    data-testid="course-setting-inspect" onClick={inspect}>{inspected ? copy.inspection.checked : copy.inspection.button}</button>;
  const noteButton = <button type="button" className={css.big} disabled={!selectedPoint && !position} data-testid="course-setting-note-here-button"
    onClick={noteHere}>{copy.noteHere.button}</button>;
  const lines = <>
    {info && <p className={css.line} data-problem={problem ? "true" : undefined} data-warning={!problem && poor ? "true" : undefined}
      role={problem ? "alert" : "status"} data-testid="course-setting-position-info">{info}</p>}
    {note && <p className={css.line} data-problem={note.tone === "error" ? "true" : undefined} data-warning={note.tone === "warning" ? "true" : undefined}
      role="status" data-testid="course-setting-field-note">{note.text}</p>}
  </>;
  const inspectedLine = input.inspection && <span className={css.inspected} data-testid="course-setting-inspected-by">
    {copy.inspection.by(input.inspection.checkedBy.displayName, input.inspection.checkedAt)}
    {input.inspection.pending ? ` (${input.offline ? copy.inspection.pending : copy.inspection.sending})` : ""}</span>;

  const tools = <div className={css.tools}>
    {positionButton}
    {active && !readOnly && <>{moveButton}{selected && arrows}</>}
    {selected && <>{inspectButton}{noteButton}</>}
    {!selected && active && noteButton}
    {(info || note || inspectedLine) && <div className={css.toolLines}>{lines}{inspectedLine}</div>}
    {cameraInput}{noteSheet}
  </div>;

  // Banväljaren: på telefonen syns banan med sträckor, nummer, start och mål (hur löparna kommer in till kontrollen).
  const courses = [...document.courses].sort((a, b) => a.order - b.order);
  const variantCodes = (input.variants?.[state.view] ?? []).filter(code => code !== "");
  const picker = input.onView && <div className={css.picker}>
    <select className={css.select} aria-label={text.course} value={state.view} data-testid="course-setting-field-course"
      onChange={event => input.onView!(event.target.value)}>
      <option value={ALL_CONTROLS}>{text.allControls}</option>
      {courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}
    </select>
    {variantCodes.length > 0 && <select className={css.select} aria-label={text.variant} value={state.variant ?? ""}
      data-testid="course-setting-field-variant" onChange={event => input.onView!(state.view, event.target.value || undefined)}>
      <option value="">{text.allVariants}</option>
      {variantCodes.map(code => <option key={code} value={code}>{code}</option>)}
    </select>}
  </div>;

  const bar = <div className={css.bar} data-expanded={expanded || undefined}>
    <div className={css.barHead}>
      <strong className={css.selectedLabel} data-testid="course-setting-field-selected">{label ? text.selected(label) : text.none}</strong>
      {inspectedLine}
      <span className={css.status} data-status={status} data-offline={input.offline || undefined} role="status"
        data-testid="course-setting-field-status">{input.statusText}</span>
    </div>
    {state.error && <p className={css.line} data-problem="true" role="alert">{state.error}</p>}
    {lines}
    {selected && input.suggestion}
    <div className={css.compactRow}>
      {picker}
      {positionButton}
      {!readOnly && selected && moveButton}
      {!readOnly && selected && <button type="button" className={css.big} disabled={selectedPoint?.kind !== "NORMAL"}
        onClick={() => setDetails(true)}>{text.details}</button>}
      <button type="button" className={css.big} aria-expanded={expanded} aria-label={copy.more} title={copy.more}
        data-testid="course-setting-field-more" onClick={() => setExpanded(value => !value)}>{expanded ? "✕" : "⋯"}</button>
    </div>
    {selected && <div className={css.compactRow}>
      {!readOnly && arrows}
      {inspectButton}
      {noteButton}
    </div>}
    {expanded && <div className={css.compactRow}>
      {!selected && noteButton}
      <button type="button" className={css.big} onClick={input.onList}>{copy.list}</button>
      <button type="button" className={css.big} onClick={input.onOffline}>{copy.offlineButton}</button>
      {!readOnly && <button type="button" className={css.big} disabled={state.past.length === 0} onClick={() => apply(undo)}>{text.undo}</button>}
    </div>}
    {cameraInput}{noteSheet}
    {details && selected && selectedPoint?.kind === "NORMAL" && <DetailsSheet key={selected} label={label ?? ""}
      boxes={selectedPoint.descriptions} standard={document.event.descriptionStandard} onClose={() => setDetails(false)}
      onSave={(f, g) => {
        apply(current => {
          const point = current.document.controls[selected];
          return point ? applySteps(current, [{ type: "SET_DESCRIPTION", control: selected, boxes: withFieldDescription(point.descriptions, f, g) }], applyEdit) : current;
        });
        setDetails(false);
      }} />}
  </div>;

  return { narrow, position: position ? { position, follow: mode === "follow", heading } : undefined,
    onPan: () => setMode(current => current === "follow" ? "on" : current), tools, bar, expanded };
}

/**
 * Sidan under arbetsytan får inte skrolla eller studsa när man drar på kartan (iOS/Android). Samma lås som
 * `course-setting-shell` i globals.css, här också i stilen på html/body för webbläsare utan `:has()`.
 */
export function useLockedPage(): void {
  useEffect(() => {
    const html = document.documentElement, body = document.body;
    const before = { htmlOverflow: html.style.overflow, htmlOverscroll: html.style.overscrollBehavior,
      bodyOverflow: body.style.overflow, bodyOverscroll: body.style.overscrollBehavior };
    html.style.overflow = "hidden"; html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden"; body.style.overscrollBehavior = "none";
    return () => {
      html.style.overflow = before.htmlOverflow; html.style.overscrollBehavior = before.htmlOverscroll;
      body.style.overflow = before.bodyOverflow; body.style.overscrollBehavior = before.bodyOverscroll;
    };
  }, []);
}
