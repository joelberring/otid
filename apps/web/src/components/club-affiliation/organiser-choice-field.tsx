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
 * Ägaren 2026-11-15/17: arrangörsklubben väljs aktivt när tävlingen skapas – inget förval, inte ens när kontot har en enda
 * klubb (en testträning hamnade annars tyst i klubbens arkiv). `value` är undefined tills ett val gjorts; null är "Ingen klubb".
 * Kontots klubbar visas som snabbval, sökningen i klubblistan finns alltid. Formuläret skickar valet med när tävlingen skapas.
 */
export function OrganiserChoiceField({ value, onChange, disabled, error }: {
  value: OrganisationSummary | null | undefined; onChange: (organisation: OrganisationSummary | null) => void; disabled?: boolean;
  error?: string | undefined }) {
  const text = useTexts(clubLeadersSv.organiser, clubLeadersEn.organiser);
  const [mine, setMine] = useState<readonly OrganisationSummary[]>([]);
  useEffect(() => {
    let current = true;
    void fetch("/api/organizer/organisations?mine=1", { credentials: "same-origin", cache: "no-store" })
      .then(async response => response.ok ? await response.json() as OrganisationSearchResponse : undefined)
      .then(result => { if (current && result) setMine(result.organisations); })
      .catch(() => undefined);
    return () => { current = false; };
  }, []);
  const others = mine.filter(organisation => organisation.organisationId !== value?.organisationId);
  return <fieldset className={styles.radios} disabled={disabled} data-testid="create-organiser" aria-invalid={error ? true : undefined}>
    <legend>{text.legend}</legend>
    <p><strong data-testid="create-organiser-chosen">{value === undefined ? text.notChosen : value ? value.name : text.none}</strong></p>
    {value === undefined && <p className={styles.muted}>{text.choose}</p>}
    <div className={styles.actions}>
      {others.map(organisation => <Button key={organisation.organisationId} variant="secondary" onClick={() => onChange(organisation)}>
        {text.pickMine(organisation.shortName ?? organisation.name)}</Button>)}
      {value !== null && <Button variant="secondary" data-testid="create-organiser-none" onClick={() => onChange(null)}>{text.clear}</Button>}
    </div>
    <OrganisationPicker label={text.search} withoutOther disabled={disabled ?? false} onPick={onChange} exclude={value ? [value.organisationId] : []} />
    {error && <p role="alert" data-testid="create-organiser-error">{error}</p>}
    <p className={styles.muted}>{text.help}</p>
  </fieldset>;
}
