"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AccountMenu } from "../account-menu";
import type { GroupLeaderView as View, GroupSession } from "@o-tid/contracts";
import { trainingGroupSv } from "../../i18n/training-group-sv";
import { raceTypeSv } from "../../i18n/race-type-sv";
import { groupFailure, groupRequest } from "../../lib/training-group-client";
import { PublicLinkShare } from "../public-link-share";
import { Button, Notice } from "../ui";
import { GroupAttachRace } from "./group-attach-race";
import { GroupMaps } from "./group-maps";
import { GroupPeople } from "./group-people";
import { GroupSessionForm } from "./group-session-form";
import { GroupSettingsForm } from "./group-settings";
import styles from "./training-group.module.css";

const text = trainingGroupSv.leader;

/**
 * Steg 68 (ADR-0182): ledarnas vy av gruppen under Mina tävlingar – ny träning och upprepning, tillfällena (var och en med
 * sin egen arbetsyta), upprepningarna med "Ångra framtida", ledare och medlemmar, kartbiblioteket, inställningarna och
 * säsongen. Bara ledare får vyn (servern svarar annars 404).
 */
export function GroupLeaderView({ groupId }: { groupId: string }) {
  const [view, setView] = useState<View>();
  const [state, setState] = useState<"loading" | "ok" | "not-found" | "error">("loading");
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);

  async function load() {
    const result = await groupRequest(`/api/organizer/groups/${encodeURIComponent(groupId)}`);
    if (result.status === 200) { setView(result.json as View); setState("ok"); setGeneration(value => value + 1); return; }
    setState(result.status === 404 || result.status === 401 ? "not-found" : "error");
    setProblem(groupFailure(result.status));
  }
  useEffect(() => { void load(); }, [groupId]);

  const changed = (note: string) => { setMessage(note); setProblem(""); void load(); };

  async function undo(seriesId: string) {
    if (!window.confirm(text.undoConfirm)) return;
    setBusy(true);
    try {
      const result = await groupRequest(`/api/organizer/groups/${groupId}/series/${seriesId}/undo`, "POST");
      if (result.status !== 200) { setProblem(groupFailure(result.status)); return; }
      const body = result.json as { removed: number; kept: number };
      changed(text.undone(body.removed, body.kept));
    } finally { setBusy(false); }
  }

  async function removeSession(session: GroupSession) {
    if (!window.confirm(text.removeSessionConfirm)) return;
    setBusy(true);
    try {
      const result = await groupRequest(`/api/organizer/groups/${groupId}/sessions/${session.raceId}`, "DELETE");
      if (result.status !== 200) { setProblem(groupFailure(result.status)); return; }
      changed(text.removed);
    } finally { setBusy(false); }
  }

  if (state === "loading") return <main className={styles.leader}><p aria-live="polite">{text.loading}</p></main>;
  if (!view) return <main className={styles.leader}>
    <nav><Link href="/organizer">{text.back}</Link></nav>
    <Notice tone="error" role="alert">{state === "not-found" ? text.notFound : problem}</Notice>
  </main>;

  const upcoming = view.sessions.filter(session => session.raceDate >= view.today);
  const past = view.sessions.filter(session => session.raceDate < view.today).reverse();
  const sessionRow = (session: GroupSession) => <li key={session.raceId}>
    <div>
      <strong>{session.raceDate}{session.firstStartTime ? ` ${session.firstStartTime}` : ""} · {session.eventName}
        {view.settings.templateRaceId === session.raceId && <span className={styles.badge}>{text.template}</span>}</strong>
      <span>{[raceTypeSv.types[session.raceType as keyof typeof raceTypeSv.types]?.name, text.entries(session.entries),
        session.published ? "" : text.notPublished].filter(Boolean).join(" · ")}</span>
    </div>
    <div className={styles.rowActions}>
      {session.entries === 0 && !session.hasResults && <Button variant="quiet" disabled={busy}
        aria-label={`${text.removeSession}: ${session.raceDate}`} onClick={() => void removeSession(session)}>{text.removeSession}</Button>}
      <Link className={styles.buttonLink} href={`/admin/${session.raceId}/manage`} aria-label={`${text.openRace}: ${session.raceDate}`}>{text.openRace}</Link>
    </div>
  </li>;

  return <main className={styles.leader}>
    <header className={styles.leaderHeader}>
      <div>
        <p className={styles.kicker}><Link href="/organizer">{text.back}</Link> · {trainingGroupSv.myGroups.title}</p>
        <h1>{view.settings.name}</h1>
      </div>
      <div className={styles.rowActions}>
        <Link href={`/g/${view.settings.code}`}>{text.publicLink}: /g/{view.settings.code}</Link>
        <Link href={`/g/${view.settings.code}/qr`}>{text.qr}</Link>
        <PublicLinkShare path={`/g/${view.settings.code}`} title={view.settings.name} />
        <AccountMenu />
      </div>
    </header>
    {(message || problem) && <Notice tone={problem ? "error" : "ok"} role="status">{problem || message}</Notice>}
    <div className={styles.leaderGrid}>
      <section aria-labelledby="group-sessions">
        <h2 id="group-sessions">{text.sections.sessions}</h2>
        {view.sessions.length === 0 && <p className={styles.muted}>{text.noSessions}</p>}
        {upcoming.length > 0 && <><h3>{text.upcoming}</h3><ul className={styles.sessionList} aria-label={text.upcoming}>{upcoming.map(sessionRow)}</ul></>}
        {past.length > 0 && <><h3>{text.past}</h3><ul className={styles.sessionList} aria-label={text.past}>{past.map(sessionRow)}</ul></>}
        <GroupAttachRace view={view} onAttached={changed} />
        <h3>{text.sections.series}</h3>
        {view.series.length === 0 && <p className={styles.muted}>{text.noSeries}</p>}
        {view.series.length > 0 && <ul className={styles.plainList} aria-label={text.sections.series}>
          {view.series.map(series => <li key={series.seriesId}>
            <div><strong>{text.seriesRow(text.weekdays[series.weekday - 1] ?? "", series.startTime, series.firstDate, series.lastDate,
              series.sessions)}</strong>{series.undoneAt && <span>{text.undoneAt}</span>}</div>
            <Button variant="secondary" disabled={busy || series.sessions === 0} onClick={() => void undo(series.seriesId)}>{text.undo}</Button>
          </li>)}
        </ul>}
      </section>
      <section aria-labelledby="group-new">
        <h2 id="group-new">{text.sections.new}</h2>
        <GroupSessionForm key={`new-${generation}`} view={view} onCreated={changed} />
      </section>
      <section aria-labelledby="group-season" className={styles.wide}>
        <h2 id="group-season">{text.sections.season}</h2>
        {view.season.rows.length === 0 ? <p className={styles.muted}>{text.seasonEmpty}</p> : <>
          <p className={styles.muted}>{text.seasonHint(view.season.sessions)}</p>
          <div style={{ overflowX: "auto" }}><table className={styles.table}>
            <thead><tr><th>{text.participant}</th><th className={styles.num}>{text.attended}</th>
              {view.settings.pointsMode !== "NONE" && <th className={styles.num}>{text.points}</th>}</tr></thead>
            <tbody>{view.season.rows.map(row => <tr key={row.key}><td>{row.givenName} {row.familyName}</td>
              <td className={styles.num}>{row.attended}</td>{view.settings.pointsMode !== "NONE" && <td className={styles.num}>{row.points}</td>}</tr>)}</tbody>
          </table></div>
        </>}
      </section>
      <section aria-labelledby="group-maps">
        <h2 id="group-maps">{text.sections.maps}</h2>
        <GroupMaps key={`maps-${generation}`} view={view} onChanged={changed} />
      </section>
      <section aria-labelledby="group-people">
        <h2 id="group-people">{text.sections.people}</h2>
        <GroupPeople view={view} onChanged={() => changed(text.saved)} />
      </section>
      <section aria-labelledby="group-settings" className={styles.wide}>
        <h2 id="group-settings">{text.sections.settings}</h2>
        <GroupSettingsForm key={`settings-${generation}`} view={view} onSaved={changed} />
      </section>
    </div>
  </main>;
}
