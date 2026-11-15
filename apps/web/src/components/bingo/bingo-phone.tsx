"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bingoAdminViewSchema, type BingoAdminView, type BingoMode, type VirtualSettings } from "@o-tid/contracts";
import { parseControlPoints } from "@o-tid/domain";
import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { courseSettingBase } from "../../lib/course-setting-api";
import { raceHubPath } from "../../lib/public-race-format";
import { adminFetch } from "../../lib/retrying-fetch";
import { useTexts } from "../language-provider";
import { Button, Notice } from "../ui";
import styles from "../course-setting/course-setting-training.module.css";

/**
 * Bingo med telefonen i banläggningens bingo (ADR-0225): av eller på (bara tävlingens administratör), om träningen är
 * publicerad och kartan georefererad, och länkarna till löparnas sida och ledarens vy.
 */
export function BingoPhone({ raceId, georeferenced }: { raceId: string; georeferenced: boolean }) {
  const text = useTexts(bingoSv.phone, bingoEn.phone);
  const [view, setView] = useState<BingoAdminView>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false;
    void fetch(`${courseSettingBase(raceId)}/bingo`, { credentials: "same-origin", cache: "no-store" })
      .then(async response => { if (response.ok && !stopped) setView(bingoAdminViewSchema.parse(await response.json())); })
      .catch((error: unknown) => console.warn("Bingons läge kunde inte hämtas", error));
    return () => { stopped = true; };
  }, [raceId]);
  const change = async (enabled: boolean, mode?: BingoMode, settings?: VirtualSettings) => {
    setBusy(true); setFailed(false);
    try {
      const response = await adminFetch(`${courseSettingBase(raceId)}/bingo`, { method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ formatVersion: 1, enabled, ...(mode ? { mode } : {}),
          ...(settings ? { settings } : {}) }) });
      if (!response.ok) throw new Error(String(response.status));
      setView(bingoAdminViewSchema.parse(await response.json()));
    } catch (error) { console.warn("Bingon med telefonen kunde inte sparas", error); setFailed(true); }
    finally { setBusy(false); }
  };
  return <section className={styles.block} aria-labelledby="bingo-phone" data-testid="bingo-phone">
    <h4 id="bingo-phone" className={styles.muted}>{text.heading}</h4>
    <p className={styles.muted}>{text.help}</p>
    <label className={styles.check}><input type="checkbox" checked={view?.enabled ?? false} disabled={busy || !view}
      onChange={event => void change(event.target.checked)} data-testid="bingo-phone-on" /><span>{text.on}</span></label>
    {view?.enabled && <label className={styles.stack}>{text.mode}<select value={view.mode} disabled={busy}
      onChange={event => void change(true, event.target.value as BingoMode)} data-testid="bingo-mode">
      <option value="BINGO">{text.modes.BINGO}</option><option value="SHIPS">{text.modes.SHIPS}</option>
      <option value="CONTROLS">{text.modes.CONTROLS}</option></select></label>}
    {view?.enabled && view.mode === "CONTROLS" && view.settings && <VirtualSettingsForm settings={view.settings} busy={busy}
      onSave={settings => void change(true, "CONTROLS", settings)} />}
    {failed && <Notice tone="error" role="alert">{text.failed}</Notice>}
    {view?.enabled && !view.published && <p className={styles.muted} role="status">{text.notPublished}</p>}
    {view?.enabled && !georeferenced && <p className={styles.muted} role="alert">{text.noGeoreference}</p>}
    {view?.enabled && <div className={styles.row}>
      <Link href={`/admin/${encodeURIComponent(raceId)}/bingo`} target="_blank">{text.leader}</Link>
      <Link href={`${raceHubPath(view.shortCode)}/bingo`} target="_blank">{text.runnerPage}</Link>
    </div>}
  </section>;
}

/** Virtuella kontroller (ADR-0226): radien, sättet att stämpla och poäng per kod. */
function VirtualSettingsForm({ settings, busy, onSave }: { settings: VirtualSettings; busy: boolean; onSave: (settings: VirtualSettings) => void }) {
  const text = useTexts(bingoSv.virtual, bingoEn.virtual);
  const [radius, setRadius] = useState(String(settings.radiusM));
  const [punch, setPunch] = useState(settings.punch);
  const [points, setPoints] = useState(Object.entries(settings.points).map(([code, value]) => `${code}=${value}`).join(", "));
  const parsed = parseControlPoints(points);
  const radiusM = Math.round(Number(radius));
  const valid = parsed !== undefined && radiusM >= 5 && radiusM <= 100;
  return <div className={styles.item} data-testid="virtual-settings">
    <label className={styles.stack}>{text.radius}<input type="number" min={5} max={100} value={radius} onChange={event => setRadius(event.target.value)} /></label>
    <fieldset className={styles.stack}><legend>{text.punchMethod}</legend>
      {(["AUTO", "BUTTON"] as const).map(value => <label key={value} className={styles.check}><input type="radio" name="virtual-punch" checked={punch === value}
        onChange={() => setPunch(value)} /><span>{value === "AUTO" ? text.punchAuto : text.punchButton}</span></label>)}</fieldset>
    <label className={styles.stack}>{text.pointsPerControl}<input type="text" value={points} onChange={event => setPoints(event.target.value)} /></label>
    <span className={styles.muted} role={parsed === undefined ? "alert" : undefined}>{parsed === undefined ? text.pointsInvalid : text.pointsHelp}</span>
    <Button variant="secondary" disabled={busy || !valid} onClick={() => onSave({ radiusM, punch, points: parsed ?? {} })}>{text.save}</Button>
  </div>;
}
