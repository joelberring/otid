"use client";

import { useEffect, useState } from "react";
import type { OrganizerMyEventsResponse } from "@o-tid/contracts";
import { clubPlanningEn } from "../../i18n/club-planning-en";
import { clubPlanningSv } from "../../i18n/club-planning-sv";
import { planRequest, shortDate } from "../../lib/club-planning-client";
import { useLanguage, useTexts } from "../language-provider";
import { Button } from "../ui";
import type { PlanChange } from "./plan-session-card";
import styles from "./club-planning.module.css";

interface Candidate { readonly raceId: string; readonly label: string; readonly date: string; readonly near: boolean }

const DAY_MS = 86_400_000;
/** Veckans måndag och söndag ± två veckor (användartestet 2026-11-12, F). */
function nearRange(sessionDate: string): { from: string; to: string } {
  const day = new Date(`${sessionDate}T12:00:00Z`);
  const monday = day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS;
  const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
  return { from: iso(monday - 14 * DAY_MS), to: iso(monday + 20 * DAY_MS) };
}

/**
 * Ägaren 2026-11-10: "Koppla en träning" – välj en banläggning som redan finns (egen, ur arkivet med Använd igen, eller i en
 * grupp) bland dem du är ägare eller administratör för. Närmast planens datum först. Användartestet 2026-11-12 (F): bara
 * träningar och tävlingar (inga fester), först de inom veckan ± två veckor; de andra under "Visa fler".
 */
export function PlanLinkRace({ path, sessionDate, busy, change, onClose }: {
  path: string; sessionDate: string; busy: boolean; change: PlanChange; onClose: () => void;
}) {
  const text = useTexts(clubPlanningSv.link, clubPlanningEn.link);
  const language = useLanguage();
  const [candidates, setCandidates] = useState<readonly Candidate[]>();
  const [raceId, setRaceId] = useState("");
  const [more, setMore] = useState(false);
  useEffect(() => {
    void planRequest("/api/organizer/events").then(response => {
      const body = response.json as OrganizerMyEventsResponse | undefined;
      const days = (date: string) => Math.abs(Date.parse(date) - Date.parse(sessionDate));
      const range = nearRange(sessionDate);
      const list = response.status === 200 && body ? body.events.filter(event => event.role === "OWNER" || event.role === "ADMIN")
        .flatMap(event => event.races.filter(race => race.raceType !== "PARTY").map(race => ({ raceId: race.raceId, date: race.raceDate,
          near: race.raceDate >= range.from && race.raceDate <= range.to,
          label: `${shortDate(race.raceDate, language)} · ${race.raceName ? `${event.eventName} – ${race.raceName}` : event.eventName}` })))
        .sort((a, b) => days(a.date) - days(b.date)) : [];
      setCandidates(list);
      setMore(!list.some(candidate => candidate.near));
      setRaceId(list[0]?.raceId ?? "");
    });
  }, [sessionDate, language]);
  if (!candidates) return <p className={styles.small} role="status">{text.loading}</p>;
  if (candidates.length === 0) return <p className={styles.small} role="status">{text.none} <Button variant="quiet" onClick={onClose}>{text.cancel}</Button></p>;
  const shown = more ? candidates : candidates.filter(candidate => candidate.near);
  const hidden = candidates.length - shown.length;
  return <div className={styles.actions} data-testid="plan-link-race">
    <label className={styles.small}>{text.choose}{" "}
      <select value={raceId} onChange={event => setRaceId(event.target.value)}>
        {shown.map(candidate => <option key={candidate.raceId} value={candidate.raceId}>{candidate.label}</option>)}
      </select></label>
    {hidden > 0 && <Button variant="quiet" onClick={() => setMore(true)}>{text.more(hidden)}</Button>}
    {more && !candidates.some(candidate => candidate.near) && <span className={styles.small}>{text.noneNear}</span>}
    <Button disabled={busy || !raceId} onClick={() => void change(`${path}/race`, "PUT", { formatVersion: 1, raceId }, () => text.linked)
      .then(done => { if (done) onClose(); })}>{text.link}</Button>
    <Button variant="quiet" onClick={onClose}>{text.cancel}</Button>
  </div>;
}
