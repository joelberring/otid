"use client";

import { useMapProjectFailure } from "./use-map-project-failure";
import { useCallback, useEffect, useState } from "react";
import { mapStatsEn } from "../../i18n/map-project-more-en";
import { useTexts } from "../language-provider";
import Link from "next/link";
import type { MapProjectStatsView, MyMapStatsView } from "@o-tid/contracts";
import { mapStatsSv } from "../../i18n/map-stats-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { Notice } from "../ui";
import { Leaderboard, SeasonSelect, StatsNumbers } from "./map-stats";
import styles from "./map-project.module.css";

const OPT_IN = "/api/account/map-stats";
const withSeason = (path: string, season: number | undefined) => season === undefined ? path : `${path}?season=${season}`;

/** "Visa mig i topplistorna" (gäller alla projekt). */
function OptIn({ value, onChanged }: { value: boolean; onChanged: (next: boolean) => void }) {
  const failure = useMapProjectFailure();
  const text = useTexts(mapStatsSv, mapStatsEn);
  const [problem, setProblem] = useState("");
  // Valet syns direkt och går tillbaka om servern säger nej.
  const [shown, setShown] = useState(value);
  useEffect(() => setShown(value), [value]);
  return <>
    <label className={styles.check}><input type="checkbox" checked={shown} data-testid="map-stats-opt-in" onChange={event => {
      const next = event.target.checked;
      setShown(next);
      void clubRequest(OPT_IN, "PUT", { formatVersion: 1, enabled: next }).then(result => {
        if (result.status === 200) { setProblem(""); onChanged(next); } else { setShown(!next); setProblem(failure(result.status)); }
      }, () => { setShown(!next); setProblem(failure(0)); });
    }} />{text.optIn}</label>
    <p className={styles.muted}>{text.optInHelp}</p>
    {problem && <Notice tone="error" role="alert">{problem}</Notice>}
  </>;
}

/**
 * ADR-0219 (K3b): projektets statistik på projektsidan. Den egna alltid; topplistan när ägarna slagit på den (bara de som valt att
 * synas står med). Ägarna väljer om topplistan är på och hur namnen visas.
 */
export function ProjectStatsSection({ base, canDecide }: { base: string; canDecide: boolean }) {
  const failure = useMapProjectFailure();
  const text = useTexts(mapStatsSv, mapStatsEn);
  const [season, setSeason] = useState<number>();
  const [view, setView] = useState<MapProjectStatsView>();
  const [problem, setProblem] = useState("");
  const load = useCallback(async () => {
    const result = await clubRequest(withSeason(`${base}/stats`, season)).catch(() => ({ status: 0, json: undefined }));
    if (result.status === 200) { setView(result.json as MapProjectStatsView); setProblem(""); } else setProblem(failure(result.status));
  }, [base, season]);
  useEffect(() => { void load(); }, [load]);
  return <section aria-labelledby="map-project-stats" data-testid="map-project-stats">
    <h2 id="map-project-stats">{text.title}</h2>
    <SeasonSelect value={season} onChange={setSeason} />
    {problem && <Notice tone="error" role="alert">{problem}</Notice>}
    {view && <>
      <h3>{text.mine}</h3>
      <StatsNumbers stats={view.mine} testId="map-stats-mine" />
      <OptIn value={view.optedIn} onChanged={() => void load()} />
      <h3>{text.leaderboard}</h3>
      {canDecide && <label className={styles.inline}>{text.leaderboardSetting}{" "}
        <select value={view.leaderboard ?? ""} data-testid="map-stats-setting" onChange={event => {
          const value = event.target.value || null;
          void clubRequest(base, "PUT", { formatVersion: 1, leaderboard: value }).then(result => {
            if (result.status === 200) void load(); else setProblem(failure(result.status));
          });
        }}>
          <option value="">{text.settings.off}</option>
          {(["FIRST", "FULL", "NONE"] as const).map(key => <option key={key} value={key}>{text.settings[key]}</option>)}
        </select></label>}
      {view.rows ? <Leaderboard rows={view.rows} /> : <p className={styles.muted}>{text.leaderboardOff}</p>}
    </>}
  </section>;
}

/** ADR-0219 (K3b): den egna kartstatistiken i alla projekt (listan över kartprojekten). */
export function MyMapStatsSection() {
  const text = useTexts(mapStatsSv, mapStatsEn);
  const [season, setSeason] = useState<number>();
  const [view, setView] = useState<MyMapStatsView>();
  const load = useCallback(async () => {
    const result = await clubRequest(withSeason(OPT_IN, season)).catch(() => ({ status: 0, json: undefined }));
    if (result.status === 200) setView(result.json as MyMapStatsView);
  }, [season]);
  useEffect(() => { void load(); }, [load]);
  if (!view) return null;
  return <section aria-labelledby="my-map-stats" data-testid="my-map-stats">
    <h2 id="my-map-stats">{text.mine}</h2>
    <p className={styles.muted}>{text.myHelp}</p>
    <SeasonSelect value={season} onChange={setSeason} />
    {view.projects.length === 0 ? <p className={styles.muted}>{text.none}</p> : <>
      <StatsNumbers stats={view.total} testId="my-map-stats-total" />
      <ul className={styles.list}>{view.projects.map(project => <li key={project.projectId}>
        <div><Link href={`/organizer/map-projects/${project.projectId}`}>{project.name}</Link>
          <span>{[text.numbers.hectares(project.stats.hectares), text.numbers.checked(project.stats.checked),
            text.numbers.changed(project.stats.added + project.stats.changed + project.stats.deleted)].join(" · ")}</span></div>
      </li>)}</ul>
    </>}
    <OptIn value={view.optedIn} onChanged={() => void load()} />
  </section>;
}
