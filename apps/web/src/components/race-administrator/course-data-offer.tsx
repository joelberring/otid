"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CourseSettingState } from "@o-tid/contracts";
import type { CourseSettingDocument } from "@o-tid/course-setting";
import { courseDataSv } from "../../i18n/course-data-sv";
import { courseSettingFromCourseData, keepEventSettings, rememberCourseSettingNotice } from "../../lib/course-data-course-setting";
import { fetchCourseSetting, saveCourseSetting } from "../../lib/course-setting-api";
import { saveOnLatest } from "../../lib/course-setting-save-latest";
import { SaveFailed } from "../course-setting/save-failed";
import { Button } from "../ui";
import styles from "./sources.module.css";

const text = courseDataSv.offer;

/**
 * Banor → Banfil, efter att banfilen lästs in i tävlingen: har tävlingen en kartfil för banläggningen erbjuds banfilens banor
 * där också, så att starten och kontrollerna går att flytta på kartan. Finns redan en banläggning ersätts den bara efter en
 * fråga, och den gamla blir en tidigare version (Fil → Tidigare versioner).
 */
export function CourseDataOffer({ raceId, file }: { raceId: string; file: { readonly name: string; readonly bytes: ArrayBuffer } }) {
  const [state, setState] = useState<CourseSettingState | "none">();
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState<"idle" | "working" | "done" | "failed">("idle");
  const [problem, setProblem] = useState<string>();
  const [notices, setNotices] = useState<readonly string[]>([]);
  useEffect(() => {
    let active = true;
    fetchCourseSetting(raceId).then(fresh => { if (active) setState(fresh); }, () => { if (active) setState("none"); });
    return () => { active = false; };
  }, [raceId]);
  if (!state || state === "none" || !state.mapFile || state.access.level !== "EDIT") return null;
  const mapScale = state.mapFile.scale;
  const existing = state.setting !== null;

  async function apply(replace: boolean) {
    setPhase("working"); setProblem(undefined); setConfirming(false);
    const converted = courseSettingFromCourseData(new Uint8Array(file.bytes), { mapScale });
    if (converted.kind === "problem") { setProblem(converted.text); setPhase("idle"); return; }
    let appeared = false;
    let current: CourseSettingState | undefined;
    const result = await saveOnLatest({
      latest: async () => {
        current = await fetchCourseSetting(raceId);
        // Någon annan började banläggningen under tiden: den ersätts inte utan frågan.
        if (!replace && current.setting) { appeared = true; return undefined; }
        return current.setting?.version ?? 0;
      },
      attempt: async version => {
        const outcome = await saveCourseSetting(raceId, keepEventSettings(converted.document, current?.setting?.document as unknown as CourseSettingDocument | undefined), version);
        return outcome.kind === "saved" ? "saved" : outcome.kind === "conflict" ? "conflict" : "rejected";
      }
    });
    if (appeared && current) { setState(current); setPhase("idle"); return; }
    if (!result.saved) { setPhase("failed"); return; }
    rememberCourseSettingNotice(raceId, converted.notices.join(" "));
    setNotices(converted.notices.slice(1));
    setPhase("done");
  }

  return <div className={styles.block} data-testid="course-data-offer" aria-labelledby={`course-data-offer-${raceId}`}>
    <h3 id={`course-data-offer-${raceId}`}>{text.heading}</h3>
    {phase === "done" ? <>
      <p role="status">{text.done}</p>
      {notices.map(notice => <p key={notice}>{notice}</p>)}
      <div className={styles.actions}><Link href={`/admin/${raceId}/course-setting`}>{text.open}</Link></div>
    </> : <>
      <p>{existing ? text.existing : text.empty}</p>
      {confirming ? <div role="group" aria-label={text.replace}>
        <p>{text.confirm}</p>
        <div className={styles.actions}>
          <Button onClick={() => void apply(true)}>{text.confirmYes}</Button>
          <Button variant="secondary" onClick={() => setConfirming(false)}>{text.cancel}</Button>
        </div>
      </div> : <div className={styles.actions}>
        <Button variant="secondary" disabled={phase === "working"} onClick={() => existing ? setConfirming(true) : void apply(false)}>
          {existing ? text.replace : text.create}</Button>
      </div>}
      {phase === "working" && <p role="status">{text.working}</p>}
      {problem && <p role="alert">{problem}</p>}
      {phase === "failed" && <SaveFailed onRetry={() => void apply(existing)} />}
    </>}
  </div>;
}
