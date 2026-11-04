import type { ReactNode } from "react";
import styles from "./course-setting-print-page.module.css";

/** Ett avsnitt som sällan behövs, hopfällt (ADR-0211 tillägg); öppet från början när det har något. */
export function Fold({ title, open, testId, children }: { title: string; open: boolean; testId: string; children: ReactNode }) {
  return <details className={styles.fold} open={open || undefined} data-testid={testId}><summary>{title}</summary>{children}</details>;
}
