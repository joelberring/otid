"use client";

import { useEffect, useState } from "react";
import type { OrganisationSearchResponse, OrganisationSummary } from "@o-tid/contracts";
import { clubLeadersEn } from "../../i18n/club-leaders-en";
import { clubLeadersSv } from "../../i18n/club-leaders-sv";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import { OrganisationPicker } from "./organisation-picker";
import styles from "./club-affiliation.module.css";

/**
 * Ägaren 2026-11-15: arrangörsklubben väljs när tävlingen skapas. Förval: kontots klubb, när kontot har exakt en (bekräftad
 * under Mina klubbar eller en klubbyta kopplad till Eventor); med flera väljer man bland dem, och sökningen i klubblistan och
 * "Ingen" finns alltid. `onChange` får null för ingen. Går listan inte att hämta lämnas värdet orört (undefined), och då gäller
 * serverns förval som förut. Sparas av anroparen med samma anrop som Inställningar → Klubben och klubbarkivet.
 */
export function OrganiserChoiceField({ value, onChange, disabled }: {
  value: OrganisationSummary | null | undefined; onChange: (organisation: OrganisationSummary | null) => void; disabled?: boolean }) {
  const text = useTexts(clubLeadersSv.organiser, clubLeadersEn.organiser);
  const [mine, setMine] = useState<readonly OrganisationSummary[]>([]);
  useEffect(() => {
    let current = true;
    void fetch("/api/organizer/organisations?mine=1", { credentials: "same-origin", cache: "no-store" })
      .then(async response => response.ok ? await response.json() as OrganisationSearchResponse : undefined)
      .then(result => {
        if (!current || !result) return;
        setMine(result.organisations);
        onChange(result.organisations.length === 1 ? result.organisations[0]! : null);
      }).catch(() => undefined);
    return () => { current = false; };
  }, [onChange]);
  const others = mine.filter(organisation => organisation.organisationId !== value?.organisationId);
  return <fieldset className={styles.radios} disabled={disabled} data-testid="create-organiser">
    <legend>{text.legend}</legend>
    <p><strong data-testid="create-organiser-chosen">{value ? value.name : text.none}</strong></p>
    {!value && mine.length > 1 && <p className={styles.muted}>{text.choose}</p>}
    {(others.length > 0 || value) && <div className={styles.actions}>
      {others.map(organisation => <Button key={organisation.organisationId} variant="secondary" onClick={() => onChange(organisation)}>
        {text.pickMine(organisation.shortName ?? organisation.name)}</Button>)}
      {value && <Button variant="quiet" onClick={() => onChange(null)}>{text.clear}</Button>}
    </div>}
    <OrganisationPicker label={text.search} withoutOther disabled={disabled ?? false} onPick={onChange} exclude={value ? [value.organisationId] : []} />
    <p className={styles.muted}>{text.help}</p>
  </fieldset>;
}
