"use client";

import { useClubFailure } from "./use-club-failure";
import { useState, type FormEvent } from "react";
import { clubArchiveEn } from "../../i18n/club-archive-en";
import { useTexts } from "../language-provider";
import type { ClubSummary } from "@o-tid/contracts";
import { clubArchiveSv } from "../../i18n/club-archive-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { Button, Field, Notice } from "../ui";
import styles from "./club-archive.module.css";

/** Samma gräns som servern (`clubNameSchema`). */
const NAME_MAX = 120;

/**
 * ADR-0194 beslut 1: en ny klubbyta från Mina tävlingar (den som skapar en klubb blir ägare). Ägaren 2026-11-04: en liten åtgärd
 * i remsan Mina klubbar överst (`MyPlacesStrip`); formuläret visas under remsan.
 */
export function NewClubForm({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const failure = useClubFailure();
  const text = useTexts(clubArchiveSv.myClubs, clubArchiveEn.myClubs);
  const [name, setName] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  /** Felet vid namnfältet (tomt, för långt, finns redan); övriga fel under knappen. */
  const [nameError, setNameError] = useState<string>();

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
        setProblem(`${text.failed} ${failure(result.status)}`);
        return;
      }
      const club = (result.json as { club: ClubSummary }).club;
      window.location.assign(`/organizer/clubs/${encodeURIComponent(club.clubId)}`);
    } finally { setBusy(false); }
  }

  return <>
    <Button variant="secondary" className={styles.smallAction} aria-expanded={open} onClick={onToggle}>{text.create}</Button>
    {open && <form className={`${styles.form} ${styles.createInline}`} noValidate onSubmit={event => void create(event)}>
      <Field label={text.name} error={nameError}><input value={name} required aria-required="true" maxLength={NAME_MAX} autoComplete="off" autoFocus
        placeholder={text.namePlaceholder} onChange={event => { setName(event.target.value); if (nameError) setNameError(undefined); }} /></Field>
      <Button type="submit" disabled={busy}>{text.createButton}</Button>
      {problem && <Notice tone="error" role="alert">{problem}</Notice>}
    </form>}
  </>;
}
