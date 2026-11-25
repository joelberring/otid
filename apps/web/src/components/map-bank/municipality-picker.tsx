"use client";

import { useMemo, useRef, useState } from "react";
import { municipalityByCode, searchMunicipalities } from "@o-tid/domain";
import { mapBankEn } from "../../i18n/map-bank-en";
import { mapBankSv } from "../../i18n/map-bank-sv";
import { useTexts } from "../language-provider";
import styles from "./map-sharing-panel.module.css";

export interface MunicipalityPickerProps {
  readonly value: readonly string[];
  readonly onChange: (codes: string[]) => void;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly max?: number;
}

/**
 * Sökbar flerkommunsväljare över Sveriges 290 kommuner (`@o-tid/domain`).
 */
export function MunicipalityPicker({ value, onChange, disabled = false, id = "municipality-picker", max = 20 }: MunicipalityPickerProps) {
  const text = useTexts(mapBankSv.sharing, mapBankEn.sharing);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const selectedItems = useMemo(
    () => value.map(code => municipalityByCode(code) ?? { code, name: code, countyCode: code.slice(0, 2), countyName: "" }),
    [value]
  );
  const suggestions = useMemo(
    () => searchMunicipalities(query, 25).filter(item => !selectedSet.has(item.code)),
    [query, selectedSet]
  );

  function add(code: string) {
    if (selectedSet.has(code) || value.length >= max) return;
    onChange([...value, code]);
    setQuery("");
    setOpen(false);
  }

  function remove(code: string) {
    onChange(value.filter(item => item !== code));
  }

  return (
    <div className={styles.picker} data-testid="municipality-picker">
      <label htmlFor={id}>{text.municipalitiesLabel}</label>
      <p className={styles.help}>{text.municipalitiesHelp}</p>

      {selectedItems.length > 0 ? (
        <ul className={styles.chips} aria-label={text.municipalitiesLabel}>
          {selectedItems.map(item => (
            <li key={item.code} className={styles.chip}>
              <span>{item.name}</span>
              <button
                type="button"
                className={styles.chipRemove}
                disabled={disabled}
                aria-label={text.municipalityRemove(item.name)}
                onClick={() => remove(item.code)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.help}>{text.municipalityEmpty}</p>
      )}

      <div className={styles.pickerBox}>
        <input
          id={id}
          type="search"
          value={query}
          disabled={disabled || value.length >= max}
          placeholder={text.municipalitySearchPlaceholder}
          autoComplete="off"
          aria-expanded={open}
          aria-autocomplete="list"
          onFocus={() => {
            if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
            setOpen(true);
          }}
          onBlur={() => {
            blurTimerRef.current = setTimeout(() => setOpen(false), 150);
          }}
          onChange={event => {
            setQuery(event.target.value);
            setOpen(true);
          }}
        />
        {open && suggestions.length > 0 && (
          <div className={styles.suggestions} role="listbox" aria-label={text.municipalitiesLabel}>
            {suggestions.map(item => (
              <button
                key={item.code}
                type="button"
                role="option"
                aria-selected={false}
                className={styles.suggestionItem}
                onMouseDown={event => event.preventDefault()}
                onClick={() => add(item.code)}
              >
                <span>{item.name}</span>
                <span className={styles.suggestionCounty}>{item.countyName}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
