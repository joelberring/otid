"use client";

import { useMapProjectFailure } from "./use-map-project-failure";
import { useEffect, useState, type FormEvent } from "react";
import { mapProjectEn } from "../../i18n/map-project-en";
import { useTexts } from "../language-provider";
import Link from "next/link";
import type { MapProjectList } from "@o-tid/contracts";
import { mapProjectSv } from "../../i18n/map-project-sv";
import { clubRequest, csrf } from "../../lib/club-archive-client";
import { mapProjectsBase } from "../../lib/map-project-client";
import { AccountMenu } from "../account-menu";
import { Button, Field, Notice } from "../ui";
import { MyMapStatsSection } from "./map-stats-sections";
import { NewMapProject } from "./new-map-project";
import styles from "./map-project.module.css";


/** ADR-0219: kontots kartprojekt (som medlem, eller som administratör i projektets klubb), en ny karta och ett eget projekt från en fil. */
export function MyMapProjects() {
  const failure = useMapProjectFailure();
  const mapProjectText = useTexts(mapProjectSv, mapProjectEn);
  const text = useTexts(mapProjectSv.list, mapProjectEn.list);
  const [list, setList] = useState<MapProjectList>();
  const [problem, setProblem] = useState("");
  useEffect(() => {
    void clubRequest(mapProjectsBase).then(result => {
      if (result.status === 200) setList(result.json as MapProjectList);
      else setProblem(failure(result.status));
    });
  }, []);
  return <main className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.kicker}><Link href="/organizer">{text.back}</Link></p><h1>{text.title}</h1></div>
      <AccountMenu />
    </header>
    <p className={styles.muted}>{text.hint}</p>
    {problem && <Notice tone="error" role="alert">{problem}</Notice>}
    {list && list.projects.length === 0 && <p className={styles.muted}>{text.empty}</p>}
    {list && list.projects.length > 0 && <ul className={styles.list} data-testid="map-projects">
      {list.projects.map(project => <li key={project.projectId}>
        <div><Link href={`/organizer/map-projects/${project.projectId}`}>{project.name}</Link>
          <span>{[project.club?.name ?? text.own, project.base.fileName, mapProjectText.roles[project.role], text.changed(project.changedObjects),
            project.status === "CLOSED" ? text.closed : ""].filter(Boolean).join(" · ")}</span></div>
      </li>)}
    </ul>}
    {!problem && <div className={styles.sections}><MyMapStatsSection /><NewMapProject /><UploadProject /></div>}
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
