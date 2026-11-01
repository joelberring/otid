"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { DescriptionBox, DescriptionLanguage, DescriptionSymbol } from "@o-tid/course-setting";
import { courseSettingDescriptionSv as text } from "../../i18n/course-setting-description-sv";
import { symbolNodes } from "../../lib/course-setting-description-draw";
import { allowsText, moveActive, pickerOptions, type PickerOption } from "../../lib/course-setting-description-picker";
import { Button } from "../ui";
import { DescriptionShapes } from "./description-svg";
import styles from "./course-setting.module.css";

export type PickedValue = { readonly ref: string } | { readonly text: string } | null;

/** En symbol som liten ikon i listan (symbolens ruta, y uppåt, vänd rätt). */
export function SymbolIcon({ symbol, size = 28 }: { symbol: DescriptionSymbol; size?: number }) {
  return <svg viewBox="0 0 10 10" width={size} height={size} aria-hidden="true" className={styles.symbolIcon}>
    <DescriptionShapes nodes={symbolNodes(symbol.shapes, { x: 5, y: 5 }, 10)} />
  </svg>;
}

/**
 * Steg 63: väljaren för en ruta. Sökfältet har fokus hela tiden (combobox): pilarna flyttar markeringen i listan, Enter
 * väljer och Escape stänger. I F och G blir en sökning som inte är en symbol en fri text.
 */
export function DescriptionPicker({ label, box, current, symbols, recent, language, onPick, onClose }: {
  label: string; box: string; current: DescriptionBox | undefined; symbols: readonly DescriptionSymbol[]; recent: readonly string[];
  language: DescriptionLanguage; onPick: (value: PickedValue) => void; onClose: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState(current?.text ?? "");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const options = useMemo(() => pickerOptions(symbols, { box, query, recent, language }), [symbols, box, query, recent, language]);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [box, label]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [id, active]);

  const pick = (option: PickerOption | undefined) => {
    if (!option) return;
    onPick(option.kind === "symbol" ? { ref: option.symbol.id } : option.kind === "text" ? { text: option.text } : null);
  };
  return <div className={styles.picker} role="dialog" aria-label={text.picker.heading(label, box, text.boxNames[box] ?? box)}
    data-testid="description-picker">
    <div className={styles.pickerHead}>
      <strong>{text.picker.heading(label, box, text.boxNames[box] ?? box)}</strong>
      <Button variant="quiet" onClick={onClose}>{text.picker.close}</Button>
    </div>
    <input ref={input} type="search" role="combobox" aria-expanded="true" aria-controls={`${id}-list`} aria-autocomplete="list"
      aria-activedescendant={options.length > 0 ? `${id}-${active}` : undefined} value={query} maxLength={40}
      aria-label={allowsText(box) ? text.picker.searchText : text.picker.search}
      placeholder={allowsText(box) ? text.picker.searchText : text.picker.search} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        else if (event.key === "Enter") { event.preventDefault(); pick(options[active]); }
        else if (["ArrowDown", "ArrowUp", "PageDown", "PageUp"].includes(event.key)) { event.preventDefault(); setActive(value => moveActive(value, event.key, options.length)); }
      }} />
    <ul id={`${id}-list`} role="listbox" aria-label={text.picker.options} className={styles.pickerList}>
      {options.map((option, index) => <li key={option.kind === "symbol" ? option.symbol.id : option.kind} id={`${id}-${index}`} role="option"
        aria-selected={index === active} data-active={index === active}
        data-symbol={option.kind === "symbol" ? option.symbol.id : undefined} onMouseEnter={() => setActive(index)}
        onMouseDown={event => event.preventDefault()} onClick={() => pick(option)}>
        {option.kind === "symbol" && <><SymbolIcon symbol={option.symbol} /><span>{option.name}</span>
          <span className={styles.muted}>{option.recent ? `${text.picker.recent} · ` : ""}{option.symbol.id}</span></>}
        {option.kind === "text" && <span>{text.picker.text(option.text)}</span>}
        {option.kind === "none" && <span>{text.picker.none}</span>}
      </li>)}
    </ul>
    {options.length === 0 && <p className={styles.muted}>{text.picker.nothing}</p>}
    <p className={styles.muted}>{text.picker.keys}</p>
  </div>;
}
