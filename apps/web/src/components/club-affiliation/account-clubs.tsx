"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CLUB_FREE_TEXT_MAX, type AccountClubMembershipView, type AccountClubsResponse, type OrganisationSummary } from "@o-tid/contracts";
import { clubAffiliationSv } from "../../i18n/club-affiliation-sv";
import { clubAffiliationAccountEn, type ClubAffiliationAccount } from "../../i18n/account-en";
import { useTexts } from "../language-provider";
import { affiliationRequest as clubRequest } from "../../lib/club-affiliation-client";
import { Button, Field, Notice, Section } from "../ui";
import { MembershipList, membershipName } from "./membership-list";
import { OrganisationPicker } from "./organisation-picker";
import styles from "./club-affiliation.module.css";


/** ADR-0209 beslut 2: Mitt konto → Mina klubbar. Lägg till ur klubblistan eller som Annan klubb, ta bort. */
export function AccountClubs() {
  const texts = useTexts<ClubAffiliationAccount>(clubAffiliationSv, clubAffiliationAccountEn), text = texts.account;
  const [state, setState] = useState<AccountClubsResponse>();
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();

  async function load() {
    const response = await clubRequest("/api/account/clubs");
    if (response.status === 200) setState(response.json as AccountClubsResponse);
  }
  useEffect(() => { void load(); }, []);

  async function run(method: "POST" | "DELETE", body: Record<string, unknown>) {
    setBusy(true); setMessage(undefined);
    const response = await clubRequest("/api/account/clubs", method, { formatVersion: 1, ...body });
    setBusy(false);
    if (response.status === 200 || response.status === 201) {
      setState(response.json as AccountClubsResponse);
      setMessage({ tone: "ok", text: text.saved });
      return true;
    }
    setMessage({ tone: "error", text: response.status === 409 ? text.exists : text.failed });
    return false;
  }

  const add = (organisation: OrganisationSummary) => void run("POST", { organisationId: organisation.organisationId, freeText: null });
  async function addOther(event: FormEvent) {
    event.preventDefault();
    if (await run("POST", { organisationId: null, freeText: other.trim() })) setOther("");
  }
  const remove = (membership: AccountClubMembershipView) => {
    if (window.confirm(text.removeConfirm(membershipName(membership)))) void run("DELETE", { membershipId: membership.membershipId });
  };

  return <Section id="konto-klubbar" title={text.title} help={text.help}>
    {state && state.memberships.length === 0 && <p className={styles.muted}>{text.empty}</p>}
    {state && state.memberships.length > 0 && <MembershipList memberships={state.memberships} onRemove={remove} busy={busy} />}
    <div className={styles.form}>
      <OrganisationPicker disabled={busy} onPick={add}
        exclude={state?.memberships.flatMap(membership => membership.organisation ? [membership.organisation.organisationId] : []) ?? []} />
      <form className={styles.form} onSubmit={event => void addOther(event)} noValidate>
        <Field label={texts.picker.other} help={texts.picker.otherHelp}>
          <input value={other} maxLength={CLUB_FREE_TEXT_MAX} autoComplete="off" disabled={busy} onChange={event => setOther(event.target.value)} />
        </Field>
        <div className={styles.actions}><Button type="submit" variant="secondary" disabled={busy || !other.trim()}>{text.addOther}</Button></div>
      </form>
    </div>
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
  </Section>;
}
