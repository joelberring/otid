"use client";

import { useEffect, useMemo, useState } from "react";
import { publicStartListResponseSchema, type PublicStartListResponse } from "@o-tid/contracts";
import { StartLists } from "./lists/start-lists";
import { startListFromPublication } from "../lib/lists/start-list-model";
import { formatClockTime, zonedDate } from "../lib/clock-time";
import { startListPublicationSv } from "../i18n/start-list-publication-sv";
import { publicPagesEn } from "../i18n/public-en";
import { useLanguage } from "./language-provider";
import styles from "./lists/lists.module.css";
import { raceDetails } from "@o-tid/domain";
import { inLanguage } from "../lib/in-language";

/**
 * Den publicerade startlistan (PLAN.md steg 13): samma tre vyer som i arbetsytan; bricka bara när tävlingen visar
 * bricknummer (steg 33, inställningen gäller direkt även för en redan publicerad lista). Hämtas på nytt
 * var femte sekund så att en ny publicering syns utan omladdning.
 */
export function PublicStartList({ raceId, initial }: { raceId: string; initial: PublicStartListResponse | null | undefined }) {
  // Steg 51: undefined = en stor startlista som inte skickades med sidan; den hämtas direkt.
  const en = useLanguage() === "en";
  const text = en ? { publicTitle: publicPagesEn.startListTitle, publicUnavailable: publicPagesEn.startListUnavailable,
    publicLoading: publicPagesEn.startListLoading, publicHelp: publicPagesEn.startListHelp, publicRefreshFailed: publicPagesEn.startListRefreshFailed,
    publicVariantsHidden: publicPagesEn.startListVariantsHidden, publishedAt: publicPagesEn.publishedAt, publicLive: publicPagesEn.liveUpdating }
    : startListPublicationSv;
  const [data, setData] = useState<PublicStartListResponse | null | undefined>(initial);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false, running = false;
    let cached: { url: string; etag: string; value: PublicStartListResponse } | undefined;
    const url = `/api/races/${encodeURIComponent(raceId)}/start-list`;
    async function refresh() {
      if (running || stopped) return;
      running = true;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(url, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
          ...(cached && cached.url === url ? { headers: { "if-none-match": cached.etag } } : {})
        });
        if (response.status === 304 && cached && cached.url === url) {
          const nextEtag = response.headers.get("etag");
          if (nextEtag) cached = { ...cached, etag: nextEtag };
          if (!stopped) setFailed(false);
          return;
        }
        if (response.status === 404) { cached = undefined; if (!stopped) { setData(null); setFailed(false); } return; }
        // Steg 54: många besökare (503) – listan som visas ligger kvar utan felbesked; nästa försök om fem sekunder.
        if (response.status === 503) return;
        if (!response.ok) throw new Error(inLanguage("Startlistan kunde inte hämtas", "The start list could not be loaded"));
        const result = publicStartListResponseSchema.parse(await response.json());
        const etag = response.headers.get("etag");
        cached = etag ? { url, etag, value: result } : undefined;
        if (!stopped) {
          setFailed(false);
          // ADR-0186: med dolda varianter ändras listan när starttiderna passerar, utan ny revision.
          setData(previous => !result.live && !previous?.live && previous?.revision === result.revision && previous.iofExportAvailable === result.iofExportAvailable &&
            previous.showCardNumbers === result.showCardNumbers && !result.variantsHiddenUntilStart && !previous.variantsHiddenUntilStart ? previous : result);
        }
      } catch {
        // Visas som besked; senast hämtade lista ligger kvar och nästa försök sker om fem sekunder.
        if (!stopped) setFailed(true);
      } finally { window.clearTimeout(timeout); running = false; }
    }
    if (initial === undefined) void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(onVisible, 5_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [raceId]);
  const model = useMemo(() => data ? startListFromPublication(data.content, data.showCardNumbers) : undefined, [data]);
  if (!data || !model) return <section className="public-list-heading"><h1>{text.publicTitle}</h1>
    <p role="status">{data === undefined && !failed ? text.publicLoading : text.publicUnavailable}</p></section>;
  const zone = data.content.timeZone;
  return <>
    <section className="public-list-heading"><h1>{data.content.eventName}</h1>
      <p>{raceDetails(data.content.eventName, data.content.raceName, [data.content.raceDate])} · {data.live ? text.publicLive
        : <>{text.publishedAt} {zonedDate(data.publishedAt, zone)} {formatClockTime(data.publishedAt, zone).slice(0, 5)}</>}</p>
      <p className="public-list-help">{text.publicHelp}</p>
      {data.variantsHiddenUntilStart && <p className="public-list-help" data-testid="public-variants-hidden">{text.publicVariantsHidden}</p>}</section>
    {failed && <p className={styles.notice} role="alert">{text.publicRefreshFailed}</p>}
    <StartLists model={model} clubInUrl
      iof={data.iofExportAvailable ? { href: `/api/races/${encodeURIComponent(raceId)}/start-list/iof` } : undefined} />
  </>;
}
