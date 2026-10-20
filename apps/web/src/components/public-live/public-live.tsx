"use client";

import React, { useMemo, useState, type ReactNode } from "react";
import { publicLiveResponseSchema, type PublicLiveFinish, type PublicLiveLeader, type PublicLiveResponse,
  type PublicRadioPassage } from "@o-tid/contracts";
import { liveSv as text, ordinal } from "../../i18n/live-sv";
import { radioControlName } from "../../i18n/radio-sv";
import { formatClockTime, formatDuration } from "../../lib/clock-time";
import { followStore, useFollows } from "../../lib/follow-store";
import { clubOptions, followedView, hasActivity, LATEST_SHOWN, leadersByClass } from "../../lib/public-live-view";
import { usePublicRaceData } from "../../lib/use-public-race-data";
import { FollowStar } from "../follow-star";
import styles from "./public-live.module.css";

async function readLive(raceId: string): Promise<PublicLiveResponse> {
  const response = await fetch(`/api/public/races/${encodeURIComponent(raceId)}/live`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Live svarade ${response.status}`);
  const live = publicLiveResponseSchema.parse(await response.json());
  if (live.raceId !== raceId) throw new Error("Live gäller en annan tävling");
  return live;
}

type Runner = { publicResultId: string; givenName: string; familyName: string; organisationName: string | null; className: string };
type Star = (runner: Runner) => ReactNode;

const nameOf = (runner: Runner) => `${runner.givenName} ${runner.familyName}`;
const minutes = (instant: string, timeZone: string) => formatClockTime(instant, timeZone).slice(0, 5);
const clubClass = (runner: Runner) => [runner.organisationName, runner.className].filter(Boolean).join(" · ");

/** Tid eller status för en målgång; placeringen under. Felstämplad och disk. har ingen placering. */
function FinishResult({ row }: { row: PublicLiveFinish }) {
  const time = row.elapsedMs !== undefined ? formatDuration(row.elapsedMs) : undefined;
  const label = row.status === "OK" ? undefined : text.statuses[row.status];
  return <span className={styles.result}>
    {row.points !== undefined && <strong className={styles.time}>{row.points} p</strong>}
    {time && row.points === undefined && <strong className={styles.time}>{time}</strong>}
    {label && <span className={styles.status} data-status={row.status}>{row.status === "MP" || row.status === "DSQ" ? "✗ " : ""}{label}</span>}
    {row.place !== undefined && <span className={styles.place}>{ordinal(row.place)}</span>}
    {time && row.points !== undefined && <span className={styles.sub}>{time}</span>}
  </span>;
}

function FinishRow({ row, timeZone, star }: { row: PublicLiveFinish; timeZone: string; star: Star }) {
  return <li className={styles.row} data-status={row.status}>
    <time className={styles.clock} dateTime={row.finishedAt}>{minutes(row.finishedAt, timeZone)}</time>
    <span className={styles.who}><strong>{nameOf(row)}</strong><span className={styles.sub}>{clubClass(row)}</span></span>
    <FinishResult row={row} />
    {star(row)}
  </li>;
}

function passageText(passage: PublicRadioPassage): string {
  return text.passed(radioControlName(passage.controlCode, passage.label),
    passage.elapsedMs !== null ? formatDuration(passage.elapsedMs) : null, passage.place);
}

function PassageRow({ passage, timeZone, star }: { passage: PublicRadioPassage; timeZone: string; star: Star }) {
  return <li className={styles.row}>
    {passage.passedAt ? <time className={styles.clock} dateTime={passage.passedAt}>{minutes(passage.passedAt, timeZone)}</time>
      : <span className={styles.clock} />}
    <span className={styles.who}><strong>{nameOf(passage)}</strong><span className={styles.passage}>{passageText(passage)}</span>
      <span className={styles.sub}>{clubClass(passage)}</span></span>
    <span className={styles.result} />
    {star(passage)}
  </li>;
}

function LeaderRow({ leader, star }: { leader: PublicLiveLeader; star: Star }) {
  return <li className={styles.row} data-new-leader={leader.newLeader ? "true" : undefined}>
    <span className={styles.who}><strong>{nameOf(leader)}</strong>
      <span className={styles.sub}>{leader.organisationName ?? text.noClub}</span>
      {leader.newLeader && <span className={styles.newLeader}><span aria-hidden="true">▲ </span>{text.newLeader}</span>}</span>
    <span className={styles.result}><strong className={styles.time}>{leader.points !== undefined ? `${leader.points} p` : formatDuration(leader.elapsedMs)}</strong>
      {leader.points !== undefined && <span className={styles.sub}>{formatDuration(leader.elapsedMs)}</span>}</span>
    {star(leader)}
  </li>;
}

/** "Följer": följda löpare i tävlingen och följda klubbar med sina löpare, överst på sidan. */
function Following({ live, raceId, star, clubs }: { live: PublicLiveResponse; raceId: string; star: Star; clubs: string[] }) {
  const follows = useFollows();
  const followed = followedView(live, follows, raceId);
  const [choice, setChoice] = useState("");
  const options = clubs.filter(club => !follows.clubs.includes(club));
  const any = followed.runners.length > 0 || followed.clubs.length > 0;
  if (!any && clubs.length === 0) return null;
  return <section className={styles.following} aria-labelledby="live-following">
    <h2 id="live-following">{text.followingTitle}</h2>
    {!any && <p className={styles.help}>{text.followingHelp}</p>}
    {followed.runners.length > 0 && <ol className={styles.rows}>{followed.runners.map(({ runner, finish, passage }) => finish
      ? <FinishRow key={runner.publicResultId} row={finish} timeZone={live.timeZone} star={star} />
      : passage ? <PassageRow key={runner.publicResultId} passage={passage} timeZone={live.timeZone} star={star} />
        : <li key={runner.publicResultId} className={styles.row}>
          <span className={styles.clock} />
          <span className={styles.who}><strong>{runner.name}</strong><span className={styles.sub}>
            {[runner.club, runner.className].filter(Boolean).join(" · ")}</span></span>
          <span className={styles.result}><span className={styles.sub}>{text.notFinished}</span></span>
          <FollowStar name={runner.name} followed onToggle={() => followStore.toggleRunner(runner)} />
        </li>)}</ol>}
    {followed.clubs.map(group => <section key={group.club} className={styles.club} aria-label={text.clubRegion(group.club)}>
      <div className={styles.clubHead}><h3>{group.club}</h3>
        <FollowStar name={group.club} followed onToggle={() => followStore.toggleClub(group.club)} /></div>
      {group.finishes.length === 0 && group.onTheWay.length === 0 ? <p className={styles.help}>{text.clubNone(group.club)}</p>
        : <ol className={styles.rows}>
          {group.onTheWay.map(passage => <PassageRow key={`out-${passage.publicResultId}`} passage={passage} timeZone={live.timeZone} star={star} />)}
          {group.finishes.map(row => <FinishRow key={row.publicResultId} row={row} timeZone={live.timeZone} star={star} />)}
        </ol>}
    </section>)}
    {options.length > 0 && <form className={styles.followClub} onSubmit={event => {
      event.preventDefault();
      if (choice && options.includes(choice)) { followStore.toggleClub(choice); setChoice(""); }
    }}>
      <label><span>{text.followClub}</span>
        <select value={choice} onChange={event => setChoice(event.target.value)}>
          <option value="">{text.chooseClub}</option>
          {options.map(club => <option key={club} value={club}>{club}</option>)}
        </select></label>
      <button type="submit" className="secondary" disabled={!choice}>{text.followClubButton}</button>
    </form>}
  </section>;
}

/**
 * Live för publiken (PLAN.md steg 30): senast i mål, ledare per klass med "Ny ledare" och radiopassager, med det
 * besökaren följer överst. Uppdateras av sig självt med samma ström och samma reservhämtning som resultatlistan.
 */
export function PublicLive({ raceId, initial }: { raceId: string; initial: PublicLiveResponse }) {
  const { data, failed, online } = usePublicRaceData(raceId, readLive, initial);
  const live = data ?? initial;
  const follows = useFollows();
  const followedIds = useMemo(() => new Set(follows.runners.filter(row => row.raceId === raceId).map(row => row.publicResultId)),
    [follows, raceId]);
  const clubs = useMemo(() => clubOptions(live), [live]);
  const star: Star = runner => <FollowStar name={nameOf(runner)} followed={followedIds.has(runner.publicResultId)}
    onToggle={() => followStore.toggleRunner({ raceId, publicResultId: runner.publicResultId, name: nameOf(runner),
      club: runner.organisationName, className: runner.className })} />;
  const updated = formatClockTime(live.generatedAt, live.timeZone);
  const leaders = leadersByClass(live);
  const active = hasActivity(live);
  return <div className={styles.live}>
    {!online || failed ? <p className={styles.offline} role="status">{text.offline(updated)}</p>
      : <p className={styles.updated}>{text.updated(updated)}</p>}
    <Following live={live} raceId={raceId} star={star} clubs={clubs} />
    {!active ? <section className={styles.empty} aria-labelledby="live-empty">
      <h2 id="live-empty">{text.empty}</h2>
      <p>{text.emptyHelp}</p>
    </section> : <div className={styles.columns}>
      <section className={styles.block} aria-labelledby="live-latest">
        <h2 id="live-latest">{text.latestTitle}</h2>
        {live.finishes.length === 0 ? <p className={styles.help}>{text.empty}</p>
          : <ol className={styles.rows}>{live.finishes.slice(0, LATEST_SHOWN).map(row =>
            <FinishRow key={row.publicResultId} row={row} timeZone={live.timeZone} star={star} />)}</ol>}
      </section>
      <div className={styles.side}>
        <section className={styles.block} aria-labelledby="live-leaders">
          <h2 id="live-leaders">{text.leadersTitle}</h2>
          {leaders.length === 0 ? <p className={styles.help}>{text.leadersEmpty}</p> : <dl className={styles.leaders}>
            {leaders.map(group => <div key={group.className} className={styles.leaderGroup}>
              <dt>{group.className}</dt>
              <dd><ol className={styles.rows}>{group.leaders.map(leader =>
                <LeaderRow key={leader.publicResultId} leader={leader} star={star} />)}</ol></dd>
            </div>)}
          </dl>}
        </section>
        {live.radio.enabled && <section className={styles.block} aria-labelledby="live-radio">
          <h2 id="live-radio">{text.radioTitle}</h2>
          {live.radio.latest.length === 0 ? <p className={styles.help}>{text.radioEmpty}</p>
            : <ol className={styles.rows}>{live.radio.latest.slice(0, LATEST_SHOWN).map(passage =>
              <PassageRow key={`${passage.publicResultId}-${passage.controlCode}`} passage={passage} timeZone={live.timeZone} star={star} />)}</ol>}
        </section>}
      </div>
    </div>}
  </div>;
}
