"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { acceptSuggestion, type CourseSettingDocument, type CourseSettingEdit, type DescriptionSuggestion } from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { courseSettingSuggestSv as text } from "../../i18n/course-setting-suggest-sv";
import type { SymbolLookup } from "../../lib/course-setting-description-draw";
import { sameBoxes } from "../../lib/course-setting-description-picker";
import type { MapRenderSession, SuggestPoint, SuggestionsByControl } from "../../lib/course-setting-map-protocol";
import {
  acceptEdit, currentSuggestions, highlightShapes, optionsFor, shortText, SUGGEST_DELAY_MS, suggestKey, suggestTargets
} from "../../lib/course-setting-suggest";
import { Button } from "../ui";
import { SymbolIcon } from "./course-setting-description-picker";
import css from "./course-setting-suggest.module.css";

export interface SuggestionsState {
  /** Förslagen per kontroll (bara för kontroller som inte flyttats sedan de räknades). */
  readonly byControl: SuggestionsByControl;
  /** Workern räknar för den senaste ändringen. */
  readonly pending: boolean;
  /** Kartfilen är inläst (annars finns inga förslag). */
  readonly available: boolean;
}

/**
 * ADR-0180 beslut 13: förslagen för vald kontroll och vyns kontroller utan detalj, räknade av kartans Worker en kort
 * stund efter senaste ändringen. Förslagen skrivs aldrig in av sig själva.
 */
export function useDescriptionSuggestions(session: MapRenderSession | undefined, document: CourseSettingDocument, view: string,
  variant: string | undefined, selected: string | undefined): SuggestionsState {
  const options = useMemo(() => optionsFor(document), [document.event]);
  const points = useMemo(() => suggestTargets(document, view, variant, selected), [document, view, variant, selected]);
  const key = suggestKey(points, options);
  const latest = useRef({ points, options });
  latest.current = { points, options };
  const [result, setResult] = useState<{ key: string; points: readonly SuggestPoint[]; suggestions: SuggestionsByControl }>();
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => {
      const current = latest.current;
      if (current.points.length === 0) { setResult({ key, points: [], suggestions: {} }); return; }
      session.suggest(current.points, current.options, suggestions => setResult({ key, points: current.points, suggestions }));
    }, result === undefined ? 0 : SUGGEST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [session, key]);
  const byControl = useMemo(() => currentSuggestions(result, document), [result, document]);
  return { byControl, pending: session !== undefined && result?.key !== key, available: session !== undefined };
}

/** Förslaget som en rad i beskrivningen: rutorna C–H med riktiga symboler (tomma rutor tomma). */
export function SuggestionCells({ suggestion, symbols, size = 34 }: { suggestion: DescriptionSuggestion; symbols: SymbolLookup; size?: number }) {
  return <span className={css.cells} aria-hidden="true">
    {["C", "D", "E", "F", "G", "H"].map(box => {
      const ref = suggestion.boxes.find(row => row.box === box)?.ref;
      const symbol = ref ? symbols.get(ref) : undefined;
      return <span key={box} className={css.cell} data-box={box} data-symbol={ref}>{symbol && <SymbolIcon symbol={symbol} size={size - 6} />}</span>;
    })}
  </span>;
}

/**
 * Förslaget för vald kontroll i beskrivningspanelen: symbolerna, säkerheten och förklaringen, "Godta", "Godta alla tomma"
 * och de andra tolkningarna som rader att klicka på. Pekaren över ett förslag markerar objektet på kartan (`onHover`).
 */
export function SuggestionPanel({ document, control, label, state, symbols, readOnly, emptyEdits, onEdits, onHover }: {
  document: CourseSettingDocument; control: string; label: string; state: SuggestionsState; symbols: SymbolLookup; readOnly: boolean;
  emptyEdits: readonly CourseSettingEdit[]; onEdits: (edits: readonly CourseSettingEdit[]) => void;
  onHover: (shapes: readonly (readonly Point[])[] | undefined) => void;
}) {
  const list = state.byControl[control];
  useEffect(() => () => onHover(undefined), [control]);
  if (!state.available) return <p className={css.reason} data-testid="description-suggestion-none">{text.noMap}</p>;
  if (!list) return state.pending ? <p role="status" className={css.reason}>{text.computing}</p> : null;
  const [best, ...others] = list;
  const accept = (suggestion: DescriptionSuggestion) => {
    const edit = acceptEdit(document, control, suggestion);
    onHover(undefined);
    if (edit) onEdits([edit]);
  };
  const hover = (suggestion: DescriptionSuggestion | undefined) => onHover(suggestion ? highlightShapes(suggestion) : undefined);
  if (!best) return <p className={css.reason} data-testid="description-suggestion-none">{text.none}</p>;
  const percent = Math.round(best.confidence * 100);
  return <section className={css.box} aria-label={text.heading(label)} data-testid="description-suggestion"
    onMouseLeave={() => hover(undefined)}>
    <div className={css.head}>
      <strong>{text.heading(label)}</strong>
      <span className={css.level} data-level={best.level} data-testid="description-suggestion-level">{text.confidence(text.level[best.level] ?? "", percent)}</span>
    </div>
    <div onMouseEnter={() => hover(best)} onFocus={() => hover(best)} data-testid="description-suggestion-best">
      <SuggestionCells suggestion={best} symbols={symbols} />
    </div>
    <p className={css.reason} data-testid="description-suggestion-reason">{best.reason}</p>
    {!readOnly && <div className={css.actions}>
      <Button onClick={() => accept(best)} onMouseEnter={() => hover(best)} data-testid="description-suggestion-accept">{text.accept}</Button>
      {emptyEdits.length > 0 && <Button variant="secondary" title={text.acceptEmptyHelp} onClick={() => { onHover(undefined); onEdits(emptyEdits); }}
        data-testid="description-suggestion-accept-empty">{text.acceptEmpty(emptyEdits.length)}</Button>}
    </div>}
    {others.length > 0 && <>
      <p className={css.reason}><strong>{text.alternatives}</strong></p>
      <ul className={css.alternatives}>
        {others.map(suggestion => <li key={suggestion.boxes.map(box => `${box.box}${box.ref}`).join("")}>
          <button type="button" className={css.alternative} disabled={readOnly} data-testid="description-suggestion-alternative"
            aria-label={text.alternative(shortText(suggestion, symbols), suggestion.reason)} title={suggestion.reason}
            onMouseEnter={() => hover(suggestion)} onFocus={() => hover(suggestion)} onClick={() => accept(suggestion)}>
            <SuggestionCells suggestion={suggestion} symbols={symbols} size={24} />
            <span>{shortText(suggestion, symbols)} · {Math.round(suggestion.confidence * 100)} %</span>
          </button>
        </li>)}
      </ul>
    </>}
    <p className="visually-hidden">{text.hover}</p>
  </section>;
}

/** Fältläget i mobilen: en kort rad "Förslag: sten, norra sidan — Godta" för vald kontroll. */
export function FieldSuggestionLine({ document, control, state, symbols, onEdits }: {
  document: CourseSettingDocument; control: string | undefined; state: SuggestionsState; symbols: SymbolLookup;
  onEdits: (edits: readonly CourseSettingEdit[]) => void;
}) {
  const best = control ? state.byControl[control]?.[0] : undefined;
  const point = control ? document.controls[control] : undefined;
  // Står förslaget redan i beskrivningen behövs ingen rad.
  if (!control || !best || !point || sameBoxes(acceptSuggestion(point.descriptions, best), point.descriptions)) return null;
  const summary = shortText(best, symbols);
  return <p className={css.field} data-testid="course-setting-field-suggestion">
    <span>{text.field(summary)}</span>
    <Button variant="secondary" onClick={() => { const edit = acceptEdit(document, control, best); if (edit) onEdits([edit]); }}
      data-testid="course-setting-field-suggestion-accept">{text.accept}</Button>
  </p>;
}

