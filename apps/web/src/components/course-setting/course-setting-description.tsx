"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  descriptionSymbols, layoutDescription, symbolsForBox, type CourseSettingDocument, type CourseSettingEdit, type DescriptionKind,
  type DescriptionLayout, type DescriptionStandard, type DescriptionSymbol
} from "@o-tid/course-setting";
import { courseSettingDescriptionSv as text } from "../../i18n/course-setting-description-sv";
import { courseSettingSv } from "../../i18n/course-setting-sv";
import {
  browserStorage, DESCRIPTION_KINDS, DESCRIPTION_LANGUAGES, descriptionTextLine, refOfSelection, rowArea, targetOfRef,
  type DescriptionSettings, type HitPrimitive
} from "../../lib/course-setting-description";
import { symbolLookup } from "../../lib/course-setting-description-draw";
import {
  boxValue, isPickerBox, readRecent, rememberRecent, sameBoxes, setBox, symbolBoxFor, symbolName, writeRecent
} from "../../lib/course-setting-description-picker";
import type { Selection } from "../../lib/course-setting-editor";
import { controlLabel } from "../../lib/course-setting-text";
import { Button } from "../ui";
import { DescriptionPicker, type PickedValue } from "./course-setting-description-picker";
import { DescriptionSvg } from "./description-svg";
import styles from "./course-setting.module.css";

/** Paketets uträkningar får inte fälla editorn; ett fel syns i konsolen och panelen säger att beskrivningen inte gick. */
function safely<T>(name: string, compute: () => T, fallback: T): T {
  try { return compute(); } catch (error) { console.error(`${name} misslyckades`, error); return fallback; }
}

type Picking = { readonly ref: string; readonly control: string; readonly box: string };

/**
 * Steg 63 (ADR-0180): kontrollbeskrivningen för vald bana (eller Alla kontroller) bredvid kartan. En rad väljer kontrollen
 * (och vald kontroll på kartan markerar raden); en ruta C–H öppnar väljaren. Textrader före och efter vald kontroll,
 * standard, språk och visningssätt. Ändringarna går genom editorns `applyEdit` (ångra och autosparande).
 */
export function DescriptionPanel({ document, view, variant, selection, settings, onSettings, onSelect, onEdit, onPrint }: {
  document: CourseSettingDocument; view: string; variant: string | undefined; selection: Selection | undefined;
  settings: DescriptionSettings; onSettings: (settings: DescriptionSettings) => void; onSelect: (selection: Selection) => void;
  onEdit: (edits: readonly CourseSettingEdit[]) => void; onPrint: () => void;
}) {
  const standard = document.event.descriptionStandard;
  const symbols = useMemo(() => safely("Symbolerna", () => descriptionSymbols(standard), [] as readonly DescriptionSymbol[]), [standard]);
  const lookup = useMemo(() => symbolLookup(symbols), [symbols]);
  const layout = useMemo(() => safely("Kontrollbeskrivningen", () => layoutDescription(document,
    { course: view, ...(variant ? { variant } : {}), kind: settings.kind, language: settings.language }), undefined as DescriptionLayout | undefined),
  [document, view, variant, settings.kind, settings.language]);
  const [picking, setPicking] = useState<Picking>();
  const [focusLine, setFocusLine] = useState<"before" | "after">();
  const [recent, setRecent] = useState(() => readRecent(browserStorage()));
  const pickingKind = picking ? document.controls[picking.control]?.kind : undefined;
  const boxSymbols = useMemo(() => {
    const box = picking && pickingKind ? symbolBoxFor(picking.box, pickingKind) : undefined;
    return box ? safely("Rutans symboler", () => symbolsForBox(box, standard), [] as readonly DescriptionSymbol[]) : [];
  }, [picking, pickingKind, standard]);
  const selectedControl = selection?.kind === "control" ? selection.control : undefined;
  // Ett annat val på kartan (eller en annan bana) stänger väljaren.
  useEffect(() => { setPicking(current => current && current.control === selectedControl ? current : undefined); }, [selectedControl, view]);

  const course = document.courses.find(row => row.id === view);
  const label = (control: string) => controlLabel(document, control);
  const valueName = (control: string, box: string) => {
    const value = boxValue(document.controls[control]?.descriptions ?? [], box);
    if (!value) return undefined;
    if (value.text) return value.text;
    const symbol = value.ref ? lookup.get(value.ref) : undefined;
    return symbol ? symbolName(symbol, settings.language) : value.ref;
  };
  const hitLabel = (hit: HitPrimitive) => {
    if (!document.controls[hit.ref]) return hit.ref;
    const name = label(hit.ref);
    if (hit.box === "before" || hit.box === "after") return text.textLine(name, hit.box === "before");
    if (hit.box === "all") return text.directive(name, valueName(hit.ref, "all"));
    return hit.box ? text.box(name, hit.box, valueName(hit.ref, hit.box)) : text.row(name);
  };
  const onHit = (hit: HitPrimitive) => {
    const target = targetOfRef(document, view, hit.ref, variant, selection);
    if (!target || target.kind !== "control") return;
    onSelect(target);
    setPicking(isPickerBox(hit.box) ? { ref: hit.ref, control: target.control, box: hit.box } : undefined);
    if (hit.box === "before" || hit.box === "after") setFocusLine(hit.box);
  };
  const pick = (value: PickedValue) => {
    if (!picking) return;
    const control = document.controls[picking.control];
    setPicking(undefined);
    if (!control) return;
    const boxes = setBox(control.descriptions, picking.box, value);
    if (!sameBoxes(boxes, control.descriptions)) onEdit([{ type: "SET_DESCRIPTION", control: control.id, boxes }]);
    if (value && "ref" in value) {
      const next = { ...recent, [picking.box]: rememberRecent(recent[picking.box] ?? [], value.ref) };
      setRecent(next);
      writeRecent(browserStorage(), next);
    }
  };

  const ref = refOfSelection(selection);
  const selectedPoint = selectedControl ? document.controls[selectedControl] : undefined;
  const before = descriptionTextLine(selectedPoint, "before"), after = descriptionTextLine(selectedPoint, "after");
  // Textrader som bara gäller den här banan (från Purple Pen) visas men ändras inte här.
  const onCourse = selection?.kind === "control" && selection.courseControl ? document.courseControls[selection.courseControl] : undefined;
  const courseLines = (["before", "after"] as const).flatMap(location => {
    const value = descriptionTextLine(onCourse, location);
    return value ? [text.textLines.courseOnly(location === "before", value)] : [];
  });
  return <section className={styles.panel} aria-labelledby="course-setting-description" data-testid="description-panel">
    <h2 id="course-setting-description">{text.heading}</h2>
    {!layout && <p role="alert" className={styles.muted}>{text.failed}</p>}
    {layout && <div className={styles.description}>
      <DescriptionSvg layout={layout} symbols={lookup} fluid label={text.label(course?.name ?? courseSettingSv.courses.all)}
        highlight={rowArea(layout, ref)} active={picking} onHit={onHit} hitLabel={hitLabel} testId="description-svg" />
    </div>}
    {picking && <DescriptionPicker label={label(picking.control)} box={picking.box} symbols={boxSymbols} recent={recent[picking.box] ?? []}
      current={boxValue(document.controls[picking.control]?.descriptions ?? [], picking.box)} language={settings.language}
      onPick={pick} onClose={() => setPicking(undefined)} />}
    {!picking && <p className={styles.muted}>{text.help}</p>}
    {selectedPoint && <TextLines key={`${selectedPoint.id}|${before}|${after}`} label={label(selectedPoint.id)} before={before} after={after}
      focus={focusLine} onFocused={() => setFocusLine(undefined)}
      onSave={changes => onEdit(changes.map(change => ({ type: "SET_DESCRIPTION_TEXT_LINE", control: selectedPoint.id, ...change })))} />}
    {courseLines.length > 0 && <p className={styles.muted} data-testid="description-course-lines">{courseLines.join(" ")}</p>}
    <details className={styles.settings}>
      <summary>{text.settings.heading}</summary>
      <div className={styles.row}>
        <label>{text.settings.standard}<select value={standard}
          onChange={event => onEdit([{ type: "SET_EVENT", changes: { descriptionStandard: event.target.value as DescriptionStandard } }])}>
          {(["2004", "2018"] as const).map(value => <option key={value} value={value}>{text.settings.standards[value]}</option>)}
        </select></label>
        <label>{text.settings.language}<select value={settings.language} onChange={event => onSettings({ ...settings, language: event.target.value })}>
          {DESCRIPTION_LANGUAGES.map(language => <option key={language.id} value={language.id}>{text.settings.languages[language.id] ?? language.name}</option>)}
        </select></label>
        <label>{text.settings.kind}<select value={settings.kind} onChange={event => onSettings({ ...settings, kind: event.target.value as DescriptionKind })}>
          {DESCRIPTION_KINDS.map(value => <option key={value} value={value}>{text.settings.kinds[value]}</option>)}
        </select></label>
      </div>
      <p className={styles.muted}>{text.settings.stored}</p>
    </details>
    <div className={styles.row}><Button variant="secondary" onClick={onPrint}>{text.print}</Button></div>
  </section>;
}

/** Textraderna före och efter vald kontroll. Ett tomt fält tar bort raden. */
function TextLines({ label, before, after, focus, onFocused, onSave }: {
  label: string; before: string; after: string; focus: "before" | "after" | undefined; onFocused: () => void;
  onSave: (changes: readonly { location: "before" | "after"; text: string | null }[]) => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!focus) return;
    form.current?.querySelector<HTMLInputElement>(`input[name="${focus}"]`)?.focus();
    onFocused();
  }, [focus, onFocused]);
  return <form ref={form} className={styles.textLines} aria-label={`${text.textLines.heading}: ${label}`} onSubmit={event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const changes = (["before", "after"] as const).flatMap(location => {
      const value = ((form.get(location) as string | null) ?? "").trim();
      return value === (location === "before" ? before : after) ? [] : [{ location, text: value || null }];
    });
    if (changes.length > 0) onSave(changes);
  }}>
    <label>{text.textLines.before}<input type="text" name="before" defaultValue={before} maxLength={200} /></label>
    <label>{text.textLines.after}<input type="text" name="after" defaultValue={after} maxLength={200} /></label>
    <div className={styles.row}><Button type="submit" variant="secondary">{text.textLines.save}</Button>
      <span className={styles.muted}>{text.textLines.help}</span></div>
  </form>;
}
