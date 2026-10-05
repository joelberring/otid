"use client";

import { useEffect, useMemo, useState } from "react";
import { publicStartListResponseSchema, type PublicStartListResponse } from "@o-tid/contracts";
import { StartLists } from "./lists/start-lists";
import { startListFromPublication } from "../lib/lists/start-list-model";
import { formatClockTime, zonedDate } from "../lib/clock-time";
import { startListPublicationSv as text } from "../i18n/start-list-publication-sv";
import styles from "./lists/lists.module.css";

/**
 * Den publicerade startlistan (PLAN.md steg 13): samma tre vyer som i arbetsytan, utan bricka. Hämtas på nytt
 * var femte sekund så att en ny publicering syns utan omladdning.
 */
export function PublicStartList({ raceId, initial }: { raceId: string; initial: PublicStartListResponse | null }) {
  const [data, setData] = useState<PublicStartListResponse | null>(initial);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false, running = false;
    async function refresh() {
      if (running || stopped) return;
      running = true;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(`/api/races/${encodeURIComponent(raceId)}/start-list`, { cache: "no-store", credentials: "same-origin",
          signal: controller.signal });
        if (response.status === 404) { if (!stopped) { setData(null); setFailed(false); } return; }
        if (!response.ok) throw new Error("Startlistan kunde inte hämtas");
        const result = publicStartListResponseSchema.parse(await response.json());
        if (!stopped) {
          setFailed(false);
          setData(previous => previous?.revision === result.revision && previous.iofExportAvailable === result.iofExportAvailable ? previous : result);
        }
      } catch {
        // Visas som besked; senast hämtade lista ligger kvar och nästa försök sker om fem sekunder.
        if (!stopped) setFailed(true);
      } finally { window.clearTimeout(timeout); running = false; }
    }
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [raceId]);
  const model = useMemo(() => data ? startListFromPublication(data.content) : undefined, [data]);
  if (!data || !model) return <section className="public-list-heading"><h1>{text.publicTitle}</h1>
    <p role="status">{text.publicUnavailable}</p></section>;
  const zone = data.content.timeZone;
  return <>
    <section className="public-list-heading"><h1>{data.content.eventName}</h1>
      <p>{data.content.raceName} · {data.content.raceDate} · {text.publishedAt} {zonedDate(data.publishedAt, zone)} {formatClockTime(data.publishedAt, zone).slice(0, 5)}</p>
      <p className="public-list-help">{text.publicHelp}</p></section>
    {failed && <p className={styles.notice} role="alert">{text.publicRefreshFailed}</p>}
    <StartLists model={model}
      iof={data.iofExportAvailable ? { href: `/api/races/${encodeURIComponent(raceId)}/start-list/iof` } : undefined} />
  </>;
}
