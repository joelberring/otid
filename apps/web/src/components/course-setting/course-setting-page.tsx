"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { CourseSettingState } from "@o-tid/contracts";
import { emptyDocument } from "@o-tid/course-setting";
import { courseSettingSv as text } from "../../i18n/course-setting-sv";
import { raceMapSv } from "../../i18n/race-map-sv";
import { courseSettingBase, fetchCourseSetting, HttpError, importCourseSetting, saveCourseSetting } from "../../lib/course-setting-api";
import { readAccountCsrfCookie } from "../../lib/organizer-account-cookies";
import { MapFileUpload } from "../race-administrator/map-file-upload";
import type { Message } from "../race-administrator/source-sync-actions";
import { Button, Notice } from "../ui";
import { CourseSettingEditor } from "./course-setting-editor";
import { PpenImport, type ReadFile } from "./course-setting-file";
import styles from "./course-setting.module.css";

/**
 * Steg 62 (ADR-0180): sidan `/admin/[raceId]/course-setting`. Hämtar läget; utan kartfil laddas den upp här (samma Worker
 * som i Karta och vägval), utan dokument läses en .ppen in eller börjar banläggaren tomt. Sedan editorn.
 */
export function CourseSettingPage({ raceId }: { raceId: string }) {
  const [state, setState] = useState<CourseSettingState>();
  const [failed, setFailed] = useState<"login" | "other">();
  const [message, setMessage] = useState<Message>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const load = useCallback(async () => {
    setFailed(undefined);
    try { setState(await fetchCourseSetting(raceId)); setGeneration(value => value + 1); }
    catch (error) { setFailed(error instanceof HttpError && (error.status === 401 || error.status === 403) ? "login" : "other"); }
  }, [raceId]);
  useEffect(() => { void load(); }, [load]);

  async function uploadMapFile(form: FormData): Promise<Message | undefined> {
    const csrf = readAccountCsrfCookie(document.cookie, new URL(window.location.href));
    if (!csrf) return { tone: "error", text: raceMapSv.mapFile.failed };
    try {
      const response = await fetch(`${courseSettingBase(raceId)}/map/source`, { method: "POST", credentials: "same-origin",
        headers: { "x-otid-csrf": csrf }, body: form });
      if (!response.ok) return { tone: "error", text: response.status === 413 ? raceMapSv.mapFile.tooLarge : raceMapSv.mapFile.invalid };
      await load();
      return { tone: "ok", text: text.mapSaved };
    } catch { return { tone: "error", text: raceMapSv.mapFile.failed }; }
  }

  async function first(file: ReadFile) {
    setBusy(true); setMessage(undefined);
    try {
      const outcome = await importCourseSetting(raceId, { document: file.document, expectedVersion: 0, fileName: file.fileName, ppen: file.ppen });
      if (outcome.kind === "too-large") { setMessage({ tone: "error", text: text.file.tooLarge }); return; }
      setNotice(outcome.kind === "saved" ? [text.file.imported(file.document.courses.length, Object.keys(file.document.controls).length),
        ...file.warnings.map(warning => warning.text)].join(" ") : undefined);
      await load();
    } catch { setMessage({ tone: "error", text: text.file.failed }); } finally { setBusy(false); }
  }

  async function empty() {
    if (!state?.mapFile) return;
    setBusy(true); setMessage(undefined);
    try {
      const document = emptyDocument({ title: text.start.emptyTitle, mapScale: state.mapFile.scale });
      const outcome = await saveCourseSetting(raceId, document, 0);
      if (outcome.kind === "too-large") { setMessage({ tone: "error", text: text.file.tooLarge }); return; }
      await load();
    } catch { setMessage({ tone: "error", text: text.file.failed }); } finally { setBusy(false); }
  }

  const back = <Link className={styles.back} href={`/admin/${raceId}/manage`}>{text.back}</Link>;
  if (failed) return <main className={styles.page}>{back}<Notice tone="error" role="alert"><p>{text.loadFailed}</p>
    {failed === "other" && <div><Button variant="secondary" onClick={() => void load()}>{text.retry}</Button></div>}</Notice></main>;
  if (!state) return <main className={styles.page}>{back}<p role="status">{text.loading}</p></main>;
  const setting = state.setting;
  return <main className={styles.page}>
    <header className={styles.head}>{back}<h1>{text.title}</h1>{state.mapFile && <p>{state.mapFile.fileName} · 1:{state.mapFile.scale}</p>}</header>
    {!state.mapFile && <section className={styles.panel} aria-labelledby="course-setting-map-file">
      <h2 id="course-setting-map-file">{raceMapSv.mapFile.upload}</h2>
      <p>{text.noMapFile}</p>
      <MapFileUpload disabled={busy} hasMap={false} upload={uploadMapFile} onMessage={setMessage} />
    </section>}
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
    {state.mapFile && !setting && <section className={styles.panel} aria-labelledby="course-setting-start">
      <h2 id="course-setting-start">{text.start.heading}</h2>
      <p>{text.start.help}</p>
      <PpenImport onRead={first} busy={busy} />
      <div className={styles.row}><Button variant="secondary" disabled={busy} onClick={() => void empty()}>{text.start.empty}</Button></div>
    </section>}
    {state.mapFile && setting && <CourseSettingEditor key={`${generation}-${setting.version}`} raceId={raceId} state={{ ...state, setting }}
      notice={notice} onReload={() => { setNotice(undefined); void load(); }} />}
  </main>;
}
