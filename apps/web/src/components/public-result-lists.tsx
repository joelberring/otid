"use client";

import { listsSv as text } from "../i18n/lists-sv";
import { ResultLists, type ResultListFollow } from "./lists/result-lists";
import { useResultListData, type ResultListData } from "./lists/use-result-list-data";
import { resultListFromPublic } from "../lib/lists/result-list-model";
import { followStore, useFollows } from "../lib/follow-store";
import { FollowStar } from "./follow-star";
import { useMemo } from "react";
import styles from "./lists/lists.module.css";

/**
 * Publika resultat (PLAN.md steg 13): samma tre vyer som i arbetsytan, utan bricka. Namnen länkar till
 * löparens resultatsida. Uppdateras av sig själv. Stjärnorna följer löpare och klubbar (PLAN.md steg 30; sparas bara i
 * webbläsaren och syns överst i Live).
 */
export function PublicResultLists({ raceId, initial, race, raceDate }: { raceId: string; initial: ResultListData; race: string; raceDate: string }) {
  const { data, failed } = useResultListData(raceId, initial);
  const model = useMemo(() => resultListFromPublic((data ?? initial).results, (data ?? initial).relay, (data ?? initial).radio), [data, initial]);
  const follows = useFollows();
  const follow = useMemo<ResultListFollow>(() => ({
    runner: row => row.publicResultId && <FollowStar compact name={row.name}
      followed={follows.runners.some(runner => runner.raceId === raceId && runner.publicResultId === row.publicResultId)}
      onToggle={() => followStore.toggleRunner({ raceId, publicResultId: row.publicResultId!, name: row.name, club: row.club, className: row.className })} />,
    club: club => <FollowStar compact name={club} followed={follows.clubs.includes(club)} onToggle={() => followStore.toggleClub(club)} />
  }), [follows, raceId]);
  return <ResultLists model={model} raceId={raceId} race={race} raceDate={raceDate} links follow={follow}
    iof={{ href: `/api/public/races/${encodeURIComponent(raceId)}/iof-results` }}
    status={failed ? <p className={styles.notice} role="alert">{text.results.refreshFailed}</p> : undefined} />;
}
