import { useState, type ReactElement } from "react";
import type { ReadoutPackage } from "@o-tid/contracts";
import { validateReadoutRegistration, type FieldErrors, type ReadoutRegistrationInput } from "../lib/form-validation";
import type { QueuedRegistration } from "./store";
import { readoutText as t } from "./text-sv";

type Fields = ReadoutRegistrationInput;
const EMPTY: Fields = { classId: "", givenName: "", familyName: "", club: "" };

/** Klasserna man kan direktanmäla till: inte stafett (sträckor läggs till som lag). */
export function registrationClasses(pkg: ReadoutPackage) {
  const relay = new Set(pkg.relay?.classes.map((raceClass) => raceClass.classId) ?? []);
  return pkg.raceSnapshot.classes.filter((raceClass) => !relay.has(raceClass.id))
    .sort((left, right) => left.name.localeCompare(right.name, "sv"));
}

/**
 * Direktanmälan av en okänd bricka på avläsningssidan (PLAN.md steg 25): stort och enkelt, med svenska fältfel vid
 * fälten. "Lägg till" köar anmälan i webbläsaren; beskedet bedöms om direkt mot den nya löparen.
 */
export function RegistrationForm({ pkg, cardNumber, onSubmit }: { pkg: ReadoutPackage; cardNumber: string;
  onSubmit: (fields: Fields) => Promise<void> }) {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors<keyof Fields>>({});
  const [saving, setSaving] = useState(false);
  const classes = registrationClasses(pkg);
  const set = (key: keyof Fields) => (event: { target: { value: string } }) => {
    setFields((current) => ({ ...current, [key]: event.target.value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };
  async function submit() {
    const found = validateReadoutRegistration(fields);
    setErrors(found);
    const first = (Object.keys(found) as (keyof Fields)[]).find((key) => found[key]);
    if (first) { document.getElementById(`register-${first}`)?.focus(); return; }
    setSaving(true);
    try { await onSubmit(fields); setFields(EMPTY); }
    finally { setSaving(false); }
  }
  const field = (key: keyof Fields, label: string, control: ReactElement) => <div className="field">
    <label htmlFor={`register-${key}`}>{label}</label>
    {control}
    {errors[key] ? <span className="field-error" id={`register-${key}-error`}><span aria-hidden="true">✗ </span>{errors[key]}</span> : null}
  </div>;
  const described = (key: keyof Fields) => errors[key] ? { "aria-invalid": true as const, "aria-describedby": `register-${key}-error` } : {};
  if (classes.length === 0) return <section className="register" aria-label={t.register.title(cardNumber)}><p>{t.register.noClasses}</p></section>;
  return <form className="register" noValidate aria-label={t.register.title(cardNumber)} data-testid="register-form"
    onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <h2>{t.register.title(cardNumber)}</h2>
    <p className="help">{t.register.help}</p>
    <div className="register-fields">
      {field("classId", t.register.className, <select id="register-classId" value={fields.classId} onChange={set("classId")}
        disabled={saving} {...described("classId")}>
        <option value="">{t.register.chooseClass}</option>
        {classes.map((raceClass) => <option key={raceClass.id} value={raceClass.id}>{raceClass.name}</option>)}
      </select>)}
      {field("givenName", t.register.givenName, <input id="register-givenName" value={fields.givenName} onChange={set("givenName")}
        autoComplete="off" maxLength={160} disabled={saving} {...described("givenName")} />)}
      {field("familyName", t.register.familyName, <input id="register-familyName" value={fields.familyName} onChange={set("familyName")}
        autoComplete="off" maxLength={160} disabled={saving} {...described("familyName")} />)}
      {field("club", t.register.club, <input id="register-club" value={fields.club} onChange={set("club")}
        autoComplete="off" maxLength={200} disabled={saving} {...described("club")} />)}
    </div>
    <div className="row"><button type="submit" className="primary" disabled={saving}>{t.register.submit}</button></div>
  </form>;
}

/** Läget för en anmälan av brickan: väntar, sparad, fanns redan eller avvisad. */
export function RegistrationStatus({ registration, className }: { registration: QueuedRegistration; className: string }) {
  const name = `${registration.request.givenName} ${registration.request.familyName}`;
  const response = registration.response;
  const text = registration.status === "rejected" ? t.register.rejected(name)
    : response?.outcome === "EXISTING" ? t.register.existing(response.entryName, response.className)
      : response ? t.register.stored(response.entryName, response.className)
        : t.register.pending(name, className);
  return <p className="registration" data-testid="registration-status" data-state={registration.status}
    data-outcome={response?.outcome ?? ""}>{registration.status === "rejected" || response?.outcome === "EXISTING" ? "! " : ""}{text}</p>;
}
