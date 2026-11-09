"use client";

import { useEffect, useState, type FormEvent } from "react";
import { trainingGroupEn } from "../../i18n/training-group-en";
import { useTexts } from "../language-provider";
import type { GroupLeaderView, OrganizerMyEventsResponse } from "@o-tid/contracts";
import { trainingGroupSv } from "../../i18n/training-group-sv";
import { groupFailure, groupRequest } from "../../lib/training-group-client";
import { Button, Field, Notice } from "../ui";
import styles from "./training-group.module.css";


/**
 * Steg 68 (ADR-0182 beslut 1): en tävling som ledaren redan administrerar läggs till i gruppen (hela evenemanget). Därefter
 * är gruppens alla ledare administratörer på den.
 */
export function GroupAttachRace({ view, onAttached }: { view: GroupLeaderView; onAttached: (message: string) => void }) {
  const trainingGroupText = useTexts(trainingGroupSv, trainingGroupEn);
  const text = useTexts(trainingGroupSv.leader, trainingGroupEn.leader);
  const [races, setRaces] = useState<{ raceId: string; label: string }[]>([]);
  const [raceId, setRaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    void (async () => {
      const result = await groupRequest("/api/organizer/events");
      if (result.status !== 200) return;
      const inGroup = new Set(view.sessions.map(session => session.raceId));
      const events = (result.json as OrganizerMyEventsResponse).events.filter(event => event.role === "OWNER" || event.role === "ADMIN");
      setRaces(events.flatMap(event => event.races.filter(race => !inGroup.has(race.raceId))
        .map(race => ({ raceId: race.raceId, label: `${race.raceDate} · ${event.eventName}${race.raceName ? ` – ${race.raceName}` : ""}` }))));
    })();
  }, [view.sessions]);

  async function attach(event: FormEvent) {
    event.preventDefault();
    if (!raceId) return;
    setBusy(true); setProblem("");
    try {
      const result = await groupRequest(`/api/organizer/races/${raceId}/group`, "PUT", { formatVersion: 1, groupId: view.groupId });
      if (result.status !== 200) { setProblem(groupFailure(result.status, trainingGroupText.leader.errors)); return; }
      setRaceId(""); onAttached(text.attached);
    } finally { setBusy(false); }
  }

  if (races.length === 0) return null;
  return <details>
    <summary className={styles.check}>{text.attach}</summary>
    <form className={styles.form} noValidate onSubmit={event => void attach(event)}>
      <p className={styles.muted}>{text.attachHint}</p>
      <Field label={text.attachRace}><select value={raceId} disabled={busy} onChange={event => setRaceId(event.target.value)}>
        <option value="">–</option>
        {races.map(race => <option key={race.raceId} value={race.raceId}>{race.label}</option>)}
      </select></Field>
      <Button type="submit" variant="secondary" disabled={busy || !raceId}>{text.attachButton}</Button>
      {problem && <Notice tone="error" role="alert">{problem}</Notice>}
    </form>
  </details>;
}
