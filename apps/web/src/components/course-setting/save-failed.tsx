"use client";

import React from "react";
import { courseDataSv as text } from "../../i18n/course-data-sv";
import { Button } from "../ui";
import styles from "./save-failed.module.css";

/**
 * Ägaren 2026-11-03: "om det blir fel eller om saker inte uppdateras ska det väl synas, men inte för mycket varningar".
 * En rad vid det som inte sparades, med Försök igen. Ingen ruta över sidan och inga notiser som staplas.
 */
export function SaveFailed({ onRetry, busy, message = text.saveFailed }: { onRetry?: (() => void) | undefined; busy?: boolean | undefined;
  message?: string | undefined }) {
  return <p className={styles.line} role="alert" data-testid="save-failed">
    <span>{message}</span>
    {onRetry && <Button variant="quiet" disabled={busy} onClick={onRetry}>{text.retry}</Button>}
  </p>;
}
