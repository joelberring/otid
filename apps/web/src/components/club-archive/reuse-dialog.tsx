"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clubArchiveEn } from "../../i18n/club-archive-en";
import { useTexts, useLocale } from "../language-provider";
import type { ClubArchiveEntryView } from "@o-tid/contracts";
import { clubArchiveSv } from "../../i18n/club-archive-sv";
import { alignedDocument, checkAlignment, controlsOutside } from "../../lib/club-archive-align";
import { fetchCourseFileBytes, reuseTraining, type ReuseStage } from "../../lib/club-archive-client";
import { Button, DateInput, Dialog, Field, Notice } from "../ui";
import { usePpen } from "./use-ppen";
import { CoursePreview, useRenderedVersion } from "./course-preview";
import styles from "./club-archive.module.css";

const today = () => new Date().toLocaleDateString("sv-SE");

/**
 * ADR-0194 beslut 4: "Använd igen". En ny träning (eller ett tillfälle i en grupp där kontot är ledare) med kartan och
 * banorna. Förvalet är kartans senaste version; är den en annan än banornas jämförs versionerna och banorna flyttas
 * ("Flytta banorna till senaste kartversionen") med förhandsvisning och, utan säker georeferens, förskjutning för hand.
 */
export function ReuseDialog({ view, initialFileId, onClose }: { view: ClubArchiveEntryView; initialFileId: string | undefined; onClose: () => void }) {
  const locale = useLocale();
  const clubArchiveText = useTexts(clubArchiveSv, clubArchiveEn);
  const align = useTexts(clubArchiveSv.align, clubArchiveEn.align);
  const text = useTexts(clubArchiveSv.reuse, clubArchiveEn.reuse);
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(view.entry.title);
  const [date, setDate] = useState(today());
  const [groupId, setGroupId] = useState("");
  const [fileId, setFileId] = useState(initialFileId ?? view.courseFiles[0]?.courseFileId ?? "");
  const file = view.courseFiles.find(candidate => candidate.courseFileId === fileId);
  const mapOfFile = file?.mapVersion ? view.maps.find(map => map.mapId === file.mapVersion!.mapId)
    : view.maps.find(map => map.versions.some(version => view.folderVersionIds.includes(version.versionId)));
  const versions = mapOfFile?.versions ?? [];
  const [versionId, setVersionId] = useState(mapOfFile?.latestVersionId ?? "");
  useEffect(() => { setVersionId(mapOfFile?.latestVersionId ?? ""); }, [mapOfFile?.latestVersionId, fileId]);
  const chosen = versions.find(version => version.versionId === versionId);
  const original = file?.mapVersion ?? null;
  const ppen = usePpen(view.clubId, file);
  const target = useRenderedVersion(view.clubId, chosen ? { versionId: chosen.versionId, fileName: chosen.fileName } : null);
  const moving = Boolean(file?.kind === "PPEN" && original && chosen && original.versionId !== chosen.versionId);
  const source = useRenderedVersion(view.clubId, moving && original ? { versionId: original.versionId, fileName: original.fileName } : null);
  const [offset, setOffset] = useState({ dx: 0, dy: 0 });
  const [step, setStep] = useState(1);
  const [accepted, setAccepted] = useState(false);
  useEffect(() => { setOffset({ dx: 0, dy: 0 }); setAccepted(false); }, [versionId, fileId]);
  const check = useMemo(() => moving && source?.state === "ready" && target?.state === "ready"
    ? checkAlignment(source.rendered.metadata, target.rendered.metadata) : undefined, [moving, source, target]);
  const document = useMemo(() => ppen && check ? alignedDocument(ppen.document, check, offset) : ppen?.document, [ppen, check, offset]);
  const outside = document && target?.state === "ready" ? controlsOutside(document, target.rendered.metadata.bounds) : false;
  const manual = check?.alignment.kind === "MANUAL";
  const [stage, setStage] = useState<ReuseStage | "done">();
  const [problem, setProblem] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());

  const waitingForCheck = moving && !check && source?.state !== "failed";
  const ready = name.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(date) && !stage && !waitingForCheck && (!manual || accepted)
    && (file?.kind !== "PPEN" || Boolean(ppen)) && (!chosen || target?.state !== "loading");

  async function start() {
    setProblem("");
    try {
      const course = !file ? null : file.kind === "PPEN" && ppen && document
        ? { kind: "PPEN" as const, fileName: file.fileName, ppen: ppen.ppen, document }
        : file.kind === "COURSE_DATA" ? { kind: "COURSE_DATA" as const, bytes: await fetchCourseFileBytes(view.clubId, file.courseFileId) } : null;
      const outcome = await reuseTraining({ clubId: view.clubId, requestId, eventName: name.trim(), raceDate: date, groupId: groupId || null,
        map: chosen ? { versionId: chosen.versionId, fileName: chosen.fileName } : null,
        rendered: target?.state === "ready" ? target.rendered : undefined, course }, next => setStage(next), clubArchiveText);
      if (outcome.kind === "failed") { setStage(undefined); setProblem(outcome.problem); return; }
      if (outcome.kind === "partial") {
        setStage(undefined);
        setProblem(text.failed[outcome.problem]);
        window.setTimeout(() => window.location.assign(`/admin/${outcome.raceId}/manage`), 2500);
        return;
      }
      setStage("done");
      window.location.assign(outcome.openCourseSetting ? `/admin/${outcome.raceId}/course-setting` : `/admin/${outcome.raceId}/manage`);
    } catch (error) {
      console.error("Använd igen misslyckades", error);
      setStage(undefined);
      setProblem(clubArchiveText.errors.generic(0));
    }
  }

  const nudge = (dx: number, dy: number) => setOffset(current => ({ dx: Math.round((current.dx + dx) * 10) / 10, dy: Math.round((current.dy + dy) * 10) / 10 }));
  return <Dialog dialogRef={dialog} className={styles.dialog} labelledBy="reuse-title" onClose={onClose}>
    <div className={styles.dialogBody}>
      <h2 id="reuse-title">{text.title}</h2>
      <p className={styles.muted}>{text.help}</p>
      <div className={styles.inline}>
        <Field label={text.eventName}><input value={name} maxLength={160} onChange={event => setName(event.target.value)} /></Field>
        <Field label={text.date}><DateInput value={date} onChange={event => setDate(event.target.value)} /></Field>
      </div>
      {view.groups.length > 0 && <Field label={text.target}>
        <select value={groupId} onChange={event => setGroupId(event.target.value)}>
          <option value="">{text.own}</option>
          {view.groups.map(group => <option key={group.groupId} value={group.groupId}>{text.group(group.name)}</option>)}
        </select></Field>}
      {view.courseFiles.length > 1 && <Field label={text.courseFile}>
        <select value={fileId} onChange={event => setFileId(event.target.value)}>
          {view.courseFiles.map(courseFile => <option key={courseFile.courseFileId} value={courseFile.courseFileId}>{courseFile.fileName}</option>)}
        </select></Field>}
      {versions.length > 0 && <Field label={text.mapVersion} help={text.latestDefault}>
        <select value={versionId} onChange={event => setVersionId(event.target.value)}>
          {versions.map(version => <option key={version.versionId} value={version.versionId}>
            {text.versionLabel(version.fileName, version.versionDate, version.versionId === mapOfFile?.latestVersionId)}</option>)}
        </select></Field>}
      {moving && <section aria-labelledby="align-title" className={styles.card}>
        <h3 id="align-title">{align.title}</h3>
        {!check && <p role="status">{source?.state === "failed" || target?.state === "failed" ? clubArchiveText.entry.previewFailed : align.checking}</p>}
        {check && <p role="status" className={manual ? styles.warning : undefined} data-testid="alignment">
          {check.alignment.kind === "MANUAL" ? align.MANUAL[check.alignment.reason] : align[check.alignment.kind]}</p>}
        {check?.extentChanged && <p className={styles.small}>{align.extentChanged}</p>}
        {outside && <p className={styles.warning}>{align.outside}</p>}
        <CoursePreview version={target} document={document} courseId={document?.courses[0]?.id} label={align.preview} />
        {manual && <>
          <div className={styles.actions}>
            <div className={styles.nudge} role="group" aria-label={align.offset(offset.dx, offset.dy)}>
              <span /><Button variant="secondary" aria-label={align.nudge.up} onClick={() => nudge(0, step)}>↑</Button><span />
              <Button variant="secondary" aria-label={align.nudge.left} onClick={() => nudge(-step, 0)}>←</Button>
              <Button variant="quiet" aria-label={align.nudge.reset} onClick={() => setOffset({ dx: 0, dy: 0 })}>0</Button>
              <Button variant="secondary" aria-label={align.nudge.right} onClick={() => nudge(step, 0)}>→</Button>
              <span /><Button variant="secondary" aria-label={align.nudge.down} onClick={() => nudge(0, -step)}>↓</Button><span />
            </div>
            <div>
              <p className={styles.small}>{align.offset(offset.dx, offset.dy)}</p>
              <label className={styles.small}>{align.step}{" "}
                <select value={step} onChange={event => setStep(Number(event.target.value))}>
                  {[0.2, 1, 5, 20].map(value => <option key={value} value={value}>{value.toLocaleString(locale)} mm</option>)}
                </select></label>
            </div>
          </div>
          <label className={styles.check}><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />{align.accept}</label>
        </>}
      </section>}
      {file?.kind === "COURSE_DATA" && chosen && original && chosen.versionId !== original.versionId && <p className={styles.small}>{align.courseDataNote}</p>}
      {stage && <p role="status">{stage === "done" ? text.done : text.working[stage]}</p>}
      {problem && <Notice tone="error" role="alert">{problem}</Notice>}
      <div className={styles.actions}>
        <Button disabled={!ready} onClick={() => void start()}>{text.start}</Button>
        <Button variant="secondary" disabled={Boolean(stage) && stage !== "done"} onClick={() => dialog.current?.close()}>{clubArchiveText.entry.cancel}</Button>
      </div>
    </div>
  </Dialog>;
}
