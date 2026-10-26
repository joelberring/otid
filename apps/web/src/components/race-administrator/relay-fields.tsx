"use client";

import { cloneElement, type ReactElement, type ReactNode } from "react";
import uiStyles from "../ui/ui.module.css";
import relayStyles from "./relay.module.css";
import { relayFormSv as formText } from "../../i18n/relay-form-sv";
import { hasErrors, type FieldErrors } from "../../lib/form-validation";
import { Notice } from "../ui";

/**
 * Ett fält i stafettformulären (steg 56): etiketten står bredvid fältet (htmlFor), så att fältets namn inte får med
 * alternativen i listan. Felet och hjälptexten kopplas med `aria-describedby`, och fältet får `aria-invalid` vid fel,
 * som `Field` i formuläret "Ny bana".
 */
export function RelayField({ id, label, error, help, children, className }: { id: string; label: ReactNode; error?: string | undefined;
  help?: ReactNode; children: ReactElement<{ id?: string | undefined; "aria-invalid"?: boolean | undefined; "aria-describedby"?: string | undefined }>;
  className?: string | undefined }) {
  const described = [error ? `${id}-error` : "", help ? `${id}-help` : ""].filter(Boolean).join(" ") || undefined;
  return <div className={className ?? relayStyles.legField}>
    <label htmlFor={id}>{label}</label>
    {cloneElement(children, { id, "aria-invalid": error ? true : undefined, "aria-describedby": described })}
    {error && <span className={uiStyles.fieldError} id={`${id}-error`}><span aria-hidden="true">✗ </span>{error}</span>}
    {help && <span className={uiStyles.fieldHelp} id={`${id}-help`}>{help}</span>}
  </div>;
}

/** Felen överst i formuläret, i fältens ordning. */
export function RelayErrorSummary({ errors, order }: { errors: FieldErrors<string>; order: readonly string[] }) {
  if (!hasErrors(errors)) return null;
  const keys = [...order.filter(key => errors[key]), ...Object.keys(errors).filter(key => errors[key] && !order.includes(key))];
  return <Notice tone="error" role="alert"><p><strong>{formText.summary(keys.length)}</strong></p>
    <ul data-testid="relay-error-summary">{keys.map(key => <li key={key}>{errors[key]}</li>)}</ul></Notice>;
}
