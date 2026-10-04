"use client";

import React, { useEffect, useState } from "react";
import { publicStartListResponseSchema, type PublicStartListResponse } from "@o-tid/contracts";
import { StartListContent } from "./start-list-content";
import { formatStartListTime } from "../lib/start-list-time";
import { startListPublicationSv as text } from "../i18n/start-list-publication-sv";
import styles from "./public-start-list.module.css";

export function PublicStartList({ raceId }: { raceId: string }) {
  const [data, setData] = useState<PublicStartListResponse>();
  useEffect(() => {
    let stopped = false;
    let running = false;
    let active: AbortController | undefined;
    async function refresh() {
      if (running || stopped) return;
      running = true;
      const controller = new AbortController();
      active = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(`/api/races/${encodeURIComponent(raceId)}/start-list`, {
          cache: "no-store", credentials: "omit", signal: controller.signal });
        if (!response.ok) throw new Error("unavailable");
        const result = publicStartListResponseSchema.parse(await response.json());
        if (!stopped) setData((previous) => previous?.revision === result.revision &&
          previous.iofExportAvailable === result.iofExportAvailable ? previous : result);
      } catch { if (!stopped) setData(undefined); }
      finally { window.clearTimeout(timeout); active = undefined; running = false; }
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; active?.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [raceId]);
  return <div className={`stack ${styles.publication}`}>
    <p>{text.publicHelp}</p>
    {data ? <><p>{text.publishedAt}: {formatStartListTime(data.publishedAt, data.content.timeZone)}</p>
      {data.iofExportAvailable ? <a className={`start-list-export ${styles.export}`} href={`/api/races/${encodeURIComponent(raceId)}/start-list/iof`} download>{text.downloadXml}</a> : <p>{text.xmlUnavailable}</p>}
      <StartListContent key={data.revision} content={data.content} /></> : <p role="status">{text.publicUnavailable}</p>}
  </div>;
}
