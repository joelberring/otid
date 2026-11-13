"use client";

import { useEffect, useRef, useState } from "react";
import type { MapProjectList, RaceMapProjectLinkState } from "@o-tid/contracts";
import { courseSettingMapProjectEn } from "../../i18n/course-setting-map-project-en";
import { courseSettingMapProjectSv } from "../../i18n/course-setting-map-project-sv";
import { raceMapSv } from "../../i18n/race-map-sv";
import { raceMapEn } from "../../i18n/workspace-small-en";
import type { Texts } from "../../lib/language";
import {
  applyMapProjectToRace, fetchMapProjectChoices, fetchRaceMapProjectLink, type MapProjectRaceOutcome, type MapProjectRaceStage
} from "../../lib/map-project-race-client";
import { useTexts } from "../language-provider";
import { Button, Notice } from "../ui";
import styles from "./course-setting.module.css";

/**
 * Ägarens plan 2026-11-13, etapp 1: banläggningens karta ur ett kartprojekt. `MapProjectToRace` väljer projektet där
 * kartfilen annars laddas upp; `useCourseSettingMapProject` visar i editorn vilket projekt och vilken version kartan kommer
 * ur, om projektet har nyare ändringar, och «Ta in kartans ändringar». Kartan under banorna byts bara när någon väljer det.
 */
type Project = MapProjectList["projects"][number];
type Link = NonNullable<RaceMapProjectLinkState["link"]>;
type Say = (message: { tone: "ok" | "error" | "attention"; text: string }) => void;

function problemText(outcome: Exclude<MapProjectRaceOutcome, { kind: "ok" }>, text: Texts<typeof courseSettingMapProjectSv.errors>,
  mapErrors: Texts<typeof raceMapSv.mapFile.errors>): string {
  return outcome.kind === "render" ? mapErrors[outcome.code] : text[outcome.kind];
}

/** Banläggningens start: välj ett av kontots kartprojekt som karta. Utan kartprojekt visas ingenting. */
export function MapProjectToRace({ raceId, disabled, onSaved, onMessage }: { raceId: string; disabled: boolean; onSaved: () => Promise<void>;
  onMessage: (message: { tone: "ok" | "error"; text: string } | undefined) => void }) {
  const text = useTexts(courseSettingMapProjectSv, courseSettingMapProjectEn);
  const mapErrors = useTexts(raceMapSv.mapFile.errors, raceMapEn.mapFile.errors);
  const [projects, setProjects] = useState<Project[] | null>();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<MapProjectRaceStage>();
  useEffect(() => {
    let active = true;
    void fetchMapProjectChoices().then(rows => { if (active) setProjects(rows ?? null); })
      .catch((error: unknown) => { console.error("Kartprojekten kunde inte hämtas", error); if (active) setProjects(null); });
    return () => { active = false; };
  }, []);
  async function use(project: Project) {
    onMessage(undefined);
    try {
      const outcome = await applyMapProjectToRace(project.projectId, raceId, setStage);
      if (outcome.kind !== "ok") { onMessage({ tone: "error", text: problemText(outcome, text.errors, mapErrors) }); return; }
      onMessage({ tone: "ok", text: text.picker.saved(project.name) });
      setOpen(false);
      await onSaved();
    } catch (error) {
      console.error("Kartprojektets karta kunde inte bli tävlingens", error);
      onMessage({ tone: "error", text: text.errors.failed });
    } finally { setStage(undefined); }
  }
  if (projects === null) return <Notice tone="error" role="alert">{text.picker.loadFailed}</Notice>;
  if (!projects || projects.length === 0) return null;
  const busy = disabled || stage !== undefined;
  return <div className={styles.panel} data-testid="map-project-picker">
    <h3>{text.picker.heading}</h3>
    <div className={styles.row}>
      <Button variant="secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? text.picker.close : text.picker.open}</Button>
    </div>
    {open && <>
      <p className={styles.muted}>{text.picker.help}</p>
      <ul className={styles.mapProjects}>{projects.map(project => <li key={project.projectId} data-testid="map-project-choice">
        <span><strong>{project.name}</strong>{" "}
          <span className={styles.muted}>{[project.club ? text.picker.club(project.club.name) : undefined, text.picker.changes(project.changedObjects),
            project.status === "CLOSED" ? text.picker.closed : undefined].filter(Boolean).join(" · ")}</span></span>
        <Button variant="secondary" disabled={busy} aria-label={text.picker.useProject(project.name)} onClick={() => void use(project)}>
          {text.picker.use}</Button>
      </li>)}</ul>
    </>}
    {stage && <p role="status">{text.working[stage]}</p>}
  </div>;
}

/**
 * Editorn: läser kopplingen när banläggningen öppnas (inget utan nät), säger till när projektet har nyare ändringar och ger
 * rutan under Inställningar. `flush` skickar det osparade innan kartan byts; `onReload` läser banläggningen på nytt efteråt.
 */
export function useCourseSettingMapProject({ raceId, say, flush, onReload }: { raceId: string; say: Say; flush: () => Promise<boolean>;
  onReload: () => void }) {
  const text = useTexts(courseSettingMapProjectSv, courseSettingMapProjectEn);
  const mapErrors = useTexts(raceMapSv.mapFile.errors, raceMapEn.mapFile.errors);
  const [link, setLink] = useState<Link>();
  const [confirming, setConfirming] = useState(false);
  const [stage, setStage] = useState<MapProjectRaceStage>();
  // Beskedet sägs en gång när banläggningen öppnas, med texterna som gällde då.
  const told = useRef({ say, toast: text.panel.toast });
  useEffect(() => {
    let active = true;
    // Utan nät finns inget att fråga om (banläggningen öppnas då ur telefonen); frågan ställs nästa gång den öppnas.
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    void fetchRaceMapProjectLink(raceId).then(found => {
      if (!active || !found) return;
      setLink(found);
      if (found.newerChanges > 0 && found.canUpdate) told.current.say({ tone: "attention", text: told.current.toast(found.newerChanges, found.projectName) });
    }).catch((error: unknown) => console.warn("Kartprojektets koppling kunde inte läsas", error));
    return () => { active = false; };
  }, [raceId]);
  async function update(current: Link) {
    try {
      // Det osparade skickas först: kartan byts aldrig under ändringar som inte kommit fram.
      if (!await flush()) { say({ tone: "error", text: text.errors.failed }); return; }
      const outcome = await applyMapProjectToRace(current.projectId, raceId, setStage);
      if (outcome.kind !== "ok") { say({ tone: "error", text: problemText(outcome, text.errors, mapErrors) }); return; }
      say({ tone: "ok", text: text.panel.updated(outcome.seq) });
      setConfirming(false);
      onReload();
    } catch (error) {
      console.error("Kartans ändringar kunde inte tas in", error);
      say({ tone: "error", text: text.errors.failed });
    } finally { setStage(undefined); }
  }
  const busy = stage !== undefined;
  const panel = link ? <section className={styles.panel} aria-labelledby="course-setting-map-project" data-testid="course-setting-map-project"
    data-seq={link.seq} data-newer={link.newerChanges}>
    <h2 id="course-setting-map-project">{text.panel.heading}</h2>
    <p>{text.panel.from(link.projectName)}{link.member && <>{" "}
      <a className={styles.back} href={`/organizer/map-projects/${link.projectId}`}>{text.panel.openProject}</a></>}</p>
    <p className={styles.muted}>{text.panel.version(link.seq, link.linkedAt)}</p>
    {link.newerChanges === 0 ? <p className={styles.muted}>{text.panel.upToDate}</p> : <>
      <p><strong data-testid="course-setting-map-project-newer">{text.panel.newer(link.newerChanges)}</strong></p>
      {!link.canUpdate ? <p className={styles.muted}>{text.panel.notAllowed}</p>
        : !confirming ? <div className={styles.row}><Button variant="secondary" onClick={() => setConfirming(true)}>{text.panel.update}</Button></div>
          : <Notice tone="attention"><p>{text.panel.confirm}</p>
            <div className={styles.row}>
              <Button variant="primary" disabled={busy} onClick={() => void update(link)}>{text.panel.confirmUpdate}</Button>
              <Button variant="quiet" disabled={busy} onClick={() => setConfirming(false)}>{text.panel.cancel}</Button>
            </div></Notice>}
    </>}
    {stage && <p role="status">{text.working[stage]}</p>}
  </section> : null;
  return { panel };
}
