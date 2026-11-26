"use client";

import { useId, useMemo, useRef, useState, type RefObject } from "react";
import type { MapColor, MapTextSymbolChange, TextAlign } from "@o-tid/map-file";
import { mapProjectTextEn } from "../../i18n/map-project-text-en";
import { mapProjectTextSv } from "../../i18n/map-project-text-sv";
import { toScreen, type Viewport } from "../../lib/course-setting-viewport";
import type { CatalogSymbol, TextStyle } from "../../lib/map-project-protocol";
import { duplicateTextSymbol, fontChoices, styleChange, whiteColor, withStyleChange, type TextDraft } from "../../lib/map-project-text";
import { useTexts } from "../language-provider";
import { Button, Dialog } from "../ui";
import colorStyles from "./map-project-colors.module.css";
import styles from "./map-project-text.module.css";
import type { MapProjectText } from "./use-map-project-text";

/** Minsta teckenhöjd i fältet (px), så att man ser vad man skriver när kartan är utzoomad. */
const MIN_FIELD_PX = 13;

/**
 * K8b V6: textfältet ligger vid textens ankare i kartans skala och vinkel (vänster, första radens baslinje), och följer zoom och
 * panorering (anropas när kartan ritas, som kontextraden).
 */
export function placeTextField(field: HTMLTextAreaElement | null, draft: TextDraft | undefined, style: TextStyle | undefined, view: Viewport) {
  if (!field || !draft) return;
  const at = toScreen(view, draft.at);
  const px = Math.max(MIN_FIELD_PX, (style?.size ?? 3) * view.pxPerMm);
  field.style.left = `${Math.round(at.x)}px`;
  field.style.top = `${Math.round(at.y - px)}px`;
  field.style.fontSize = `${px}px`;
  field.style.transformOrigin = `0 ${px}px`;
  field.style.transform = draft.angle ? `rotate(${-draft.angle}deg)` : "";
}

const cssFont = (name: string) => `"${name.replace(/["\\;{}]/g, "")}", ${/times|georgia|serif|roman|garamond/i.test(name) && !/sans/i.test(name) ? "serif" : "sans-serif"}`;

/** Typsnittet finns inte i webbläsaren (mäts mot de tre reservtypsnitten; utan canvas antas det finnas). */
function fontMissing(name: string): boolean {
  if (typeof document === "undefined" || !name.trim()) return false;
  const context = document.createElement("canvas").getContext?.("2d");
  if (!context) return false;
  const sample = "mmmmmmmmmmlliWWQ@#ÅÄÖ";
  return ["monospace", "serif", "sans-serif"].every(base => {
    context.font = `40px ${base}`;
    const plain = context.measureText(sample).width;
    context.font = `40px "${name.replace(/["\\;{}]/g, "")}", ${base}`;
    return context.measureText(sample).width === plain;
  });
}

function TextField({ ui, fieldRef, style }: { ui: MapProjectText; fieldRef: RefObject<HTMLTextAreaElement | null>; style: TextStyle | undefined }) {
  const text = useTexts(mapProjectTextSv, mapProjectTextEn);
  const done = useRef(false);
  const draft = ui.draft!;
  const finish = (value: string | undefined) => { if (done.current) return; done.current = true; if (value === undefined) ui.cancel(); else ui.commit(value); };
  return <textarea ref={fieldRef} className={styles.field} aria-label={text.field} title={text.fieldHelp} defaultValue={draft.value} autoFocus rows={1}
    data-testid="map-project-text-field" spellCheck={false}
    style={{ fontFamily: style ? cssFont(style.fontFamily) : undefined, fontWeight: style?.bold ? 700 : undefined, fontStyle: style?.italic ? "italic" : undefined }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); finish(undefined); }
      else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); finish(event.currentTarget.value); }
    }}
    onInput={event => { const field = event.currentTarget; field.rows = Math.max(1, field.value.split("\n").length); }}
    onBlur={event => finish(event.currentTarget.value)} />;
}

/**
 * «Ändra textsymbol»: typsnitt (kartans egna och de vanliga, fritt fält), storlek i mm, färg ur kartans färger, fet, kursiv,
 * justering och kontur. Valen ritar om kartan direkt; Spara lägger dem i projektet (ångringsbart), Avbryt visar det sparade.
 * «Duplicera som ny textsymbol» sparar en kopia med nästa lediga nummer och väljer den.
 */
function TextSymbolDialog({ symbol, ui, colors, catalog, fileIds, chooseSymbol, onClose }: {
  symbol: CatalogSymbol; ui: MapProjectText; colors: readonly MapColor[]; catalog: readonly CatalogSymbol[]; fileIds: readonly string[];
  chooseSymbol: (id: string) => void; onClose: () => void;
}) {
  const text = useTexts(mapProjectTextSv, mapProjectTextEn);
  const title = useId(), fonts = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const { styles: control } = ui;
  const initial = symbol.text!;
  const [style, setStyle] = useState<TextStyle>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const choices = useMemo(() => fontChoices(catalog), [catalog]);
  const missing = useMemo(() => fontMissing(style.fontFamily), [style.fontFamily]);
  const dirty = JSON.stringify(style) !== JSON.stringify(initial);
  const rows = [...colors].sort((a, b) => a.rank - b.rank);
  const disabled = !control.canChange || busy;
  const preview = (next: readonly MapTextSymbolChange[]) => control.show(next);
  const change = (edit: Partial<TextStyle>) => {
    const next = { ...style, ...edit };
    setStyle(next); setMessage(undefined);
    if (next.fontFamily.trim() && next.size >= 0.1) preview(withStyleChange(control.saved, styleChange(symbol.id, next, control.saved)));
  };
  const close = () => { if (dirty) preview(control.saved); onClose(); };
  const run = (next: readonly MapTextSymbolChange[], after: () => void) => {
    setBusy(true);
    void control.save(next).then(ok => { setBusy(false); if (ok) after(); else setMessage(text.failed); });
  };
  const colorSelect = (value: number, onPick: (id: number) => void, label: string, testId: string) =>
    <select value={value} disabled={disabled} aria-label={label} data-testid={testId} onChange={event => onPick(Number(event.target.value))}>
      {rows.map(color => <option key={color.id} value={color.id}>{color.name || String(color.id)}</option>)}
    </select>;

  return <Dialog dialogRef={dialog} className={colorStyles.dialog} labelledBy={title} onClose={close} closeOnBackdrop={!dirty}>
    <div className={colorStyles.body} data-testid="map-project-text-symbol">
      <h2 id={title}>{text.title(symbol.code, symbol.name)}</h2>
      <p className={colorStyles.help}>{control.canChange ? text.help : text.readOnly}</p>
      <div className={styles.grid}>
        <label>{text.font}<input list={fonts} value={style.fontFamily} disabled={disabled} maxLength={80} data-testid="map-project-text-font"
          onChange={event => change({ fontFamily: event.target.value })} /></label>
        <datalist id={fonts}>{choices.map(font => <option key={font} value={font} />)}</datalist>
        {missing && <p className={styles.note} data-testid="map-project-text-fallback">{text.fallback}</p>}
        <label>{text.size}<input type="number" min={0.1} max={100} step={0.1} value={style.size} disabled={disabled} data-testid="map-project-text-size"
          onChange={event => change({ size: Number(event.target.value) })} /></label>
        <label>{text.color}{colorSelect(style.color, color => change({ color }), text.color, "map-project-text-color")}</label>
        <span className={styles.row}>
          <label><input type="checkbox" checked={style.bold} disabled={disabled} onChange={event => change({ bold: event.target.checked })} /> {text.bold}</label>
          <label><input type="checkbox" checked={style.italic} disabled={disabled} onChange={event => change({ italic: event.target.checked })} /> {text.italic}</label>
        </span>
        <label>{text.align}<select value={style.align ?? "left"} disabled={disabled} data-testid="map-project-text-align"
          onChange={event => change({ align: event.target.value as TextAlign })}>
          {(["left", "center", "right"] as const).map(align => <option key={align} value={align}>{text.aligns[align]}</option>)}
        </select></label>
        <label className={styles.row}><input type="checkbox" checked={!!style.framing} disabled={disabled} data-testid="map-project-text-framing"
          onChange={event => change({ framing: event.target.checked ? { color: whiteColor(colors) ?? rows[0]?.id ?? 0, width: 0.3 } : undefined })} /> {text.framing}</label>
        {style.framing && <>
          <label>{text.framingColor}{colorSelect(style.framing.color, color => change({ framing: { ...style.framing!, color } }), text.framingColor, "map-project-text-framing-color")}</label>
          <label>{text.framingWidth}<input type="number" min={0.05} max={10} step={0.05} value={style.framing.width} disabled={disabled}
            onChange={event => change({ framing: { ...style.framing!, width: Number(event.target.value) } })} /></label>
        </>}
      </div>
      <p className={styles.sample} style={{ fontFamily: cssFont(style.fontFamily), fontWeight: style.bold ? 700 : 400, fontStyle: style.italic ? "italic" : "normal",
        textAlign: style.align ?? "left" }}>{text.sample}</p>
      <p className={colorStyles.message} role="status" data-testid="map-project-text-symbol-message">{message}</p>
      <div className={colorStyles.actions}>
        {control.canChange && <Button variant="secondary" disabled={busy} data-testid="map-project-text-duplicate" onClick={() => {
          const copy = duplicateTextSymbol(symbol, style, control.saved, catalog, fileIds, text.copyName);
          run(withStyleChange(control.saved, copy), () => { chooseSymbol(copy.id); onClose(); });
        }}>{text.duplicate}</Button>}
        <span className={colorStyles.spacer} />
        <Button variant="secondary" onClick={() => dialog.current?.close()}>{dirty ? text.cancel : text.close}</Button>
        {control.canChange && <Button disabled={busy || !dirty || !style.fontFamily.trim() || !(style.size >= 0.1)} data-testid="map-project-text-symbol-save"
          onClick={() => run(withStyleChange(control.saved, styleChange(symbol.id, style, control.saved)), () => { setMessage(text.saved); onClose(); })}>{text.save}</Button>}
      </div>
    </div>
  </Dialog>;
}

/** Textfältet på kartan och dialogen Ändra textsymbol (K8b V6). */
export function MapProjectTextLayer({ ui, fieldRef, catalog, symbols, colors, fileIds, chooseSymbol }: {
  ui: MapProjectText; fieldRef: RefObject<HTMLTextAreaElement | null>; catalog: readonly CatalogSymbol[]; symbols: ReadonlyMap<string, CatalogSymbol>;
  colors: readonly MapColor[]; fileIds: readonly string[]; chooseSymbol: (id: string) => void;
}) {
  const open = ui.styles.open ? symbols.get(ui.styles.open) : undefined;
  return <>
    {ui.draft && <TextField key={`${ui.draft.at.x}:${ui.draft.at.y}:${ui.draft.target?.key ?? ""}`} ui={ui} fieldRef={fieldRef} style={ui.draftStyle} />}
    {open?.text && <TextSymbolDialog key={open.id} symbol={open} ui={ui} colors={colors} catalog={catalog} fileIds={fileIds} chooseSymbol={chooseSymbol}
      onClose={() => ui.styles.setOpen(undefined)} />}
  </>;
}
