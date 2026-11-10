"use client";

import { effectiveColorChanges, withColorChanges, type MapColor, type MapColorChange } from "@o-tid/map-file";
import { useId, useMemo, useRef, useState } from "react";
import { mapProjectColorsSv } from "../../i18n/map-project-colors-sv";
import { mapProjectColorsEn } from "../../i18n/map-project-tools-en";
import { useTexts } from "../language-provider";
import { Button, Dialog } from "../ui";
import { RailIconImage } from "./map-project-tool-rail";
import styles from "./map-project-colors.module.css";

const PARTS = ["c", "m", "y", "k"] as const;
const css = (rgb: MapColor["rgb"]) => `rgb(${[rgb.r, rgb.g, rgb.b].map(value => Math.round(value * 255)).join(" ")})`;
const percent = (value: number) => String(Math.round(value * 1000) / 10).replace(".", ",");

/**
 * Ägaren 2026-11-10 («ställa in färger i kartan … färgtabell»): knappen under Lager och dialogen med kartans färgtabell.
 * Varje färg visas i ritordning med filens färg och den nya bredvid; CMYK ändras i procent och kartan ritas om medan man
 * ändrar (`onShow`). Spara lägger ändringarna i projektet (`onSave`); Avbryt visar det sparade igen. Dekorfärger visas men
 * ändras inte här.
 */
export function MapProjectColors({ colors, saved, canChange, ocad, onShow, onSave }: {
  /** Filens färgtabell. */
  colors: readonly MapColor[]; saved: readonly MapColorChange[]; canChange: boolean; ocad: boolean;
  onShow: (changes: readonly MapColorChange[]) => void; onSave: (changes: readonly MapColorChange[]) => Promise<boolean> }) {
  const text = useTexts(mapProjectColorsSv, mapProjectColorsEn);
  const [open, setOpen] = useState(false);
  const count = effectiveColorChanges(colors, saved).length;
  return <section className={styles.entry}>
    <Button variant="secondary" onClick={() => setOpen(true)} disabled={colors.length === 0} data-testid="map-project-colors-open">{text.open}</Button>
    <span className={styles.muted} data-testid="map-project-colors-summary">{text.summary(count)}</span>
    {open && <ColorsDialog colors={colors} saved={saved} canChange={canChange} ocad={ocad} onShow={onShow} onSave={onSave} onClose={() => setOpen(false)} />}
  </section>;
}

function ColorsDialog({ colors, saved, canChange, ocad, onShow, onSave, onClose }: {
  colors: readonly MapColor[]; saved: readonly MapColorChange[]; canChange: boolean; ocad: boolean;
  onShow: (changes: readonly MapColorChange[]) => void; onSave: (changes: readonly MapColorChange[]) => Promise<boolean>; onClose: () => void }) {
  const text = useTexts(mapProjectColorsSv, mapProjectColorsEn);
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<readonly MapColorChange[]>(() => effectiveColorChanges(colors, saved));
  // Det som står i fälten medan man skriver (t.ex. "12," på väg mot "12,5").
  const [typing, setTyping] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const shown = useMemo(() => withColorChanges(colors, draft), [colors, draft]);
  const rows = useMemo(() => [...colors].sort((a, b) => a.rank - b.rank), [colors]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(effectiveColorChanges(colors, saved));
  const apply = (next: readonly MapColorChange[]) => { const clean = effectiveColorChanges(colors, next); setDraft(clean); setMessage(undefined); onShow(clean); };
  const set = (color: MapColor, part: typeof PARTS[number], raw: string) => {
    setTyping(current => ({ ...current, [`${color.id}${part}`]: raw }));
    const value = Number(raw.trim().replace(",", "."));
    if (raw.trim() === "" || !Number.isFinite(value) || value < 0 || value > 100) return;
    const current = shown.find(row => row.id === color.id)!.cmyk;
    apply([...draft.filter(row => row.id !== color.id), { id: color.id, cmyk: { ...current, [part]: value / 100 } }]);
  };
  const close = () => { if (dirty) onShow(effectiveColorChanges(colors, saved)); onClose(); };

  return <Dialog dialogRef={dialog} className={styles.dialog} labelledBy={title} onClose={close} closeOnBackdrop={!dirty}>
    <div className={styles.body} data-testid="map-project-colors">
      <h2 id={title}>{text.title}</h2>
      <p className={styles.help}>{canChange ? text.help : text.readOnly}</p>
      {ocad && <p className={styles.help}>{text.ocad}</p>}
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead><tr><th scope="col" colSpan={2}>{text.color}</th>{PARTS.map(part => <th key={part} scope="col">{text[part]}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map(color => {
              const now = shown.find(row => row.id === color.id)!, changed = draft.some(row => row.id === color.id), name = color.name || String(color.id);
              return <tr key={color.id} data-changed={changed || undefined} data-testid="map-project-color" data-color={color.id}>
                <td><span className={styles.swatch} style={{ background: css(color.rgb) }} />{changed && <span className={styles.swatch} style={{ background: css(now.rgb) }}
                  data-testid="map-project-color-new" />}</td>
                <th scope="row">{name}{color.spot && <small>{text.spot}</small>}{changed && <small>{text.changed}</small>}</th>
                {PARTS.map(part => <td key={part}><input inputMode="decimal" aria-label={text.field(name, text[part])} disabled={!canChange || !!color.spot || busy}
                  value={typing[`${color.id}${part}`] ?? percent(now.cmyk[part])} onChange={event => set(color, part, event.target.value)}
                  onBlur={() => setTyping(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== `${color.id}${part}`)))} /></td>)}
                <td>{changed && canChange && <button type="button" className={styles.reset} aria-label={text.reset(name)} title={text.reset(name)} disabled={busy}
                  onClick={() => { setTyping({}); apply(draft.filter(row => row.id !== color.id)); }}><RailIconImage icon="undo" size={16} /></button>}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.message} role="status" data-testid="map-project-colors-message">{message}</p>
      <div className={styles.actions}>
        {canChange && <Button variant="secondary" disabled={busy || draft.length === 0} onClick={() => { setTyping({}); apply([]); }}
          data-testid="map-project-colors-reset">{text.resetAll}</Button>}
        <span className={styles.spacer} />
        <Button variant="secondary" onClick={() => dialog.current?.close()}>{dirty ? text.cancel : text.close}</Button>
        {canChange && <Button disabled={busy || !dirty} data-testid="map-project-colors-save" onClick={() => {
          setBusy(true);
          void onSave(draft).then(ok => { setBusy(false); setMessage(ok ? text.saved(draft.length) : text.failed); });
        }}>{text.save}</Button>}
      </div>
    </div>
  </Dialog>;
}
