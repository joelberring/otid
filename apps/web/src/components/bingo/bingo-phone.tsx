"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bingoAdminViewSchema, type BingoAdminView } from "@o-tid/contracts";
import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { courseSettingBase } from "../../lib/course-setting-api";
import { raceHubPath } from "../../lib/public-race-format";
import { adminFetch } from "../../lib/retrying-fetch";
import { useTexts } from "../language-provider";
import { Notice } from "../ui";
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
  const change = async (enabled: boolean) => {
    setBusy(true); setFailed(false);
    try {
      const response = await adminFetch(`${courseSettingBase(raceId)}/bingo`, { method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ formatVersion: 1, enabled }) });
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
    {failed && <Notice tone="error" role="alert">{text.failed}</Notice>}
    {view?.enabled && !view.published && <p className={styles.muted} role="status">{text.notPublished}</p>}
    {view?.enabled && !georeferenced && <p className={styles.muted} role="alert">{text.noGeoreference}</p>}
    {view?.enabled && <div className={styles.row}>
      <Link href={`/admin/${encodeURIComponent(raceId)}/bingo`} target="_blank">{text.leader}</Link>
      <Link href={`${raceHubPath(view.shortCode)}/bingo`} target="_blank">{text.runnerPage}</Link>
    </div>}
  </section>;
}
