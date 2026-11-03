"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { AccountClubsResponse, OrganisationSummary } from "@o-tid/contracts";
import { CLUB_FREE_TEXT_MAX } from "@o-tid/contracts";
import { clubAffiliationSv } from "../../i18n/club-affiliation-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { Button, Field, Notice } from "../ui";
import { MembershipList } from "./membership-list";
import { OrganisationPicker } from "./organisation-picker";
import styles from "./club-affiliation.module.css";

const text = clubAffiliationSv;

/** Valda klubbar som chips med "Ta bort". */
export function ChosenClubs({ chosen, onRemove }: { chosen: readonly OrganisationSummary[]; onRemove: (id: string) => void }) {
  if (chosen.length === 0) return null;
  return <ul className={styles.chips} aria-label={text.account.title}>
    {chosen.map(organisation => <li key={organisation.organisationId}>{organisation.name}
      <Button variant="quiet" aria-label={text.picker.remove(organisation.name)} onClick={() => onRemove(organisation.organisationId)}>×</Button></li>)}
  </ul>;
}

/**
 * ADR-0209 beslut 2 och E: steget efter registreringen i Mina tävlingar, "Vilken klubb tillhör du?" (valfritt). Visas tills det är
 * besvarat eller överhoppat. Efter sparandet syns läget direkt: "Du är med i …" när adressen finns i klubbens medlemslista i
 * Eventor, annars väntar det, och saknar klubben klubbyta kan man starta den.
 */
export function ClubStep() {
  const [state, setState] = useState<AccountClubsResponse>();
  const [chosen, setChosen] = useState<OrganisationSummary[]>([]);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<AccountClubsResponse>();

  useEffect(() => {
    let active = true;
    void clubRequest("/api/account/clubs").then(response => { if (active && response.status === 200) setState(response.json as AccountClubsResponse); });
    return () => { active = false; };
  }, []);

  async function answer(skip: boolean, event?: FormEvent) {
    event?.preventDefault();
    setBusy(true); setFailed(false);
    const response = await clubRequest("/api/account/clubs/step", "POST", { formatVersion: 1,
      organisationIds: skip ? [] : chosen.map(organisation => organisation.organisationId), freeText: skip || !other.trim() ? null : other.trim() });
    setBusy(false);
    if (response.status !== 200) { setFailed(true); return; }
    const next = response.json as AccountClubsResponse;
    setState(next);
    if (!skip && next.memberships.length > 0) setResult(next);
  }

  if (result) return <section className={styles.panel} aria-labelledby="club-step-done">
    <h2 id="club-step-done">{text.account.title}</h2>
    <MembershipList memberships={result.memberships} />
    <p className={styles.muted}>{text.step.later}</p>
    <div className={styles.actions}><Button variant="secondary" onClick={() => setResult(undefined)}>OK</Button></div>
  </section>;
  if (!state || state.promptAnswered) return null;
  return <section className={styles.panel} aria-labelledby="club-step-title" data-testid="club-step">
    <h2 id="club-step-title">{text.step.title}</h2>
    <p className={styles.muted}>{text.step.intro}</p>
    <form className={styles.form} onSubmit={event => void answer(false, event)} noValidate>
      <OrganisationPicker exclude={chosen.map(organisation => organisation.organisationId)} disabled={busy}
        onPick={organisation => setChosen(value => [...value, organisation])} />
      <ChosenClubs chosen={chosen} onRemove={id => setChosen(value => value.filter(organisation => organisation.organisationId !== id))} />
      <Field label={text.picker.other} help={text.picker.otherHelp}>
        <input value={other} maxLength={CLUB_FREE_TEXT_MAX} autoComplete="off" disabled={busy} onChange={event => setOther(event.target.value)} />
      </Field>
      <div className={styles.actions}>
        <Button type="submit" disabled={busy || (chosen.length === 0 && !other.trim())}>{text.step.save}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void answer(true)}>{text.step.skip}</Button>
      </div>
      <p className={styles.muted}>{text.step.later}</p>
      {failed && <Notice tone="error" role="alert">{text.step.failed}</Notice>}
    </form>
  </section>;
}
