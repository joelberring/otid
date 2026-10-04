import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes, TableHTMLAttributes } from "react";
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

/** Ett fält med etikett och valfri hjälptext under. Barnet är själva kontrollen; hjälptexten ingår inte i namnet. */
export function Field({ label, help, children, className }: { label: ReactNode; help?: ReactNode; children: ReactNode;
  className?: string | undefined }) {
  const field = <label className={join(styles.field, !help && className)}><span>{label}</span>{children}</label>;
  return help ? <div className={join(styles.fieldWithHelp, className)}>{field}<span className={styles.fieldHelp}>{help}</span></div> : field;
}

/** Val i en lista, med etikett. */
export function Select({ label, help, children, className, ...props }: SelectHTMLAttributes<HTMLSelectElement> &
  { label: ReactNode; help?: ReactNode }) {
  return <Field label={label} help={help} className={className}><select {...props}>{children}</select></Field>;
}

/** Verktygsrad: filter och åtgärder på en rad. `end` hamnar till höger. */
export function Toolbar({ children, end, label }: { children?: ReactNode; end?: ReactNode; label?: string }) {
  return <div className={styles.toolbar} role={label ? "toolbar" : undefined} aria-label={label}>
    {children}{end && <div className={styles.toolbarEnd}>{end}</div>}
  </div>;
}

/** Ett avsnitt med rubrik, kort hjälptext och åtgärder. Avsnitt skiljs åt med luft och en linje. */
export function Section({ title, help, actions, children, id, label, headingLevel = 2 }: {
  title?: ReactNode; help?: ReactNode; actions?: ReactNode; children?: ReactNode; id?: string | undefined; label?: string | undefined;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const headingId = id ? `${id}-title` : undefined;
  return <section className={styles.section} aria-labelledby={title ? headingId : undefined} aria-label={title ? undefined : label} id={id}>
    {(title || actions) && <div className={styles.sectionHead}>
      <div>{title && <Heading id={headingId}>{title}</Heading>}{help && <p className={styles.sectionHelp}>{help}</p>}</div>
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

/** Tomt läge: säger vad som saknas och vad man gör härnäst. */
export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return <div className={styles.empty}><strong>{title}</strong>{children}</div>;
}

/** Tät tabell med rubriker som följer med vid rullning. */
export function Table({ children, className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <div className={styles.tableWrap}><table className={join(styles.table, className)} {...props}>{children}</table></div>;
}

/** Klass för högerställda siffror i tabeller. */
export const numeric = styles.num;
