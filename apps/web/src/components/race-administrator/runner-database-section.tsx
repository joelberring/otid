"use client";

import { useEffect, useState } from "react";
import {
  runnerDatabaseRefreshResponseSchema, runnerDatabaseSettingsResponseSchema, type RunnerClub, type RunnerDatabaseSettingsResponse
} from "@o-tid/contracts";
import { sourcesSv } from "../../i18n/sources-sv";
import { Button, Field, Notice } from "../ui";
import styles from "./sources.module.css";
import { sourceTime } from "./eventor-section";
import { useRunnerSuggestions } from "./runner-suggestions";
import type { Message } from "./source-sync-actions";
import type { Workspace } from "./workspace-state";

const text = sourcesSv.runnerDatabase;

/**
 * Inställningar → Eventor → Löpardatabasen (PLAN.md steg 29): hämta klubbens (och tillagda klubbars, eller hela landets)
 * löpare och Eventors klubbar, se när och hur många, och radera. Bara administratören når den här delen; databasen delas
 * av klubbens tävlingar. Uppdateringen kan ta tid (hela Sverige) och räknas som en skrivning.
 */
export function RunnerDatabaseSection({ ws, timeZone }: { ws: Workspace; timeZone: string }) {
  const { authenticated, busy, operation, writingRef, beginRequest, request, json, finish, current, csrf, requireSession, raceId } = ws;
  const [settings, setSettings] = useState<RunnerDatabaseSettingsResponse>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [message, setMessage] = useState<Message>();
  const [wholeCountry, setWholeCountry] = useState(false);
  const [extra, setExtra] = useState<{ id: string; name: string }[]>([]);
  const [clubText, setClubText] = useState("");
  const [clubError, setClubError] = useState<string>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { clubs } = useRunnerSuggestions(raceId, "", clubText, !!settings?.database);

  function adopt(value: RunnerDatabaseSettingsResponse) {
    setSettings(value);
    setWholeCountry(value.database?.wholeCountry ?? false);
    setExtra(value.database?.extraClubs.map((club) => ({ id: club.id, name: club.name ?? club.id })) ?? []);
  }
  async function run(action: (op: ReturnType<typeof beginRequest>) => Promise<void>, write = true) {
    if (writingRef.current || !requireSession()) return;
    const op = beginRequest(write);
    try { await action(op); } catch { if (current(op)) setMessage({ tone: "error", text: text.failed }); } finally { finish(op); }
  }

  useEffect(() => {
    if (!authenticated || settings || loadFailed || busy || operation.current) return;
    void run(async (op) => {
      const response = await request("/runner-database", op);
      if (!response.ok) { setLoadFailed(true); throw new Error("Runner database unavailable"); }
      adopt(runnerDatabaseSettingsResponseSchema.parse(await json(response, op)));
    }, false);
  }, [authenticated, settings, loadFailed, busy]);

  const refresh = () => run(async (op) => {
    setMessage(undefined); setConfirmRemove(false); setRefreshing(true);
    try {
      const response = await request("/runner-database", op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf() },
        body: JSON.stringify({ formatVersion: 1, wholeCountry, extraOrganisationIds: extra.map((club) => club.id) }) });
      if (!response.ok) throw new Error("Refresh failed");
      const value = runnerDatabaseRefreshResponseSchema.parse(await json(response, op));
      adopt(value.settings);
      setMessage({ tone: value.outcome === "REFRESHED" ? "ok" : "error", text: text.outcome[value.outcome] });
    } finally { setRefreshing(false); }
  });
  const remove = () => run(async (op) => {
    const response = await request("/runner-database", op, { method: "DELETE", headers: { "x-otid-csrf": csrf() } });
    if (!response.ok) throw new Error("Delete failed");
    adopt(runnerDatabaseSettingsResponseSchema.parse(await json(response, op)));
    setConfirmRemove(false); setMessage({ tone: "ok", text: text.removed });
  });
  function addClub() {
    const name = clubText.trim().toLocaleLowerCase("sv");
    const club: RunnerClub | undefined = clubs.find((row) => row.name.toLocaleLowerCase("sv") === name);
    if (!club) { setClubError(text.unknownClub); return; }
    if (club.id !== settings?.organisation?.id && !extra.some((row) => row.id === club.id)) setExtra([...extra, { id: club.id, name: club.name }]);
    setClubText(""); setClubError(undefined);
  }

  const id = `runner-database-${raceId}`;
  if (!settings) return <section className={styles.block} aria-labelledby={id}>
    <h3 id={id} className={styles.subhead}>{text.title}</h3>
    {loadFailed ? <Notice tone="error" role="alert"><p>{text.failed}</p>
      <div><Button variant="secondary" disabled={busy} onClick={() => setLoadFailed(false)}>{sourcesSv.eventor.retry}</Button></div></Notice>
      : <p className={styles.muted}>…</p>}
  </section>;
  const database = settings.database;
  const organisation = settings.organisation;
  return <section className={styles.block} aria-labelledby={id}>
    <h3 id={id} className={styles.subhead}>{text.title}</h3>
    <p className={styles.muted}>{text.help}</p>
    {!organisation ? <p className={styles.muted}>{text.needsClub}</p> : <>
      {database ? <div className={styles.block} data-testid="runner-database-summary">
        <p>{text.summary(sourceTime(database.refreshedAt, timeZone), database.competitorCount, database.cardCount, database.clubCount,
          database.wholeCountry)}</p>
        <p className={styles.muted}>{text.offline(database.offlineCount, organisation.name, database.extraClubs.length, database.offlineTruncated)}
          {database.wholeCountry ? ` ${text.wholeCountryOnline}` : ""}</p>
      </div> : <p className={styles.muted}>{text.empty}</p>}
      {database && <div className={styles.block}>
        <h4 className={styles.minorHead}>{text.extraTitle}</h4>
        <p className={styles.muted}>{text.extraHelp}</p>
        {extra.length > 0 && <ul className={styles.clubList}>{extra.map((club) => <li key={club.id}>
          <span>{club.name}</span>
          <Button variant="quiet" disabled={busy} onClick={() => setExtra(extra.filter((row) => row.id !== club.id))}>{text.removeClub(club.name)}</Button>
        </li>)}</ul>}
        <form className={styles.inlineForm} noValidate onSubmit={(event) => { event.preventDefault(); addClub(); }}>
          <Field label={text.extraLabel} error={clubError}><input value={clubText} list={`${id}-clubs`} autoComplete="off" maxLength={80}
            disabled={busy} onChange={(event) => { setClubText(event.target.value); setClubError(undefined); }} /></Field>
          <div className={styles.actions}><Button type="submit" variant="secondary" disabled={busy || !clubText.trim()}>{text.addClub}</Button></div>
        </form>
        <datalist id={`${id}-clubs`}>{clubs.map((club) => <option key={club.id} value={club.name} />)}</datalist>
      </div>}
      <label className={styles.check}><input type="checkbox" checked={wholeCountry} disabled={busy}
        onChange={(event) => setWholeCountry(event.target.checked)} /><span>{text.wholeCountry}
        <small className={styles.muted}>{text.wholeCountryHelp}</small></span></label>
      <div className={styles.actions}>
        <Button disabled={busy} onClick={() => void refresh()}>{refreshing ? text.refreshing : text.refresh}</Button>
        {database && !confirmRemove && <Button variant="quiet" disabled={busy} onClick={() => setConfirmRemove(true)}>{text.remove}</Button>}
      </div>
      {confirmRemove && <Notice tone="attention" role="alert"><p>{text.removeConfirm}</p>
        <div className={styles.actions}><Button disabled={busy} onClick={() => void remove()}>{text.removeYes}</Button>
          <Button variant="secondary" disabled={busy} onClick={() => setConfirmRemove(false)}>{sourcesSv.eventor.cancel}</Button></div></Notice>}
    </>}
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
  </section>;
}
