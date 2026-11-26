"use client";

import { useEffect, useState } from "react";
import { mapBankEn } from "../../i18n/map-bank-en";
import { mapBankSv } from "../../i18n/map-bank-sv";
import { updateRaceMapDownloadLock } from "../../lib/course-setting-map-upload";
import { useTexts } from "../language-provider";
import sharingStyles from "../map-bank/map-sharing-panel.module.css";
import { Notice } from "../ui";
import styles from "./course-setting.module.css";

/**
 * Nedladdningsspärrstatus + växlare i tävlingens kartinställningar (banläggning & Karta och vägval).
 * När spärren är ärvd från klubbarkiv/kartprojekt/kartbank (`lockedByOrigin`) är växlaren låst med tydlig förklaring.
 */
export function RaceMapProtectionPanel({
  raceId,
  locked,
  lockedByOrigin,
  admin,
  headingLevel = "h2",
  onChanged
}: {
  raceId: string;
  locked: boolean;
  lockedByOrigin: boolean;
  admin: boolean;
  headingLevel?: ("h2" | "h3") | undefined;
  onChanged?: ((next: { sourceDownloadLocked: boolean; sourceDownloadLockedByOrigin: boolean }) => Promise<void> | void) | undefined;
}) {
  const mapBankText = useTexts(mapBankSv, mapBankEn);
  const text = mapBankText.raceMapLock;
  const [currentLocked, setCurrentLocked] = useState(locked);
  const [currentOrigin, setCurrentOrigin] = useState(lockedByOrigin);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();

  useEffect(() => {
    setCurrentLocked(locked);
    setCurrentOrigin(lockedByOrigin);
  }, [locked, lockedByOrigin]);

  async function toggle(next: boolean) {
    if (!admin || currentOrigin) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await updateRaceMapDownloadLock(raceId, next);
      if (!result.ok) {
        setMessage({ tone: "error", text: text.saveError });
        return;
      }
      setCurrentLocked(result.sourceDownloadLocked);
      setCurrentOrigin(result.sourceDownloadLockedByOrigin);
      setMessage({ tone: "ok", text: text.saved });
      await onChanged?.({ sourceDownloadLocked: result.sourceDownloadLocked, sourceDownloadLockedByOrigin: result.sourceDownloadLockedByOrigin });
    } finally {
      setBusy(false);
    }
  }

  const headingId = `race-map-lock-${raceId}`;
  return (
    <section className={styles.panel} aria-labelledby={headingId} data-testid="race-map-protection-panel">
      {headingLevel === "h2" ? <h2 id={headingId}>{text.heading}</h2> : <h3 id={headingId}>{text.heading}</h3>}
      <div className={sharingStyles.policyBadges}>
        <span
          className={sharingStyles.policyBadge}
          data-tone={currentLocked ? "locked" : "muted"}
          data-testid="race-map-lock-badge"
        >
          {currentLocked ? mapBankText.badges.downloadLocked : text.statusAllowed}
        </span>
      </div>
      {currentOrigin && (
        <Notice tone="attention" role="status">
          <span data-testid="race-map-lock-origin-note">{text.inheritedFromOrigin}</span>
        </Notice>
      )}
      {admin ? (
        <label className={sharingStyles.checkRow} data-testid="race-map-lock-control">
          <input
            type="checkbox"
            checked={currentLocked}
            disabled={busy || currentOrigin}
            data-testid="race-map-lock-toggle"
            onChange={event => void toggle(event.target.checked)}
          />
          <span>{text.toggleLabel}</span>
        </label>
      ) : (
        <p className={styles.muted} data-testid="race-map-lock-readonly">
          {currentLocked ? text.readOnlyLocked : text.readOnlyAllowed}
        </p>
      )}
      {message && (
        <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>
          {message.text}
        </Notice>
      )}
    </section>
  );
}
