"use client";

import React from "react";
import { courseDataEn } from "../../i18n/course-setting-link-en";
import { useTexts } from "../language-provider";
import { courseDataSv } from "../../i18n/course-data-sv";
import { Button } from "../ui";
import styles from "./save-failed.module.css";

/**
 * Ägaren 2026-11-03: "om det blir fel eller om saker inte uppdateras ska det väl synas, men inte för mycket varningar".
 * En rad vid det som inte sparades, med Försök igen. Ingen ruta över sidan och inga notiser som staplas.
 */
export function SaveFailed({ onRetry, busy, message: chosen }: { onRetry?: (() => void) | undefined; busy?: boolean | undefined;
  message?: string | undefined }) {
  const text = useTexts(courseDataSv, courseDataEn), message = chosen ?? text.saveFailed;
  return <p className={styles.line} role="alert" data-testid="save-failed">
    <span>{message}</span>
    {onRetry && <Button variant="quiet" disabled={busy} onClick={onRetry}>{text.retry}</Button>}
  </p>;
}
