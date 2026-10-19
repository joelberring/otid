import { cloneElement, isValidElement, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
  type TableHTMLAttributes } from "react";
import styles from "./ui.module.css";

/**
 * Gemensamma komponenter för arbetsytan, speakersidan och de publika sidorna (ADR-0170 beslut 2).
 * Få och konsekventa: en knapphierarki, fält, tabell, verktygsrad, besked, tomt läge och avsnitt.
 */

const join = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

/** Primär (en per vy), sekundär (kant) eller tyst (text). */
export function Button({ variant = "primary", className, type = "button", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" }) {
  return <button type={type} className={join(styles.button, variant === "secondary" && `secondary ${styles.secondary}`,
    variant === "quiet" && styles.quiet, className)} {...props} />;
}

/**
 * Ett fält med etikett, valfri hjälptext och valfritt fel (PLAN.md steg 24). Barnet är själva kontrollen; hjälptexten och
 * felet ingår inte i namnet men kopplas med `aria-describedby`, och kontrollen får `aria-invalid` när det finns ett fel.
 * Formulären använder `noValidate` och visar sina egna svenska fel här i stället för webbläsarens.
 */
export function Field({ label, help, error, children, className }: { label: ReactNode; help?: ReactNode; error?: string | undefined;
  children: ReactNode; className?: string | undefined }) {
  const id = useId();
  const described = [error ? `${id}-error` : "", help ? `${id}-help` : ""].filter(Boolean).join(" ");
  const control = isValidElement<{ "aria-invalid"?: boolean | undefined; "aria-describedby"?: string | undefined }>(children) && described
    ? cloneElement(children, { "aria-invalid": error ? true : undefined,
      "aria-describedby": [children.props["aria-describedby"], described].filter(Boolean).join(" ") })
    : children;
  // Samma struktur med och utan fel, så att kontrollen inte byts ut (och tappar det man skrivit) när ett fel visas eller försvinner.
  return <div className={join(styles.fieldWithHelp, className)}>
    <label className={styles.field}><span>{label}</span>{control}</label>
    {error && <span className={styles.fieldError} id={`${id}-error`}><span aria-hidden="true">✗ </span>{error}</span>}
    {help && <span className={styles.fieldHelp} id={`${id}-help`}>{help}</span>}
  </div>;
}

/**
 * Datum som ÅÅÅÅ-MM-DD i alla webbläsare (PLAN.md steg 24). Webbläsarens datumfält visar webbläsarens språk (till exempel
 * mm/dd/yyyy), så datum skrivs som text och kontrolleras av formuläret.
 */
export function DateInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <input type="text" inputMode="numeric" autoComplete="off" spellCheck={false} placeholder="ÅÅÅÅ-MM-DD" maxLength={10} {...props} />;
}

/** Flyttar fokus till formulärets första fält med fel, efter att felen har ritats ut. */
export function focusFirstError(form: HTMLFormElement | null | undefined) {
  requestAnimationFrame(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

/**
 * Fokus till ett fält i formuläret så snart det går att fokusera: efter ett sparande är fälten inaktiva tills
 * listan är omladdad, så försöket görs om en bildruta i taget (högst ungefär en sekund).
 */
export function focusWhenEnabled(form: { current: HTMLFormElement | null }, selector: string, frames = 60) {
  requestAnimationFrame(() => {
    const field = form.current?.querySelector<HTMLInputElement>(selector);
    if (field && !field.disabled) field.focus();
    else if (frames > 0) focusWhenEnabled(form, selector, frames - 1);
  });
}

/** Val i en lista, med etikett. */
export function Select({ label, help, error, children, className, ...props }: SelectHTMLAttributes<HTMLSelectElement> &
  { label: ReactNode; help?: ReactNode; error?: string | undefined }) {
  return <Field label={label} help={help} error={error} className={className}><select {...props}>{children}</select></Field>;
}

/** Verktygsrad: filter och åtgärder på en rad. `end` hamnar till höger. */
export function Toolbar({ children, end, label }: { children?: ReactNode; end?: ReactNode; label?: string }) {
  return <div className={styles.toolbar} role={label ? "toolbar" : undefined} aria-label={label}>
    {children}{end && <div className={styles.toolbarEnd}>{end}</div>}
  </div>;
}

/** Ett avsnitt med rubrik, kort hjälptext och åtgärder. Avsnitt skiljs åt med luft och en linje. */
export function Section({ title, help, actions, children, id, label, headingLevel = 2, number }: {
  title?: ReactNode; help?: ReactNode; actions?: ReactNode; children?: ReactNode; id?: string | undefined; label?: string | undefined;
  headingLevel?: 2 | 3;
  /** Stegets nummer när delen har flera steg i ordning (PLAN.md steg 24). Bara visuellt; rubrikens namn är titeln. */
  number?: number | undefined;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const headingId = id ? `${id}-title` : undefined;
  return <section className={styles.section} aria-labelledby={title ? headingId : undefined} aria-label={title ? undefined : label} id={id}>
    {(title || actions) && <div className={styles.sectionHead}>
      <div>{title && <div className={styles.sectionTitle}>
        {number !== undefined && <span className={styles.stepNumber} aria-hidden="true">{number}</span>}
        <Heading id={headingId}>{title}</Heading></div>}{help && <p className={styles.sectionHelp}>{help}</p>}</div>
      {actions && <div className={styles.toolbarEnd}>{actions}</div>}
    </div>}
    {children}
  </section>;
}

export type Tone = "info" | "ok" | "attention" | "error";
const symbols: Record<Tone, string> = { info: "i", ok: "✓", attention: "!", error: "✗" };

/** Ett besked: symbol och ord, färgen förstärker bara. `role` styr hur skärmläsare får beskedet. */
export function Notice({ tone = "info", children, role }: { tone?: Tone | undefined; children: ReactNode; role?: "status" | "alert" | undefined }) {
  return <div className={styles.notice} data-tone={tone} role={role}>
    <span aria-hidden="true">{symbols[tone]}</span><div>{children}</div>
  </div>;
}

/** Tomt läge: säger vad som saknas och vad man gör härnäst, med en primär åtgärd när det finns en. */
export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return <div className={styles.empty}><strong>{title}</strong>{children && <p>{children}</p>}
    {action && <div className={styles.emptyAction}>{action}</div>}</div>;
}

/** Tät tabell med rubriker som följer med vid rullning. */
export function Table({ children, className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <div className={styles.tableWrap}><table className={join(styles.table, className)} {...props}>{children}</table></div>;
}

/** Klass för högerställda siffror i tabeller. */
export const numeric = styles.num;
