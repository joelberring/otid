"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { OrganisationSearchResponse, OrganisationSummary } from "@o-tid/contracts";
import { clubAffiliationSv } from "../../i18n/club-affiliation-sv";
import styles from "./club-affiliation.module.css";

const text = clubAffiliationSv.picker;

/**
 * ADR-0209: sökning i klubblistan (Eventors organisationer) som kombinationsruta. Accenter, stora bokstäver och skiljetecken
 * spelar ingen roll, och kortnamn och initialer matchar ("älvsjö" och "okäö" hittar OK Älvsjö-Örby). Servern söker.
 */
export function OrganisationPicker({ onPick, exclude = [], label = text.search, disabled }: { onPick: (organisation: OrganisationSummary) => void;
  exclude?: readonly string[]; label?: string; disabled?: boolean }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<OrganisationSummary[]>([]);
  const [empty, setEmpty] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const sequence = useRef(0);
  const excluded = exclude.join(",");

  useEffect(() => {
    const value = query.trim();
    if (value.length < 2) { setOptions([]); setEmpty(false); return; }
    const current = ++sequence.current;
    const timer = setTimeout(() => {
      void fetch(`/api/organizer/organisations?q=${encodeURIComponent(value)}`, { credentials: "same-origin", cache: "no-store" })
        .then(async response => response.ok ? await response.json() as OrganisationSearchResponse : undefined)
        .then(result => {
          if (current !== sequence.current || !result) return;
          setOptions(result.organisations.filter(organisation => !excluded.split(",").includes(organisation.organisationId)));
          setEmpty(result.directoryEmpty);
          setActive(0);
          setOpen(true);
        }).catch(() => { if (current === sequence.current) setOptions([]); });
    }, 200);
    return () => clearTimeout(timer);
  }, [query, excluded]);

  function pick(organisation: OrganisationSummary) {
    onPick(organisation);
    setQuery(""); setOptions([]); setOpen(false);
  }

  function key(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive(value => Math.min(value + 1, options.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(value => Math.max(value - 1, 0)); }
    else if (event.key === "Enter" && open && options[active]) { event.preventDefault(); pick(options[active]!); }
    else if (event.key === "Escape") setOpen(false);
  }

  const listId = `${id}-list`;
  const showList = open && query.trim().length >= 2;
  return <div className={styles.picker}>
    <label htmlFor={`${id}-input`}>{label}</label>
    <input id={`${id}-input`} role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list" autoComplete="off"
      aria-activedescendant={showList && options[active] ? `${id}-${active}` : undefined} value={query} placeholder={text.placeholder}
      maxLength={120} disabled={disabled} onChange={event => { setQuery(event.target.value); setOpen(true); }} onKeyDown={key}
      onBlur={() => setTimeout(() => setOpen(false), 150)} />
    {showList && <ul id={listId} role="listbox" className={styles.options} aria-label={label}>
      {options.map((organisation, index) => <li key={organisation.organisationId} id={`${id}-${index}`} role="option" aria-selected={index === active}
        onMouseDown={event => { event.preventDefault(); pick(organisation); }}>
        <span>{organisation.name}</span>{organisation.shortName && organisation.shortName !== organisation.name && <small>{organisation.shortName}</small>}
      </li>)}
      {options.length === 0 && <li role="option" aria-selected={false} aria-disabled="true">{empty ? text.emptyDirectory : text.none}</li>}
    </ul>}
  </div>;
}
