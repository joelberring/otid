"use client";

import type { MapAgreement, MapAgreementIssueCode } from "@o-tid/contracts";
import { trainingGroupSv } from "../../i18n/training-group-sv";
import { Field } from "../ui";
import styles from "./training-group.module.css";

const text = trainingGroupSv.agreement;

/** Ett tomt avtal: klubbens egen karta utan villkor. */
export const emptyAgreement: MapAgreement = { ownership: "CLUB", ownerKind: null, ownerName: null, agreement: null, validUntil: null, contact: null,
  trainingOnly: false, feePerPrint: false, noPublicDisplay: false };

/**
 * Steg 68 (ADR-0182 beslut 4): kartans rättigheter i klartext – klubbens egen eller extern med ägare, avtalet, giltighetstid,
 * kontakt och villkor – och varningarna för den användning det gäller. Visas där kartan väljs och på tävlingens kartsida.
 */
export function MapAgreementSummary({ agreement, issues = [], title }: { agreement: MapAgreement; issues?: readonly MapAgreementIssueCode[];
  title?: string | undefined }) {
  const conditions = [agreement.trainingOnly && text.trainingOnly, agreement.feePerPrint && text.feePerPrint,
    agreement.noPublicDisplay && text.noPublicDisplay].filter(Boolean);
  const serious: readonly MapAgreementIssueCode[] = issues.filter(issue => issue !== "FEE_PER_PRINT");
  const owner = [agreement.ownerKind && agreement.ownership === "EXTERNAL" ? text.ownerKindOptions[agreement.ownerKind] : "", agreement.ownerName ?? ""]
    .filter(Boolean).join(": ");
  return <div className={`${styles.agreement} ${serious.length > 0 ? styles.warning : ""}`} data-testid="map-agreement">
    {title && <p><strong>{title}</strong></p>}
    <p><strong>{agreement.ownership === "CLUB" ? text.own : text.external(owner)}</strong>
      {agreement.validUntil ? ` · ${text.until(agreement.validUntil)}` : ""}</p>
    {agreement.agreement && <p className={styles.agreementText}>{text.text}: {agreement.agreement}</p>}
    {conditions.length > 0 && <p>{text.conditions}: {conditions.join(", ")}</p>}
    {agreement.contact && <p>{text.contact}: {agreement.contact}</p>}
    {issues.length > 0 && <ul className={styles.issues} role={serious.length > 0 ? "alert" : undefined}>
      {issues.map(issue => <li key={issue}>{serious.includes(issue) ? <strong>{text.issues[issue]}</strong> : text.issues[issue]}</li>)}
    </ul>}
  </div>;
}

/** Formulärets fält för avtalet. */
export function MapAgreementFields({ value, onChange, disabled }: { value: MapAgreement; onChange: (value: MapAgreement) => void; disabled?: boolean }) {
  const set = (patch: Partial<MapAgreement>) => onChange({ ...value, ...patch });
  const external = value.ownership === "EXTERNAL";
  return <>
    <fieldset className={styles.choice}>
      <legend>{text.ownership}</legend>
      {(["CLUB", "EXTERNAL"] as const).map(option => <label key={option} className={styles.check}>
        <input type="radio" name="ownership" checked={value.ownership === option} disabled={disabled}
          onChange={() => set({ ownership: option, ...(option === "CLUB" ? { ownerKind: null } : {}) })} />{text.ownershipOptions[option]}</label>)}
    </fieldset>
    {external && <div className={styles.inline}>
      <Field label={text.ownerKind}><select value={value.ownerKind ?? ""} disabled={disabled}
        onChange={event => set({ ownerKind: (event.target.value || null) as MapAgreement["ownerKind"] })}>
        <option value="">–</option>
        {(["CLUB", "MUNICIPALITY", "MAPPER", "OTHER"] as const).map(kind => <option key={kind} value={kind}>{text.ownerKindOptions[kind]}</option>)}
      </select></Field>
      <Field label={text.ownerName}><input value={value.ownerName ?? ""} maxLength={200} disabled={disabled}
        onChange={event => set({ ownerName: event.target.value || null })} /></Field>
    </div>}
    <Field label={text.text} help={text.textHelp}><textarea value={value.agreement ?? ""} maxLength={2000} disabled={disabled}
      onChange={event => set({ agreement: event.target.value || null })} /></Field>
    <div className={styles.inline}>
      <Field label={text.validUntil}><input type="date" value={value.validUntil ?? ""} disabled={disabled}
        onChange={event => set({ validUntil: event.target.value || null })} /></Field>
      <Field label={text.contact}><input value={value.contact ?? ""} maxLength={200} disabled={disabled}
        onChange={event => set({ contact: event.target.value || null })} /></Field>
    </div>
    <fieldset className={styles.choice}>
      <legend>{text.conditions}</legend>
      <label className={styles.check}><input type="checkbox" checked={value.trainingOnly} disabled={disabled}
        onChange={event => set({ trainingOnly: event.target.checked })} />{text.trainingOnly}</label>
      <label className={styles.check}><input type="checkbox" checked={value.feePerPrint} disabled={disabled}
        onChange={event => set({ feePerPrint: event.target.checked })} />{text.feePerPrint}</label>
      <label className={styles.check}><input type="checkbox" checked={value.noPublicDisplay} disabled={disabled}
        onChange={event => set({ noPublicDisplay: event.target.checked })} />{text.noPublicDisplay}</label>
    </fieldset>
  </>;
}
