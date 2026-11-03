"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type { ClubSummary } from "@o-tid/contracts";
import { clubArchiveSv } from "../../i18n/club-archive-sv";
import { clubFailure, clubRequest } from "../../lib/club-archive-client";
import { Button, Field, Notice } from "../ui";
import styles from "./club-archive.module.css";

const text = clubArchiveSv.myClubs;
/** Samma gräns som servern (`clubNameSchema`). */
const NAME_MAX = 120;

/** ADR-0194 beslut 1: Mina tävlingar → Mina klubbar, med klubbarkivet. Den som skapar en klubb blir ägare. */
export function MyClubs() {
  const [clubs, setClubs] = useState<ClubSummary[]>();
  const [name, setName] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  /** Felet vid namnfältet (tomt, för långt, finns redan); övriga fel under knappen. */
  const [nameError, setNameError] = useState<string>();

  useEffect(() => {
    let active = true;
    void clubRequest("/api/organizer/clubs").then(result => {
      if (active && result.status === 200) setClubs((result.json as { clubs: ClubSummary[] }).clubs);
    });
    return () => { active = false; };
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setNameError(text.nameMissing); setProblem(""); return; }
    if (trimmed.length > NAME_MAX) { setNameError(text.nameTooLong(NAME_MAX)); setProblem(""); return; }
    setBusy(true); setProblem(""); setNameError(undefined);
    try {
      const result = await clubRequest("/api/organizer/clubs", "POST", { formatVersion: 1, requestId, name: trimmed });
      if (result.status !== 201 && result.status !== 200) {
        setRequestId(crypto.randomUUID());
        const code = (result.json as { error?: string } | undefined)?.error;
        // Serverns besked som text vid fältet: finns redan, eller ett namn som servern inte godtar.
        if (result.status === 409 && code === "NAME_TAKEN") { setNameError(text.nameTaken); return; }
        if (result.status === 400) { setNameError(trimmed.length > NAME_MAX ? text.nameTooLong(NAME_MAX) : text.nameMissing); return; }
        setProblem(`${text.failed} ${clubFailure(result.status)}`);
        return;
      }
      const club = (result.json as { club: ClubSummary }).club;
      window.location.assign(`/organizer/clubs/${encodeURIComponent(club.clubId)}`);
    } finally { setBusy(false); }
  }

  return <section className={styles.myClubs} aria-labelledby="my-clubs-heading">
    <h2 id="my-clubs-heading">{text.title}</h2>
    <p className={styles.muted}>{text.hint}</p>
    {clubs && clubs.length === 0 && <p className={styles.muted}>{text.empty}</p>}
    {clubs && clubs.length > 0 && <ul className={styles.list}>
      {clubs.map(club => <li key={club.clubId}>
        <div><strong>{club.name}</strong><span>{clubArchiveSv.roles[club.role]} · {text.entries(club.entries)}</span></div>
        <Link className={styles.buttonLink} href={`/organizer/clubs/${club.clubId}`}>{text.open}</Link>
      </li>)}
    </ul>}
    <details className={styles.details}>
      <summary>{text.create}</summary>
      <form className={styles.form} noValidate onSubmit={event => void create(event)}>
        <Field label={text.name} error={nameError}><input value={name} required aria-required="true" maxLength={NAME_MAX} autoComplete="off"
          placeholder={text.namePlaceholder} onChange={event => { setName(event.target.value); if (nameError) setNameError(undefined); }} /></Field>
        <Button type="submit" disabled={busy}>{text.createButton}</Button>
        {problem && <Notice tone="error" role="alert">{problem}</Notice>}
      </form>
    </details>
  </section>;
}
