"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { applyEdit, type CourseSettingDocument } from "@o-tid/course-setting";
import type { MapGeoreference } from "@o-tid/map-file";
import { courseSettingFieldSv as text } from "../../i18n/course-setting-field-sv";
import type { AutosaveStatus } from "../../lib/course-setting-autosave";
import { applySteps, replaceDocument, undo, type EditorState } from "../../lib/course-setting-editor";
import {
  clearBackup, F_QUICK, G_CHOICES, gChoiceOf, gSymbolId, localStore, readBackup, withFieldDescription, writeBackup, type UnsavedBackup
} from "../../lib/course-setting-field";
import {
  averagePositions, insideBounds, metersPerMm, stepPoint, toMapPosition, type MapPosition, type PositionFix, type StepDirection
} from "../../lib/course-setting-geo";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import type { Bounds } from "../../lib/course-setting-viewport";
import { Button } from "../ui";
import css from "./course-setting-field.module.css";

/**
 * Fältläget, första versionen (ADR-0181 beslut 6–7; hela fältläget är steg 67): min position på kartan, "Flytta hit"
 * (medelvärdet under 5 s), finjustering 1 m per tryck och, på smal skärm, kartan på hela skärmen med stora knappar och
 * kolumn F och G. Osparade ändringar ligger kvar i webbläsaren tills servern har sparat dem.
 */

type Mode = "off" | "on" | "follow";
type Note = { readonly tone: "ok" | "error"; readonly text: string };

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

export interface FieldInput {
  readonly raceId: string;
  readonly state: EditorState;
  readonly apply: (next: (current: EditorState) => EditorState) => void;
  /** Kartfilens georeferens: `undefined` medan kartan läses, `null` om filen saknar georeferens. */
  readonly georeference: MapGeoreference | null | undefined;
  readonly mapBounds: Bounds | undefined;
  readonly status: AutosaveStatus;
  readonly statusText: string;
  /** Versionen som nästa sparande bygger på. */
  readonly version: () => number;
  /** Byt bana/variant (smal skärm har ingen banlista). */
  readonly onView?: ((view: string, variant?: string) => void) | undefined;
  /** Varianterna per bana (koder), för väljaren. */
  readonly variants?: Readonly<Record<string, readonly string[]>> | undefined;
}

export interface FieldMode {
  readonly narrow: boolean;
  /** Till kartan: positionen och om kartan följer den. */
  readonly position: { readonly position: MapPosition; readonly follow: boolean } | undefined;
  /** Knapparna på kartan (bred skärm). */
  readonly tools: ReactNode;
  /** Raden nertill (smal skärm). */
  readonly bar: ReactNode;
  /** Erbjudandet att återställa osparade ändringar. */
  readonly notice: ReactNode;
}

export function useFieldMode(input: FieldInput): FieldMode {
  const { raceId, state, apply, georeference, mapBounds, status } = input;
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
      setNote({ tone: "ok", text: text.moved(Math.max(1, Math.round(averaged.accuracyM))) });
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

  // Osparade ändringar i webbläsaren: kopian skrivs vid varje ändring och tas bort när servern har sparat.
  const [offer, setOffer] = useState<UnsavedBackup | undefined>(() => readBackup(localStore(), raceId));
  const wrote = useRef(false);
  const versionRef = useRef(input.version);
  versionRef.current = input.version;
  useEffect(() => {
    if (state.revision === 0) return;
    if (status === "pending" || status === "saving" || status === "failed") {
      wrote.current = writeBackup(localStore(), raceId, { baseVersion: versionRef.current(), savedAt: new Date().toISOString(), document });
      setOffer(undefined);
    } else if (status === "saved" && wrote.current) {
      clearBackup(localStore(), raceId);
      wrote.current = false;
    }
  }, [document, status, state.revision, raceId]);
  const restoreOffer = useMemo(() => offer && JSON.stringify(offer.document) !== JSON.stringify(document) ? offer : undefined, [offer, document]);
  const notice = restoreOffer ? <div className={css.notice} role="alert">
    <p>{text.restore.offer(new Date(restoreOffer.savedAt).toLocaleString("sv-SE", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }))}
      {restoreOffer.baseVersion !== input.version() && ` ${text.restore.newer}`}</p>
    <div className={css.row}>
      <Button onClick={() => { setOffer(undefined); apply(current => replaceDocument(current, restoreOffer.document)); }}>{text.restore.apply}</Button>
      <Button variant="secondary" onClick={() => { setOffer(undefined); clearBackup(localStore(), raceId); }}>{text.restore.discard}</Button>
    </div>
  </div> : null;

  const [details, setDetails] = useState(false);
  const label = labelOf(document, selected);
  const canMove = active && selected !== undefined && Boolean(position);
  const problem = georeference === null && active ? text.noGeoreference : error ?? located.problem;
  const positionTitle = mode === "off" ? text.positionOff : mode === "on" ? text.positionOn : text.positionFollow;
  const cycle = () => setMode(current => current === "off" ? "on" : current === "on" ? "follow" : "off");
  const info = problem ?? (active ? (position ? text.accuracy(Math.max(1, Math.round(position.accuracyM))) : text.waiting) : undefined);

  const positionButton = <button type="button" className={css.big} aria-label={text.position} title={positionTitle}
    data-mode={mode} aria-pressed={active} onClick={cycle}>
    <span aria-hidden="true" className={css.icon}>{mode === "follow" ? "◉" : "◎"}</span>
    {narrow && <span className={css.small}>{mode === "follow" ? "Följer" : active ? "Visas" : "Position"}</span>}
  </button>;
  const moveButton = <button type="button" className={css.big} data-testid="course-setting-move-here"
    disabled={!canMove && measuring === undefined} onClick={moveHere}>
    {measuring !== undefined ? `${text.moveHereCountdown(measuring)} · ${text.cancel}` : text.moveHere}
  </button>;
  const arrows = <div className={css.arrows} role="group" aria-label={text.stepGroup}>
    {(["W", "N", "S", "E"] as const).map(direction => <button key={direction} type="button" className={css.big} aria-label={text.step[direction]}
      title={text.step[direction]} disabled={!selected} onClick={() => step(direction)}>
      {{ N: "↑", S: "↓", E: "→", W: "←" }[direction]}</button>)}
  </div>;
  const lines = <>
    {info && <p className={css.line} data-problem={problem ? "true" : undefined} role={problem ? "alert" : "status"}>{info}</p>}
    {note && <p className={css.line} data-problem={note.tone === "error" ? "true" : undefined} role="status" data-testid="course-setting-field-note">{note.text}</p>}
  </>;

  const tools = <div className={css.tools}>
    {positionButton}
    {active && <>{moveButton}{selected && arrows}</>}
    {(info || note) && <div className={css.toolLines}>{lines}</div>}
  </div>;

  // Banväljaren: på telefonen syns banan med sträckor, nummer, start och mål (hur löparna kommer in till kontrollen).
  const courses = [...document.courses].sort((a, b) => a.order - b.order);
  const variantCodes = (input.variants?.[state.view] ?? []).filter(code => code !== "");
  const picker = input.onView && <div className={css.barRow}>
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

  const bar = <div className={css.bar}>
    {picker}
    <div className={css.barHead}>
      <strong data-testid="course-setting-field-selected">{label ? text.selected(label) : text.none}</strong>
      <span className={css.status} data-status={status} role="status" data-testid="course-setting-field-status">{input.statusText}</span>
    </div>
    {notice}
    {state.error && <p className={css.line} data-problem="true" role="alert">{state.error}</p>}
    {lines}
    <div className={css.barRow}>
      {positionButton}
      {moveButton}
      <button type="button" className={css.big} disabled={selectedPoint?.kind !== "NORMAL"} onClick={() => setDetails(true)}>{text.details}</button>
    </div>
    <div className={css.barRow}>
      {arrows}
      <button type="button" className={css.big} disabled={state.past.length === 0} onClick={() => apply(undo)}>{text.undo}</button>
    </div>
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

  // Smal skärm: erbjudandet står i raden nertill (resten av sidan ligger under kartan).
  return { narrow, position: position ? { position, follow: mode === "follow" } : undefined, tools, bar, notice: narrow ? null : notice };
}

/** Bladet "Uppgifter": kolumn F (höjd) och G (läge) med stora knappar. */
function DetailsSheet({ label, boxes, standard, onSave, onClose }: {
  label: string; boxes: CourseSettingDocument["controls"][string]["descriptions"]; standard: CourseSettingDocument["event"]["descriptionStandard"];
  onSave: (f: string, g: string | null) => void; onClose: () => void;
}) {
  const [f, setF] = useState(boxes.find(box => box.box === "F")?.text ?? "");
  const currentG = boxes.find(box => box.box === "G")?.ref;
  const [g, setG] = useState<string | null>(currentG ?? null);
  const unknownG = currentG && !gChoiceOf(currentG) && g === currentG;
  return <div className={css.sheet} role="dialog" aria-modal="true" aria-label={text.detailsTitle(label)}>
    <h2>{text.detailsTitle(label)}</h2>
    <label className={css.field}>{text.f}
      <input type="text" inputMode="decimal" value={f} onChange={event => setF(event.target.value)} />
    </label>
    <div className={css.grid} role="group" aria-label={text.fQuick}>
      {F_QUICK.map(value => <button key={value} type="button" className={css.big} aria-pressed={f === value} onClick={() => setF(value)}>{value}</button>)}
    </div>
    <fieldset className={css.fieldset}>
      <legend>{text.g}{unknownG ? ` (${currentG})` : ""}</legend>
      <div className={css.grid}>
        {G_CHOICES.map(row => {
          const ref = gSymbolId(row.choice, standard);
          return <button key={row.choice} type="button" className={css.big} disabled={!ref} aria-pressed={g === ref}
            onClick={() => setG(ref ?? null)}>{row.label}</button>;
        })}
        <button type="button" className={css.big} aria-pressed={g === null} onClick={() => setG(null)}>{text.gNone}</button>
      </div>
    </fieldset>
    <div className={css.barRow}>
      <button type="button" className={css.big} data-primary="true" onClick={() => onSave(f, g)}>{text.save}</button>
      <button type="button" className={css.big} onClick={onClose}>{text.close}</button>
    </div>
  </div>;
}

/** Smal skärm: kartan på hela skärmen och raden nertill. Bred skärm: som vanligt. */
export function FieldShell({ narrow, bar, children }: { narrow: boolean; bar: ReactNode; children: ReactNode }) {
  // Sidan under får inte skrolla eller studsa när man drar på kartan (iOS/Android).
  useEffect(() => {
    if (!narrow) return;
    const html = document.documentElement, body = document.body;
    const before = { htmlOverflow: html.style.overflow, htmlOverscroll: html.style.overscrollBehavior,
      bodyOverflow: body.style.overflow, bodyOverscroll: body.style.overscrollBehavior };
    html.style.overflow = "hidden"; html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden"; body.style.overscrollBehavior = "none";
    return () => {
      html.style.overflow = before.htmlOverflow; html.style.overscrollBehavior = before.htmlOverscroll;
      body.style.overflow = before.bodyOverflow; body.style.overscrollBehavior = before.bodyOverscroll;
    };
  }, [narrow]);
  if (!narrow) return <>{children}</>;
  return <div className={css.shell} data-testid="course-setting-field">
    <div className={css.shellMap}>{children}</div>
    {bar}
  </div>;
}
