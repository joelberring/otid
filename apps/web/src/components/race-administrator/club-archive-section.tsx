"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { OrganisationSummary, RaceClubArchiveView } from "@o-tid/contracts";
import { clubAffiliationSv } from "../../i18n/club-affiliation-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { OrganisationPicker } from "../club-affiliation/organisation-picker";
import { Button, Notice, Section } from "../ui";
import styles from "../club-affiliation/club-affiliation.module.css";

const text = clubAffiliationSv.race;
type Message = { tone: "ok" | "error"; text: string } | undefined;
const base = (raceId: string) => `/api/admin/races/${encodeURIComponent(raceId)}/administrator/club-archive`;
const errorText = (json: unknown) => {
  const code = (json as { error?: string } | undefined)?.error;
  return code && text.errors[code] ? text.errors[code] : text.failed;
};

/** Läget för tävlingen och klubbarkivet (bara tävlingens administratörer får svar). */
export function useRaceClubArchive(raceId: string) {
  const [view, setView] = useState<RaceClubArchiveView>();
  const load = useCallback(async () => {
    const result = await clubRequest(base(raceId));
    if (result.status === 200) setView(result.json as RaceClubArchiveView);
  }, [raceId]);
  useEffect(() => { void load(); }, [load]);
  return { view, setView, load };
}

/**
 * ADR-0209 beslut 4: Inställningar → Klubben och klubbarkivet. Arrangörsklubben (förval: din bekräftade klubb), och när det finns
 * en klubbyta där du är administratör: "Lägg i klubbarkivet" (före tävlingen eller medan banorna är hemliga först efter en
 * bekräftelse) och "Ta ur klubbarkivet". Inget läggs in automatiskt.
 */
export function ClubArchiveSection({ raceId, disabled }: { raceId: string; disabled: boolean }) {
  const { view, setView } = useRaceClubArchive(raceId);
  const [busy, setBusy] = useState(false);
  const [secrecy, setSecrecy] = useState(false);
  const [message, setMessage] = useState<Message>();

  async function send(method: "PUT" | "POST" | "DELETE", body?: unknown, ok?: string) {
    setBusy(true); setMessage(undefined);
    const result = await clubRequest(base(raceId), method, body);
    setBusy(false);
    if (result.status !== 200) { setMessage({ tone: "error", text: errorText(result.json) }); return; }
    setView(result.json as RaceClubArchiveView);
    if (ok) setMessage({ tone: "ok", text: ok });
  }
  const setOrganiser = (organisation: OrganisationSummary | null) =>
    void send("PUT", { formatVersion: 1, organisationId: organisation?.organisationId ?? null }, text.saved);

  if (!view) return null;
  const locked = busy || disabled;
  const hasContents = !!view.contents.mapFile || view.contents.courseSetting || view.contents.courseFile;
  return <Section id={`settings-${raceId}-club`} title={text.title} help={text.help}>
    <div className={styles.form} data-testid="race-club-archive">
      <p><strong>{text.organiser}:</strong> <span data-testid="race-organiser">{view.organiser?.name ?? text.noOrganiser}</span></p>
      {!view.organiser && view.suggestion && <div className={styles.actions}>
        <span>{text.suggestion(view.suggestion.name)}</span>
        <Button variant="secondary" disabled={locked} onClick={() => setOrganiser(view.suggestion)}>{text.useSuggestion}</Button>
      </div>}
      <OrganisationPicker label={text.organiser} disabled={locked} onPick={organisation => setOrganiser(organisation)}
        exclude={view.organiser ? [view.organiser.organisationId] : []} />
      {view.organiser && <div className={styles.actions}><Button variant="quiet" disabled={locked} onClick={() => setOrganiser(null)}>{text.clearOrganiser}</Button></div>}
      {view.organiser && view.space === "NONE" && <p className={styles.muted}>{text.noSpace}</p>}
      {view.space === "ADMIN" && <>
        <p className={styles.muted}>{text.space(view.spaceName ?? "")}</p>
        {view.lifted ? <>
          <Notice tone="ok" role="status">{text.lifted}</Notice>
          <div className={styles.actions}>
            <Link href={`/organizer/clubs/${encodeURIComponent(view.lifted.clubId)}/arkiv/${encodeURIComponent(view.lifted.entryId)}`}>{text.openEntry}</Link>
            <Button variant="secondary" disabled={locked} onClick={() => { if (window.confirm(text.unliftConfirm)) void send("DELETE"); }}>{text.unlift}</Button>
          </div>
        </> : <>
          <p className={styles.muted}>{hasContents ? text.contents : text.noContents}</p>
          {!view.finished && <div className={styles.warning} data-testid="race-club-archive-secrecy">
            <p><strong>{text.secrecyTitle}</strong> {text.secrecy}</p>
            <label><input type="checkbox" checked={secrecy} disabled={locked} onChange={event => setSecrecy(event.target.checked)} /> {text.secrecyConfirm}</label>
          </div>}
          <div className={styles.actions}>
            <Button disabled={locked || !hasContents || (!view.finished && !secrecy)}
              onClick={() => void send("POST", { formatVersion: 1, confirmSecrecy: !view.finished && secrecy })}>{busy ? text.lifting : text.lift}</Button>
          </div>
        </>}
      </>}
      {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
    </div>
  </Section>;
}

/** Påminnelsen i arbetsytan efter tävlingen: "Tävlingen är klar – lägga banorna i klubbarkivet?". Inget läggs in automatiskt. */
export function ClubArchiveReminder({ raceId, onOpen }: { raceId: string; onOpen: () => void }) {
  const { view } = useRaceClubArchive(raceId);
  if (!view || !view.finished || view.space !== "ADMIN" || view.lifted) return null;
  if (!view.contents.mapFile && !view.contents.courseSetting && !view.contents.courseFile) return null;
  return <div data-testid="club-archive-reminder"><Notice role="status">{text.reminder}{" "}
    <Button variant="quiet" onClick={onOpen}>{text.reminderOpen}</Button></Notice></div>;
}
