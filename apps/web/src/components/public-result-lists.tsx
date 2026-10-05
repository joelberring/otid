"use client";

import { listsSv as text } from "../i18n/lists-sv";
import { ResultLists } from "./lists/result-lists";
import { useResultListData, type ResultListData } from "./lists/use-result-list-data";
import { resultListFromPublic } from "../lib/lists/result-list-model";
import { useMemo } from "react";
import styles from "./lists/lists.module.css";

/**
 * Publika resultat (PLAN.md steg 13): samma tre vyer som i arbetsytan, utan bricka. Namnen länkar till
 * löparens resultatsida. Uppdateras av sig själv.
 */
export function PublicResultLists({ raceId, initial, race, raceDate }: { raceId: string; initial: ResultListData; race: string; raceDate: string }) {
  const { data, failed } = useResultListData(raceId, initial);
  const model = useMemo(() => resultListFromPublic((data ?? initial).results, (data ?? initial).relay), [data, initial]);
  return <ResultLists model={model} raceId={raceId} race={race} raceDate={raceDate} links
    iof={{ href: `/api/public/races/${encodeURIComponent(raceId)}/iof-results` }}
    status={failed ? <p className={styles.notice} role="alert">{text.results.refreshFailed}</p> : undefined} />;
}
