import type { ReactNode } from "react";
import styles from "./map-project-editor.module.css";

/**
 * Översynen av kartstegen 2026-11-17 (ägaren: «undermenyer av samma storlek»): ett huvudsteg under «Underlag och grundkarta».
 * Numret och rubriken (h3) står ut med typografin; det som hör till steget står indraget under, så att huvudsteg och val inom
 * ett steg inte ser likadana ut.
 */
export function MapProjectStep({ number, title, help, label, testId, children }: { number: number; title: string; help: string;
  /** «Steg 1» för skärmläsaren (numret syns som en ring). */
  label: string; testId: string; children: ReactNode }) {
  return <section className={styles.step} aria-labelledby={`${testId}-title`} data-testid={testId}>
    <h3 id={`${testId}-title`} className={styles.stepTitle}>
      <span className={styles.stepNumber} aria-hidden="true">{number}</span>
      <span className={styles.srOnly}>{label}: </span>{title}
    </h3>
    <p className={styles.stepHelp}>{help}</p>
    <div className={styles.stepBody}>{children}</div>
  </section>;
}
