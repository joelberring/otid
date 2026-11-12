"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  SELF_REGISTRATION_CARD_MAX, selfRegistrationErrorResponseSchema, selfRegistrationInfoResponseSchema, selfRegistrationResponseSchema,
  type SelfRegistrationInfoResponse, type SelfRegistrationResponse
} from "@o-tid/contracts";
import { PARTY_DISPLAY_NAME_MAX, partyDefaultDisplayName } from "@o-tid/domain";
import type { GroupNameDisplay } from "@o-tid/contracts";
import { Button, Field, Notice, focusFirstError } from "../ui";
import type { FieldErrors } from "../../lib/form-validation";
import { selfRegistrationSv } from "../../i18n/self-registration-sv";
import { groupPublicEn, selfRegistrationEn } from "../../i18n/public-en";
import { useLanguage } from "../language-provider";
import { trainingGroupSv } from "../../i18n/training-group-sv";
import styles from "./self-registration.module.css";
import { readReceipts, rememberReceipt, type StoredReceipt } from "./self-registration-receipts";

/**
 * "Registrera din pinne" (PLAN.md steg 41) på fest-sidan och tävlingssidan, utan inloggning. Formuläret visas bara när
 * servern säger att självregistreringen är öppen (inställningen på, publicerad, tävlingsdagen); servern kontrollerar samma
 * sak vid registreringen. Ett dolt fält är en fälla för robotar.
 */
type FieldName = "cardNumber" | "givenName" | "familyName" | "club" | "classId" | "displayName";
type Form = Record<FieldName | "website", string>;
type Remembered = { cardNumber: string; givenName: string; familyName: string; club: string; className: string };
const rememberedKey = (key: string) => `otid-grupp-anmalan:${key}`;

/** Den senaste anmälan till gruppen i den här webbläsaren; ingen (eller blockerad lagring) ger undefined. */
function readRemembered(key: string): Remembered | undefined {
  try {
    const value = JSON.parse(window.localStorage.getItem(rememberedKey(key)) ?? "null") as Partial<Remembered> | null;
    return value && typeof value.cardNumber === "string" && typeof value.givenName === "string" && typeof value.familyName === "string"
      ? { cardNumber: value.cardNumber, givenName: value.givenName, familyName: value.familyName, club: value.club ?? "",
        className: value.className ?? "" } : undefined;
  } catch { return undefined; }
}

function writeRemembered(key: string, value: Remembered): void {
  try { window.localStorage.setItem(rememberedKey(key), JSON.stringify(value)); } catch { /* Utan lagring minns telefonen inget; anmälan är ändå gjord. */ }
}

const empty: Form = { cardNumber: "", givenName: "", familyName: "", club: "", classId: "", displayName: "", website: "" };

export function validateSelfRegistration(form: Form, needsClass: boolean, text: { readonly errors: Record<FieldName, string> } = selfRegistrationSv)
  : FieldErrors<FieldName> {
  const card = form.cardNumber.replace(/\s/g, "");
  const name = (value: string) => value.trim().length >= 1 && value.trim().length <= 60 && /\p{L}/u.test(value);
  return {
    cardNumber: /^[1-9][0-9]{0,6}$/.test(card) && Number(card) <= SELF_REGISTRATION_CARD_MAX ? undefined : text.errors.cardNumber,
    givenName: name(form.givenName) ? undefined : text.errors.givenName,
    familyName: name(form.familyName) ? undefined : text.errors.familyName,
    club: form.club.trim().length === 0 || (form.club.trim().length <= 80 && /\p{L}/u.test(form.club)) ? undefined : text.errors.club,
    classId: !needsClass || form.classId ? undefined : text.errors.classId,
    displayName: form.displayName.trim().length === 0 || (form.displayName.trim().length <= PARTY_DISPLAY_NAME_MAX && /\p{L}/u.test(form.displayName))
      ? undefined : text.errors.displayName
  };
}

/**
 * `collapsible` (steg 42, fest-sidan): en knapp "Registrera din pinne" med aria-expanded, stängd från början, som fäller
 * ut formuläret. Knappen och formuläret är egna rader i förälderns flexrad (`display: contents`).
 */
export function SelfRegistrationForm({ raceId, collapsible = false, publicNames = false, rememberKey, startList, names = "FULL" }: { raceId: string; collapsible?: boolean;
  /** Fest: festen visar visningsnamn publikt (steg 46), så formuläret säger det. */
  publicNames?: boolean;
  /**
   * Steg 68 (ADR-0182 beslut 5): träningsgruppens kod. Telefonen minns den senaste anmälan till gruppen (bara i den här
   * webbläsaren) och erbjuder "Samma som förra gången" vid nästa träning; servern lämnar aldrig ut namn för en bricka.
   */
  rememberKey?: string | undefined;
  /** Om sidan visar en publicerad startlista; undefined när sidan inte vet (gruppens sida). */
  startList?: boolean | undefined;
  /** Gruppens namnregel för tävlingens publika sidor. */
  names?: GroupNameDisplay }) {
  const en = useLanguage() === "en";
  const text = en ? selfRegistrationEn : selfRegistrationSv;
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const [info, setInfo] = useState<SelfRegistrationInfoResponse>();
  const [form, setForm] = useState<Form>(empty);
  const [errors, setErrors] = useState<FieldErrors<FieldName>>({});
  const [message, setMessage] = useState<string>();
  const [receipt, setReceipt] = useState<SelfRegistrationResponse>();
  const [saving, setSaving] = useState(false);
  const [remembered, setRemembered] = useState<Remembered>();
  const [stored, setStored] = useState<StoredReceipt[]>([]);
  /** Med ett minnet kvitto visas formuläret först när man väljer "Registrera en bricka till". */
  const [another, setAnother] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const clubsId = useId();

  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const response = await fetch(`/api/public/races/${raceId}/self-registration`, { cache: "no-store" });
        if (!response.ok) return;
        const value = selfRegistrationInfoResponseSchema.parse(await response.json());
        if (!stopped) setInfo(value);
      } catch { /* Utan svar visas inget formulär; registreringen görs då hos arrangören. */ }
    })();
    return () => { stopped = true; };
  }, [raceId]);
  useEffect(() => { if (rememberKey) setRemembered(readRemembered(rememberKey)); }, [rememberKey]);
  useEffect(() => { setStored(readReceipts(raceId)); }, [raceId]);

  // En stängd registrering visar bara kvittot som webbläsaren minns (inte för en fest).
  if (!info || (!info.open && (info.kind === "PARTY" || stored.length === 0))) return null;
  const needsClass = info.kind === "RACE";
  const change = (field: keyof Form) => (event: { target: { value: string } }) => {
    setForm(current => ({ ...current, [field]: event.target.value }));
    setMessage(undefined);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const found = validateSelfRegistration(form, needsClass, text);
    setErrors(found);
    if (Object.values(found).some(Boolean)) { focusFirstError(formRef.current); return; }
    setSaving(true); setMessage(undefined);
    try {
      const response = await fetch(`/api/public/races/${raceId}/self-registration`, { method: "POST", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ formatVersion: 1, cardNumber: form.cardNumber.replace(/\s/g, ""), givenName: form.givenName.trim(),
          familyName: form.familyName.trim(), club: form.club.trim() || null, ...(needsClass ? { classId: form.classId } : {}),
          ...(!needsClass ? { displayName: form.displayName.trim() || null } : {}),
          ...(form.website ? { website: form.website } : {}) }) });
      if (response.ok) {
        const done = selfRegistrationResponseSchema.parse(await response.json());
        setReceipt(done);
        if (needsClass) { setStored(rememberReceipt(raceId, { name: done.name, className: done.className ?? "", cardNumber: done.cardNumber })); setAnother(false); }
        if (rememberKey) {
          const className = info?.classes.find(row => row.id === form.classId)?.name ?? "";
          const value = { cardNumber: form.cardNumber.replace(/\s/g, ""), givenName: form.givenName.trim(), familyName: form.familyName.trim(),
            club: form.club.trim(), className };
          writeRemembered(rememberKey, value); setRemembered(value);
        }
        setForm(empty); setErrors({});
        return;
      }
      const failure = selfRegistrationErrorResponseSchema.safeParse(await response.json().catch(() => null));
      const code = failure.success ? failure.data.error : "INTERNAL_ERROR";
      if (code === "INVALID_REQUEST" && failure.success && failure.data.fields?.length) {
        setErrors(Object.fromEntries(failure.data.fields.map(field => [field, text.errors[field]])));
        focusFirstError(formRef.current);
        return;
      }
      setMessage(code === "CARD_TAKEN" ? text.errors.taken : code === "CARD_HAS_PURCHASES" ? text.errors.hasPurchases : code === "CLASS_FULL" ? text.errors.full
        : code === "CLOSED" || code === "NOT_FOUND" ? text.errors.closed : code === "RATE_LIMITED" ? text.errors.rateLimited : text.errors.failed);
    } catch { setMessage(text.errors.failed); }
    finally { setSaving(false); }
  }

  if (collapsible) return <div className={styles.dropdown}>
    <button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={panelId}
      onClick={() => setExpanded(value => !value)}>{text.title}<span aria-hidden="true" className={styles.chevron}>▾</span></button>
    <div id={panelId} className={styles.panel} hidden={!expanded}>{renderBox(false)}</div>
  </div>;
  return renderBox(true);

  function renderBox(heading: boolean) {
    if (!info) return null;
    return <section className={styles.box} aria-labelledby={heading ? "self-registration-title" : undefined}
      aria-label={heading ? undefined : text.title} data-testid="self-registration">
      {heading ? <h2 id="self-registration-title">{text.title}</h2> : null}
      {receipt ? <div className={styles.receipt}>
        <Notice tone="ok" role="status">
          <strong>{text.receipt(receipt.cardNumber, receipt.name)}</strong>
          {receipt.className ? <> {text.receiptClass(receipt.className)}</> : null}
          {receipt.displayName ? <> {text.receiptDisplayName(receipt.displayName)}</> : null}
        </Notice>
        <Button variant="secondary" onClick={() => { setReceipt(undefined); setAnother(true); }}>{text.again}</Button>
      </div> : stored.length > 0 && !another ? <div className={styles.receipt} data-testid="self-registration-stored">
        <Notice tone="ok" role="status">{stored.map(row => <p key={row.cardNumber}>{text.stored(row.name, row.className, row.cardNumber)}</p>)}</Notice>
        {info.open && <Button variant="secondary" onClick={() => setAnother(true)}>{text.again}</Button>}
      </div> : !info.open ? null : <form ref={formRef} noValidate onSubmit={submit} className={styles.form}>
        <p className={styles.intro}>{needsClass ? text.intro.race : text.intro.party}</p>
        {remembered && <Button variant="secondary" onClick={() => {
          const classId = info.classes.find(row => row.name === remembered.className)?.id ?? "";
          setForm(current => ({ ...current, cardNumber: remembered.cardNumber, givenName: remembered.givenName, familyName: remembered.familyName,
            club: remembered.club, classId })); setErrors({});
        }}>{(en ? groupPublicEn : trainingGroupSv.public).sameAgain(`${remembered.givenName}, ${remembered.cardNumber}${remembered.className ? `, ${remembered.className}` : ""}`)}</Button>}
        <Field label={text.cardNumber} help={text.cardHelp} error={errors.cardNumber}>
          <input name="cardNumber" inputMode="numeric" autoComplete="off" maxLength={9} value={form.cardNumber} onChange={change("cardNumber")} />
        </Field>
        <div className={styles.names}>
          <Field label={text.givenName} error={errors.givenName}>
            <input name="givenName" autoComplete="given-name" maxLength={60} value={form.givenName} onChange={change("givenName")} />
          </Field>
          <Field label={text.familyName} error={errors.familyName}>
            <input name="familyName" autoComplete="family-name" maxLength={60} value={form.familyName} onChange={change("familyName")} />
          </Field>
        </div>
        <Field label={text.club} error={errors.club}>
          <input name="club" autoComplete="organization" maxLength={80} list={info.clubs.length ? clubsId : undefined} value={form.club}
            onChange={change("club")} />
        </Field>
        {!needsClass ? <Field label={text.displayName} error={errors.displayName}
          help={text.displayNameHelp(form.givenName.trim() ? partyDefaultDisplayName(`${form.givenName} ${form.familyName}`) : "Oskar K")}>
          <input name="displayName" autoComplete="nickname" maxLength={PARTY_DISPLAY_NAME_MAX} value={form.displayName} onChange={change("displayName")} />
        </Field> : null}
        {info.clubs.length ? <datalist id={clubsId}>{info.clubs.map(club => <option key={club} value={club} />)}</datalist> : null}
        {needsClass ? <Field label={text.className} error={errors.classId}>
          <select name="classId" value={form.classId} onChange={change("classId")}>
            <option value="">{text.chooseClass}</option>
            {info.classes.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </Field> : null}
        {/* Fälla för robotar: dold för människor och skärmläsare. */}
        <div className={styles.trap} aria-hidden="true">
          <label>{text.trap}<input name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={change("website")} /></label>
        </div>
        <p className={styles.privacy} data-testid="self-registration-privacy">
          {needsClass ? text.privacy.race(startList, names) : publicNames ? text.privacy.partyNames : text.privacy.party} <Link href="/integritet">{text.privacyLink}</Link></p>
        {message ? <Notice tone="error" role="alert">{message}</Notice> : null}
        <div><Button type="submit" disabled={saving}>{saving ? text.saving : text.submit}</Button></div>
      </form>}
    </section>;
  }
}
