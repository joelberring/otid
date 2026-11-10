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

interface Candidate { readonly raceId: string; readonly label: string; readonly date: string }

/**
 * Ägaren 2026-11-10: "Koppla en träning" – välj en banläggning som redan finns (egen, ur arkivet med Använd igen, eller i en
 * grupp) bland dem du är ägare eller administratör för. Närmast planens datum först.
 */
export function PlanLinkRace({ path, sessionDate, busy, change, onClose }: {
  path: string; sessionDate: string; busy: boolean; change: PlanChange; onClose: () => void;
}) {
  const text = useTexts(clubPlanningSv.link, clubPlanningEn.link);
  const language = useLanguage();
  const [candidates, setCandidates] = useState<readonly Candidate[]>();
  const [raceId, setRaceId] = useState("");
  useEffect(() => {
    void planRequest("/api/organizer/events").then(response => {
      const body = response.json as OrganizerMyEventsResponse | undefined;
      const days = (date: string) => Math.abs(Date.parse(date) - Date.parse(sessionDate));
      const list = response.status === 200 && body ? body.events.filter(event => event.role === "OWNER" || event.role === "ADMIN")
        .flatMap(event => event.races.map(race => ({ raceId: race.raceId, date: race.raceDate,
          label: `${shortDate(race.raceDate, language)} · ${race.raceName ? `${event.eventName} – ${race.raceName}` : event.eventName}` })))
        .sort((a, b) => days(a.date) - days(b.date)) : [];
      setCandidates(list);
      setRaceId(list[0]?.raceId ?? "");
    });
  }, [sessionDate, language]);
  if (!candidates) return <p className={styles.small} role="status">{text.loading}</p>;
  if (candidates.length === 0) return <p className={styles.small} role="status">{text.none} <Button variant="quiet" onClick={onClose}>{text.cancel}</Button></p>;
  return <div className={styles.actions} data-testid="plan-link-race">
    <label className={styles.small}>{text.choose}{" "}
      <select value={raceId} onChange={event => setRaceId(event.target.value)}>
        {candidates.map(candidate => <option key={candidate.raceId} value={candidate.raceId}>{candidate.label}</option>)}
      </select></label>
    <Button disabled={busy || !raceId} onClick={() => void change(`${path}/race`, "PUT", { formatVersion: 1, raceId }, () => text.linked)
      .then(done => { if (done) onClose(); })}>{text.link}</Button>
    <Button variant="quiet" onClick={onClose}>{text.cancel}</Button>
  </div>;
}
