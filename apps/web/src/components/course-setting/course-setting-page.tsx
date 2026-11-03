"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { raceMapProblemSchema, type CourseSettingState } from "@o-tid/contracts";
import { emptyDocument } from "@o-tid/course-setting";
import { courseSettingSv as text } from "../../i18n/course-setting-sv";
import { collaborationSv as copy } from "../../i18n/course-setting-collaboration-sv";
import { offlineSv } from "../../i18n/course-setting-offline-sv";
import { raceMapSv } from "../../i18n/race-map-sv";
import { courseSettingBase, fetchCourseSetting, HttpError, importCourseSetting, saveCourseSetting } from "../../lib/course-setting-api";
import { readAccountCsrfCookie } from "../../lib/organizer-account-cookies";
import { usableRecord, type FieldRecord } from "../../lib/course-setting-offline";
import { fetchUntilReached } from "../../lib/retrying-fetch";
import { MapFileUpload } from "../race-administrator/map-file-upload";
import type { Message } from "../race-administrator/source-sync-actions";
import { Button, Notice } from "../ui";
import { CourseSettingEditor } from "./course-setting-editor";
import { PpenImport, type ReadFile } from "./course-setting-file";
import { fieldStore } from "./use-course-setting-offline";
import { forgetCourseSettingCopy } from "../../lib/course-setting-offline-forget";
import styles from "./course-setting.module.css";

/**
 * Steg 62 (ADR-0180): sidan `/admin/[raceId]/course-setting`. Hämtar läget; utan kartfil laddas den upp här (samma Worker
 * som i Karta och vägval), utan dokument läses en .ppen in eller börjar banläggaren tomt. Sedan editorn.
 *
 * Steg 67: posten i telefonen (`FieldRecord`) läses först. Väntande åtgärder från förra gången skickas när editorn öppnas;
 * utan nät (eller utloggad) öppnas editorn ur posten och ändringarna köas tills nätet och inloggningen finns.
 */
async function phoneRecord(raceId: string): Promise<FieldRecord | undefined> {
  try { return usableRecord(await fieldStore().readRecord(raceId), raceId); } catch (error) {
    console.error("Banläggningen i telefonen kunde inte läsas", error);
    return undefined;
  }
}
export function CourseSettingPage({ raceId }: { raceId: string }) {
  const [state, setState] = useState<CourseSettingState>();
  const [failed, setFailed] = useState<"login" | "other">();
  const [message, setMessage] = useState<Message>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [resume, setResume] = useState<{ record: FieldRecord; fromPhone: boolean }>();
  /** Läser läget; `active` säger om svaret fortfarande gäller (en ny editor monteras för varje läsning som gäller). */
  const load = useCallback(async (active: () => boolean = () => true) => {
    setFailed(undefined);
    const record = await phoneRecord(raceId);
    try {
      const fresh = await fetchCourseSetting(raceId);
      if (!active()) return;
      // Med nät gäller serverns läge; posten används bara för åtgärder som väntar.
      const pending = record && (record.log.length > 0 || record.inFlight) && fresh.setting ? record : undefined;
      setResume(pending ? { record: pending, fromPhone: false } : undefined);
      setState(fresh); setGeneration(value => value + 1);
    } catch (error) {
      if (!active()) return;
      // Utan nät (eller utloggad) öppnas banläggningen ur telefonen.
      const fromPhone = record && (!(error instanceof HttpError) || error.status === 401 || error.status >= 500);
      if (fromPhone) { setResume({ record, fromPhone: true }); setState(record.state); setGeneration(value => value + 1); return; }
      // Översynen 2026-11-02: ingen tillgång längre (403) – telefonens kopia av banläggningen tas bort.
      if (error instanceof HttpError && error.status === 403) {
        await forgetCourseSettingCopy(raceId).catch(problem => console.error("Kopian i telefonen kunde inte tas bort", problem));
      }
      setFailed(error instanceof HttpError && (error.status === 401 || error.status === 403) ? "login" : "other");
    }
  }, [raceId]);
  useEffect(() => {
    // Ett svar efter att effekten städats (t.ex. Reacts dubbla körning i utvecklingsläget) monterar inte om editorn: ett
    // klick mellan de två svaren gick annars förlorat.
    let active = true;
    void load(() => active);
    return () => { active = false; };
  }, [load]);

  async function uploadMapFile(form: FormData): Promise<Message | undefined> {
    const csrf = readAccountCsrfCookie(document.cookie, new URL(window.location.href));
    if (!csrf) return { tone: "error", text: raceMapSv.mapFile.failed };
    try {
      const response = await fetchUntilReached(`${courseSettingBase(raceId)}/map/source`, { method: "POST", credentials: "same-origin",
        headers: { "x-otid-csrf": csrf }, body: form });
      // Samma besked som i Karta och vägval: 422 säger vad som är fel med filen, annat är ett fel vid sparandet.
      if (response.status === 422) {
        const parsed = raceMapProblemSchema.safeParse(await response.json()).data;
        const problem = parsed?.error;
        return { tone: "error", text: problem === "MAP_FILE_TOO_LARGE" ? raceMapSv.mapFile.tooLarge
          : problem === "IMAGE_TOO_LARGE" ? raceMapSv.mapFile.errors.TOO_LARGE
          : problem === "STORAGE_QUOTA_EXCEEDED" ? raceMapSv.quota(parsed?.quota) : raceMapSv.mapFile.invalid };
      }
      if (!response.ok) {
        console.error("Kartfilen sparades inte", response.status, response.headers.get("content-type"));
        return { tone: "error", text: raceMapSv.mapFile.failed };
      }
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
        ...file.warnings.map(warning => `${warning.text.replace(/\.$/, "")}.`)].join(" ") : undefined);
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

  // Admin tillbaka till arbetsytan; den som bara har banläggningen till Mina tävlingar (arbetsytan är inte deras).
  const back = <Link className={styles.back} href={state && !state.access.admin ? "/organizer" : `/admin/${raceId}/manage`}>
    ← {state && !state.access.admin ? text.backToEvents : text.back}</Link>;
  if (failed) return <main className={styles.page}>{back}<Notice tone="error" role="alert"><p>{text.loadFailed}</p>
    {failed === "other" && <div><Button variant="secondary" onClick={() => void load()}>{text.retry}</Button></div>}</Notice></main>;
  if (!state) return <main className={styles.page}>{back}<p role="status">{text.loading}</p></main>;
  const setting = state.setting;
  // Steg 66: editorn fyller fönstret (egen rad överst med bakåtlänken).
  if (state.mapFile && setting) return <CourseSettingEditor key={`${generation}-${setting.version}`} raceId={raceId} state={{ ...state, setting }}
    notice={notice ?? (resume?.fromPhone ? offlineSv.openedFromPhone(resume.record.savedAt) : undefined)} resume={resume?.record}
    onReload={() => { setNotice(undefined); void load(); }} />;
  return <main className={styles.page}>
    <header className={styles.head}>{back}<h1>{text.title}</h1>{state.mapFile && <p>{state.mapFile.fileName} · 1:{state.mapFile.scale}</p>}</header>
    {!state.mapFile && <section className={styles.panel} aria-labelledby="course-setting-map-file">
      <h2 id="course-setting-map-file">{raceMapSv.mapFile.upload}</h2>
      <p>{text.noMapFile}</p>
      {state.access.admin ? <MapFileUpload disabled={busy} hasMap={false} upload={uploadMapFile} onMessage={setMessage} />
        : <p className={styles.muted}>{copy.waitForMap}</p>}
    </section>}
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
    {state.mapFile && <section className={styles.panel} aria-labelledby="course-setting-start">
      <h2 id="course-setting-start">{text.start.heading}</h2>
      {state.access.level === "EDIT" ? <>
        <p>{text.start.help}</p>
        <PpenImport onRead={first} busy={busy} />
        <div className={styles.row}><Button variant="secondary" disabled={busy} onClick={() => void empty()}>{text.start.empty}</Button></div>
      </> : <p className={styles.muted}>{copy.waitForStart}</p>}
    </section>}
  </main>;
}
