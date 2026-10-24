"use client";

import { useEffect, useState } from "react";
import { publicPartyResponseSchema, type PublicPartyResponse } from "@o-tid/contracts";
import { partyThemeStyle } from "../../lib/party-theme-style";
import { partyPublicSv as text } from "../../i18n/party-public-sv";
import { SelfRegistrationForm } from "../self-registration/self-registration-form";
import styles from "./party-public.module.css";

/**
 * Den publika fest-sidan (PLAN.md steg 40): stora siffror, vad som säljer bäst, köp per kvart, senaste köpen och lite
 * rolig statistik. Hämtas om var tionde sekund. Inga belopp eller bricknummer; namn bara när festen visar namn.
 */
const POLL_MS = 10_000;
function clock(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

function duration(seconds: number): string {
  if (seconds < 90) return `${seconds} sekunder`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes} minuter` : `${Math.round(minutes / 60)} timmar`;
}

export function PartyPublic({ raceId, eventName }: { raceId: string; eventName: string }) {
  const [party, setParty] = useState<PublicPartyResponse>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/public/parties/${raceId}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const value = publicPartyResponseSchema.parse(await response.json());
        if (!stopped) { setParty(value); setFailed(false); }
      } catch { if (!stopped) setFailed(true); }
    };
    void load();
    const timer = setInterval(() => { void load(); }, POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [raceId]);

  const zone = party?.timeZone ?? "Europe/Stockholm";
  const at = (value: string | undefined) => value ? clock(value, zone) : "–";
  const title = party?.theme.title ?? eventName;
  const max = Math.max(1, ...(party?.quarters.map(row => row.count) ?? [1]));
  return <main className={styles.page} style={partyThemeStyle(party?.theme)} data-testid="party-public">
    <header className={styles.banner}>
      {party?.theme.logo ? <img className={styles.logo} src={party.theme.logo} alt="" /> : null}
      <div><h1>{title}</h1>{title !== eventName ? <p>{eventName}</p> : null}</div>
    </header>
    <SelfRegistrationForm raceId={raceId} />
    {!party ? <p role="status" className={styles.status}>{failed ? text.loadError : text.loading}</p> : <>
      {failed ? <p role="status" className={styles.status}>{text.loadError}</p> : null}
      <dl className={styles.numbers} data-testid="party-numbers">
        <div><dt>{text.sold}</dt><dd>{party.soldCount}</dd></div>
        <div><dt>{text.checkedIn}</dt><dd>{party.checkedInCount || party.guestCount}</dd></div>
        <div><dt>{text.first}</dt><dd>{at(party.firstPurchaseAt)}</dd></div>
        <div><dt>{text.last}</dt><dd>{at(party.lastPurchaseAt)}</dd></div>
        <div><dt>{text.checkedOut}</dt><dd>{party.checkedOutCount}</dd></div>
      </dl>

      <section className={styles.panel} aria-labelledby="party-best">
        <h2 id="party-best">{text.bestTitle}</h2>
        {party.groups?.map(group => <p key={group.name} className={styles.group}>{text.groupTotal(group.name, group.count)}</p>)}
        {party.items.length === 0 ? <p>{text.noneYet}</p> : <ol className={styles.bars}>
          {party.items.map(item => <li key={item.name}>
            <span className={styles.barName}>{item.name}</span>
            <span className={styles.barTrack} aria-hidden="true"><span className={styles.barFill} style={{ width: `${Math.round(item.share * 100)}%` }} /></span>
            <span className={styles.barValue}>{item.count} · {text.share(Math.round(item.share * 100))}</span>
          </li>)}
        </ol>}
      </section>

      <section className={styles.panel} aria-labelledby="party-quarters">
        <h2 id="party-quarters">{text.quartersTitle}</h2>
        {party.quarters.length === 0 ? <p>{text.noneYet}</p> : <>
          {party.peak !== undefined ? <p className={styles.peak}>★ {text.peak(at(party.quarters[party.peak]!.startsAt), party.quarters[party.peak]!.count)}</p> : null}
          <ol className={styles.chart} aria-label={text.quartersTitle}>
            {party.quarters.map((row, index) => <li key={row.startsAt} data-peak={index === party.peak ? "true" : undefined}
              aria-label={text.quarterLabel(at(row.startsAt), row.count)}>
              <span className={styles.column} style={{ height: `${Math.max(2, Math.round(row.count / max * 100))}%` }} />
              <span className={styles.tick}>{index % 4 === 0 ? at(row.startsAt) : ""}</span>
            </li>)}
          </ol>
        </>}
      </section>

      <div className={styles.columns}>
        <section className={styles.panel} aria-labelledby="party-recent">
          <h2 id="party-recent">{text.recentTitle}</h2>
          {party.recent.length === 0 ? <p>{text.noneYet}</p> : <ol className={styles.recent}>
            {party.recent.map((row, index) => <li key={`${row.at}-${index}`}><time>{at(row.at)}</time> <strong>{row.itemName}</strong>
              {row.name ? <span> · {row.name}</span> : null}</li>)}
          </ol>}
        </section>
        <section className={styles.panel} aria-labelledby="party-fun">
          <h2 id="party-fun">{text.funTitle}</h2>
          <ul className={styles.fun}>
            {party.averageSecondsBetween !== undefined ? <li>{text.average(duration(party.averageSecondsBetween))}</li> : null}
            {party.firstArrival ? <li><strong>{text.firstArrival}:</strong> {party.firstArrival.name ?? at(party.firstArrival.at)}
              {party.firstArrival.name ? ` (${at(party.firstArrival.at)})` : ""}</li> : null}
            {party.firstFinish ? <li><strong>{text.firstFinish}:</strong> {party.firstFinish.name ?? at(party.firstFinish.at)}
              {party.firstFinish.name ? ` (${at(party.firstFinish.at)})` : ""}</li> : null}
            {party.lastOut ? <li><strong>{text.lastOut}:</strong> {party.lastOut.name ?? at(party.lastOut.at)}
              {party.lastOut.name ? ` (${at(party.lastOut.at)})` : ""}</li> : null}
          </ul>
          {party.topPerHour.length > 0 ? <><h3>{text.perHour}</h3><ul className={styles.fun}>
            {party.topPerHour.map(row => <li key={row.hourStartsAt}>{text.hourRow(at(row.hourStartsAt), row.itemName, row.count)}</li>)}
          </ul></> : null}
        </section>
      </div>

      {party.guests && party.guests.length > 0 ? <section className={styles.panel} aria-labelledby="party-guests">
        <h2 id="party-guests">{text.guestsTitle}</h2>
        <ul className={styles.guests}>{party.guests.map((guest, index) => <li key={`${guest.name}-${index}`}>
          <span>{guest.name}</span> <span>{text.purchases(guest.purchaseCount)}</span></li>)}</ul>
      </section> : null}
      <p className={styles.status}>{text.updated(at(party.fetchedAt))}</p>
    </>}
  </main>;
}
