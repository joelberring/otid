"use client";

import { useState } from "react";
import { mapStatsEn } from "../../i18n/map-project-more-en";
import { useTexts } from "../language-provider";
import type { MapProjectLeaderboardRow, MapStatsSummary } from "@o-tid/contracts";
import { mapStatsSv } from "../../i18n/map-stats-sv";
import styles from "./map-project.module.css";

export type SortKey = keyof typeof mapStatsSv.sorts;
const SORTS = Object.keys(mapStatsSv.sorts) as SortKey[];

/** ADR-0219 (K3b): siffrorna (det som väger tyngst först) och märkena. */
export function StatsNumbers({ stats, testId }: { stats: MapStatsSummary; testId?: string }) {
  const text = useTexts(mapStatsSv, mapStatsEn);
  const n = text.numbers;
  const lines = [n.hectares(stats.hectares), n.km(stats.km, stats.hours), n.checked(stats.checked), n.notesResolved(stats.notesResolved),
    n.deleted(stats.deleted), n.added(stats.added), n.changed(stats.changed), n.proposalsAccepted(stats.proposalsAccepted), n.areasDone(stats.areasDone)];
  return <div data-testid={testId}>
    <ul className={styles.statsGrid}>{lines.map(line => <li key={line}>{line}</li>)}</ul>
    {stats.badges.length > 0 && <ul className={styles.badges} aria-label={text.badgesLabel}>
      {stats.badges.map(badge => <li key={badge} data-badge={badge}>{text.badges[badge] ?? badge}</li>)}</ul>}
  </div>;
}

/** Säsongerna att välja bland: allt och de fem senaste åren. */
export function SeasonSelect({ value, onChange }: { value: number | undefined; onChange: (season: number | undefined) => void }) {
  const text = useTexts(mapStatsSv, mapStatsEn);
  const year = new Date().getFullYear();
  return <label className={styles.inline}>{text.season}{" "}
    <select value={value ?? ""} onChange={event => onChange(event.target.value ? Number(event.target.value) : undefined)} data-testid="map-stats-season">
      <option value="">{text.allTime}</option>
      {[0, 1, 2, 3, 4].map(back => <option key={back} value={year - back}>{year - back}</option>)}
    </select></label>;
}

/** Projektets topplista; sorteras på det man väljer (rekad yta först). Utan namn: "Kartritare N", den egna raden "Du". */
export function Leaderboard({ rows }: { rows: readonly MapProjectLeaderboardRow[] }) {
  const text = useTexts(mapStatsSv, mapStatsEn);
  const [sort, setSort] = useState<SortKey>("hectares");
  if (rows.length === 0) return <p className={styles.muted}>{text.leaderboardEmpty}</p>;
  const value = (row: MapProjectLeaderboardRow) => row.stats[sort];
  const sorted = [...rows].sort((a, b) => value(b) - value(a));
  let anonymous = 0;
  return <>
    <label className={styles.inline}>{text.sortBy}{" "}
      <select value={sort} onChange={event => setSort(event.target.value as SortKey)}>
        {SORTS.map(key => <option key={key} value={key}>{text.sorts[key]}</option>)}
      </select></label>
    <ol className={styles.leaderboard} data-testid="map-stats-leaderboard">{sorted.map((row, index) => {
      const name = row.self ? text.you : row.name ?? text.anonymous(++anonymous);
      return <li key={`${index}-${name}`} data-self={row.self ? "" : undefined}><span>{name}</span>
        <strong>{value(row).toLocaleString("sv-SE", { maximumFractionDigits: 1 })}</strong></li>;
    })}</ol>
  </>;
}
