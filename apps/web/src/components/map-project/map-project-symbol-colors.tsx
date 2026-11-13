"use client";

import type { MapColor, MapSymbolColorChange } from "@o-tid/map-file";
import { useId, useMemo, useRef, useState } from "react";
import { mapProjectSymbolColorsSv } from "../../i18n/map-project-symbol-colors-sv";
import { mapProjectSymbolColorsEn } from "../../i18n/map-project-more-en";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { useTexts } from "../language-provider";
import { Button, Dialog } from "../ui";
import colorStyles from "./map-project-colors.module.css";
import styles from "./map-project-symbol-colors.module.css";

/** Det symbollistan behöver för att byta symbolernas färger (ägaren 2026-11-13). */
export interface SymbolColorsControl {
  /** Kartans färgtabell med projektets ändrade färger. */
  readonly colors: readonly MapColor[];
  /** De sparade färgbytena. */
  readonly saved: readonly MapSymbolColorChange[];
  readonly canChange: boolean;
  readonly ocad: boolean;
  /** Rita kartan med de här byten utan att spara. */
  readonly onShow: (changes: readonly MapSymbolColorChange[]) => void;
  readonly onSave: (changes: readonly MapSymbolColorChange[]) => Promise<boolean>;
}

const css = (rgb: MapColor["rgb"]) => `rgb(${[rgb.r, rgb.g, rgb.b].map(value => Math.round(value * 255)).join(" ")})`;
const same = (a: readonly MapSymbolColorChange[], b: readonly MapSymbolColorChange[]) => {
  const key = (list: readonly MapSymbolColorChange[]) => JSON.stringify([...list].sort((x, y) => x.symbol.localeCompare(y.symbol) || x.from - y.from));
  return key(a) === key(b);
};

/**
 * Färgen på en eller flera symboler: för varje färg symbolerna har en rullista över kartans färger och en ruta som visar
 * färgen. Flera symboler får samma byte (en färgplats = en färg som någon av symbolerna har). Valet ritar om kartan direkt;
 * Spara lägger det i projektet, Återställ tar bort byten för symbolerna, Avbryt visar det sparade igen.
 */
export function SymbolColorsDialog({ symbols, control, onClose }: { symbols: readonly CatalogSymbol[]; control: SymbolColorsControl; onClose: () => void }) {
  const text = useTexts(mapProjectSymbolColorsSv, mapProjectSymbolColorsEn);
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<readonly MapSymbolColorChange[]>(control.saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const codes = useMemo(() => new Set(symbols.map(symbol => symbol.code)), [symbols]);
  const byId = useMemo(() => new Map(control.colors.map(color => [color.id, color])), [control.colors]);
  const slots = useMemo(() => [...new Set(symbols.flatMap(symbol => symbol.colors))].map(from => ({ from, users: symbols.filter(symbol => symbol.colors.includes(from)) })), [symbols]);
  const dirty = !same(draft, control.saved);
  const label = (symbol: CatalogSymbol) => `${symbol.code} ${symbol.name}`;
  const nameOf = (id: number) => byId.get(id)?.name || String(id);
  const valueOf = (from: number, users: readonly CatalogSymbol[]) => draft.find(change => change.symbol === users[0]!.code && change.from === from)?.to ?? from;
  const apply = (next: readonly MapSymbolColorChange[]) => { setDraft(next); setMessage(undefined); control.onShow(next); };
  const choose = (from: number, users: readonly CatalogSymbol[], to: number) => {
    const rest = draft.filter(change => !(change.from === from && users.some(user => user.code === change.symbol)));
    apply(to === from ? rest : [...rest, ...users.map(user => ({ symbol: user.code, from, to }))]);
  };
  const close = () => { if (dirty) control.onShow(control.saved); onClose(); };
  const rows = [...control.colors].sort((a, b) => a.rank - b.rank);

  return <Dialog dialogRef={dialog} className={colorStyles.dialog} labelledBy={title} onClose={close} closeOnBackdrop={!dirty}>
    <div className={colorStyles.body} data-testid="map-project-symbol-colors">
      <h2 id={title}>{text.title(symbols.map(label).join(", "))}</h2>
      <p className={colorStyles.help}>{control.canChange ? text.help : text.readOnly}</p>
      {control.ocad && <p className={colorStyles.help}>{text.ocad}</p>}
      {slots.length === 0 && <p className={colorStyles.help}>{text.none}</p>}
      <ul className={styles.slots}>
        {slots.map(({ from, users }) => {
          const to = valueOf(from, users), changed = to !== from, shown = byId.get(to);
          return <li key={from} data-changed={changed || undefined} data-testid="map-project-symbol-color" data-from={from}>
            <span className={colorStyles.swatch} style={{ background: byId.get(from) ? css(byId.get(from)!.rgb) : "transparent" }} aria-hidden="true" />
            <span className={styles.slotName}>{text.slot(nameOf(from))}{symbols.length > 1 && <small>{text.usedBy(users.map(user => user.code).join(", "))}</small>}</span>
            <label className={styles.pick}>
              <span>{text.drawnWith}</span>
              <select value={to} disabled={!control.canChange || busy} data-testid="map-project-symbol-color-select"
                aria-label={`${text.slot(nameOf(from))} ${text.drawnWith}`} onChange={event => choose(from, users, Number(event.target.value))}>
                {rows.map(color => <option key={color.id} value={color.id}>{color.id === from ? text.asInFile(color.name || String(color.id)) : color.name || String(color.id)}</option>)}
              </select>
            </label>
            <span className={colorStyles.swatch} style={{ background: shown ? css(shown.rgb) : "transparent" }} title={text.now(nameOf(to))} data-testid="map-project-symbol-color-new" />
          </li>;
        })}
      </ul>
      <p className={colorStyles.message} role="status" data-testid="map-project-symbol-colors-message">{message}</p>
      <div className={colorStyles.actions}>
        {control.canChange && <Button variant="secondary" disabled={busy || !draft.some(change => codes.has(change.symbol))}
          onClick={() => apply(draft.filter(change => !codes.has(change.symbol)))} data-testid="map-project-symbol-colors-reset">{text.reset}</Button>}
        <span className={colorStyles.spacer} />
        <Button variant="secondary" onClick={() => dialog.current?.close()}>{dirty ? text.cancel : text.close}</Button>
        {control.canChange && <Button disabled={busy || !dirty} data-testid="map-project-symbol-colors-save" onClick={() => {
          setBusy(true);
          void control.onSave(draft).then(ok => { setBusy(false); setMessage(ok ? text.saved(draft.length) : text.failed); });
        }}>{text.save}</Button>}
      </div>
    </div>
  </Dialog>;
}
