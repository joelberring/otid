"use client";

import { useState, type FormEvent } from "react";
import { mapProjectSv } from "../../i18n/map-project-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectFailure, mapProjectsBase } from "../../lib/map-project-client";
import { Button, Field, Notice } from "../ui";
import styles from "./map-project.module.css";

const text = mapProjectSv.start;

/** ADR-0219: "Starta kartprojekt" från en kartversion i klubbarkivet (klubbens administratörer och ägare). */
export function StartMapProject({ clubId, versionId, mapName, fileName }: { clubId: string; versionId: string; mapName: string; fileName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => text.defaultName(mapName));
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function start(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setProblem("");
    try {
      const result = await clubRequest(mapProjectsBase, "POST", { formatVersion: 1, requestId, clubId, baseVersionId: versionId, name: name.trim() });
      if (result.status !== 200 && result.status !== 201) { setProblem(`${text.failed} ${mapProjectFailure(result.status)}`); return; }
      window.location.assign(`/organizer/map-projects/${encodeURIComponent((result.json as { projectId: string }).projectId)}`);
    } finally { setBusy(false); }
  }

  if (!open) return <Button variant="quiet" aria-label={text.title(fileName)} onClick={() => setOpen(true)}>{text.button}</Button>;
  return <form className={styles.form} onSubmit={event => void start(event)} aria-label={text.title(fileName)}>
    <Field label={text.name}><input value={name} maxLength={120} autoFocus onChange={event => setName(event.target.value)} required /></Field>
    <div className={styles.actions}>
      <Button type="submit" disabled={busy || !name.trim()}>{text.create}</Button>
      <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>{text.cancel}</Button>
    </div>
    {problem && <Notice tone="error" role="alert">{problem}</Notice>}
  </form>;
}
