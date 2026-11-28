"use client";

import { useMapProjectFailure } from "./use-map-project-failure";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { mapProjectEn } from "../../i18n/map-project-en";
import { useLanguage, useTexts } from "../language-provider";
import { listEn } from "../../i18n/list-en";
import { listSv } from "../../i18n/list-sv";
import { recentDay } from "../../lib/human-date";
import Link from "next/link";
import type { MapProjectList, MapProjectSummary } from "@o-tid/contracts";
import { SWEDISH_TIME_ZONE } from "@o-tid/domain";
import { mapProjectSv } from "../../i18n/map-project-sv";
import { clubRequest, csrf } from "../../lib/club-request";
import { mapProjectsBase } from "../../lib/map-project-client";
import { Button, Field, ListRow, Notice, RowList } from "../ui";
import { MyMapStatsSection } from "./map-stats-sections";
import { NewMapProject } from "./new-map-project";
import styles from "./map-project.module.css";


const SHOW_CLOSED_KEY = "otid.mapProjects.showClosed";

/** Valet «Visa avslutade» minns webbläsaren; ett fel i lagringen (privat läge, spärrad) ger bara förvalet. */
function readShowClosed(): boolean {
  try { return window.localStorage.getItem(SHOW_CLOSED_KEY) === "1"; } catch { return false; }
}
function writeShowClosed(value: boolean): void {
  try { window.localStorage.setItem(SHOW_CLOSED_KEY, value ? "1" : "0"); } catch { /* valet gäller då bara tills sidan laddas om */ }
}

/** Filnamnet utan ändelse, för att se om det säger något mer än projektets namn. */
const stem = (fileName: string) => fileName.replace(/\.[A-Za-z0-9]{2,5}$/, "").trim().toLocaleLowerCase("sv");

/**
 * ADR-0219: kontots kartprojekt (som medlem, eller som administratör i projektets klubb), en ny karta och ett eget projekt från en fil.
 * Steg F2: en tät rad per projekt där hela raden är länken (ingen knapp per rad); sökrutan och «Nytt kartprojekt» överst.
 */
export function MyMapProjects() {
  const failure = useMapProjectFailure();
  const mapProjectText = useTexts(mapProjectSv, mapProjectEn);
  const text = useTexts(mapProjectSv.list, mapProjectEn.list);
  const words = useTexts(listSv, listEn);
  const language = useLanguage();
  const [list, setList] = useState<MapProjectList>();
  const [problem, setProblem] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => { setShowClosed(readShowClosed()); }, []);
  const closedCount = list?.projects.filter(project => project.status === "CLOSED").length ?? 0;
  // Listan kommer sorterad på senast använt (senast först, `listMapProjects`); här filtreras bara på avslutade och sökningen.
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("sv");
    return (list?.projects ?? []).filter(project => (showClosed || project.status === "OPEN")
      && (!needle || [project.name, project.club?.name ?? "", project.base.fileName].some(value => value.toLocaleLowerCase("sv").includes(needle))));
  }, [list, showClosed, query]);
  const toggleClosed = () => { setShowClosed(!showClosed); writeShowClosed(!showClosed); };
  useEffect(() => {
    void clubRequest(mapProjectsBase).then(result => {
      if (result.status === 200) setList(result.json as MapProjectList);
      else setProblem(failure(result.status));
    });
  }, []);
  const now = new Date();
  const meta = (project: MapProjectSummary) => {
    const used = recentDay(project.lastActiveAt, language, SWEDISH_TIME_ZONE, now);
    return [project.club?.name ?? text.own,
      used.kind === "date" ? used.text : used.kind === "today" ? words.today : words.yesterday,
      project.changedObjects > 0 ? text.changed(project.changedObjects) : "",
      project.role === "OWNER" ? "" : mapProjectText.roles[project.role],
      project.status === "CLOSED" ? text.closed : "",
      project.base.fileName && stem(project.base.fileName) !== project.name.trim().toLocaleLowerCase("sv") ? project.base.fileName : ""
    ].filter(Boolean).join(" · ");
  };
  return <main className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.kicker}><Link href="/organizer">{text.back}</Link></p><h1>{text.title}</h1></div>
    </header>
    <p className={styles.muted}>{text.hint}</p>
    <div className={styles.listBar}>
      {list && list.projects.length > 0 && <input type="search" value={query} maxLength={120} aria-label={text.search}
        placeholder={text.searchPlaceholder} onChange={event => setQuery(event.target.value)} data-testid="map-projects-search" />}
      {/* Översynen 2026-11-17: «Nytt kartprojekt» syns direkt, också när listan är lång (formulären står längst ned). */}
      <Link className={styles.buttonLink} href="#nytt-kartprojekt" data-testid="map-projects-new">{text.newProject}</Link>
    </div>
    {problem && <Notice tone="error" role="alert">{problem}</Notice>}
    {list && list.projects.length === 0 && <p className={styles.muted}>{text.empty}</p>}
    {list && list.projects.length > 0 && <>
      {shown.length === 0 && <p className={styles.muted}>{query.trim() ? text.noMatch : text.noActive}</p>}
      {shown.length > 0 && <RowList testId="map-projects" label={text.title}>
        {shown.map(project => <ListRow key={project.projectId} href={`/organizer/map-projects/${project.projectId}`} title={project.name}
          meta={meta(project)} testId="map-project-row" />)}
      </RowList>}
      {(closedCount > 0 || showClosed) && <p className={styles.closedToggle}><Button variant="quiet" aria-pressed={showClosed} onClick={toggleClosed}
        data-testid="map-projects-toggle-closed">{showClosed ? text.hideClosed : text.showClosed(closedCount)}</Button></p>}
    </>}
    {!problem && <div className={`${styles.sections} ${styles.afterList}`}><NewMapProject /><UploadProject /><MyMapStatsSection /></div>}
  </main>;
}


/** Nytt eget projekt (ingen klubb) från en kartfil; filen strömmas som kroppen och uppgifterna står i rubrikerna. */
function UploadProject() {
  const failure = useMapProjectFailure();
  const upload = useTexts(mapProjectSv.upload, mapProjectEn.upload);
  const [typedName, setName] = useState("");
  const [chosenFile, setFile] = useState<File>();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function start(event: FormEvent) {
    event.preventDefault();
    // Ägaren 2026-11-13 («det verkar inte gå att starta ett kartprojekt från fil»): webbläsaren kan fylla i formuläret själv
    // (tillbaka-knappen, omladdning) utan att sidan får veta det, och då stod knappen grå med fil och namn ifyllda. Filen och
    // namnet läses därför ur formuläret när det skickas.
    const form = event.currentTarget as HTMLFormElement;
    const file = chosenFile ?? form.querySelector<HTMLInputElement>("input[type=file]")?.files?.[0];
    const name = (typedName.trim() || form.querySelector<HTMLInputElement>("input:not([type=file])")?.value.trim() || file?.name.replace(/\.[A-Za-z0-9]{2,5}$/, "") || "").slice(0, 120);
    if (!file || !name) { setMessage(upload.missing); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${mapProjectsBase}/upload`, { method: "POST", credentials: "same-origin", body: file,
        headers: { "content-type": "application/octet-stream", "x-otid-csrf": csrf() ?? "", "x-otid-request-id": requestId,
          "x-otid-name": encodeURIComponent(name), "x-otid-file-name": encodeURIComponent(file.name.slice(0, 200)) } });
      if (response.status === 200 || response.status === 201) {
        const body = await response.json() as { projectId: string };
        window.location.assign(`/organizer/map-projects/${encodeURIComponent(body.projectId)}`);
        return;
      }
      setRequestId(crypto.randomUUID());
      const error = response.status === 422 ? (await response.json().catch(() => ({})) as { error?: string }).error : undefined;
      setMessage(error === "MAP_FILE_TOO_LARGE" ? upload.tooLarge : error === "UNSUPPORTED_MAP_FILE" ? upload.unsupported
        : error === "STORAGE_QUOTA_EXCEEDED" ? upload.quota : failure(response.status));
    } catch { setMessage(upload.network); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="map-project-upload">
    <h2 id="map-project-upload">{upload.title}</h2>
    <p className={styles.muted}>{upload.help}</p>
    <form className={styles.form} onSubmit={event => void start(event)} aria-label={upload.title}>
      <Field label={upload.name}><input value={typedName} maxLength={120} required onChange={event => setName(event.target.value)} /></Field>
      <Field label={upload.file}><input type="file" accept=".omap,.xmap,.ocd" required
        onChange={event => {
          const chosen = event.target.files?.[0];
          setFile(chosen);
          if (chosen && !typedName.trim()) setName(chosen.name.replace(/\.[A-Za-z0-9]{2,5}$/, "").slice(0, 120));
        }} /></Field>
      <div className={styles.actions}><Button type="submit" disabled={busy} aria-busy={busy}>{busy ? upload.working : upload.button}</Button></div>
      {message && <Notice tone="error" role="alert">{message}</Notice>}
    </form>
  </section>;
}
