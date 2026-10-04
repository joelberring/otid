"use client";

import { publicResultDetailResponseSchema, type PublicResultDetailResponse } from "@o-tid/contracts";
import React, { useEffect, useRef, useState } from "react";
import { sv } from "../i18n/sv";
import { courseVariantsSv as variantText } from "../i18n/course-variants-sv";
import { startPublicResultEventStream } from "../lib/public-result-event-stream-client";
import { formatDuration } from "../lib/clock-time";

function duration(milliseconds?: number) {
  if (milliseconds === undefined) return "–";
  return formatDuration(milliseconds);
}

function resultClass(status: PublicResultDetailResponse["result"]["status"]): string {
  if (status === "OK") return "result-ok";
  if (status === "MP") return "result-mp";
  if (status === "DSQ") return "result-dsq";
  if (status === "DNF") return "result-dnf";
  if (status === "OOC") return "result-ooc";
  if (status === "NT") return "result-nt";
  return "result-dns";
}

export function PublicResultDetail({ raceId, publicResultId, initial }: {
  raceId: string; publicResultId: string; initial: PublicResultDetailResponse;
}) {
  const [response, setResponse] = useState(initial);
  const [unavailable, setUnavailable] = useState(false);
  const refreshInFlight = useRef(false);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      if (disposed || refreshInFlight.current) return;
      refreshInFlight.current = true;
      try {
        const result = await fetch(`/api/public/races/${raceId}/results/${publicResultId}`, { cache: "no-store" });
        if (!result.ok) { if (!disposed) setUnavailable(true); return; }
        const parsed = publicResultDetailResponseSchema.safeParse(await result.json());
        if (!parsed.success) { if (!disposed) setUnavailable(true); return; }
        if (disposed) return;
        setResponse(parsed.data); setUnavailable(false);
      } catch {
        // Keep the last verified public result visible until the next poll.
      } finally {
        refreshInFlight.current = false;
      }
    };
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    const stopEventStream = typeof window.EventSource === "function"
      ? startPublicResultEventStream(raceId, window.EventSource, () => { void refresh(); })
      : undefined;
    return () => {
      disposed = true;
      window.clearInterval(timer);
      stopEventStream?.();
    };
  }, [raceId, publicResultId]);
  if (unavailable) return <p role="alert">{sv.publicResultUnavailable}</p>;
  const { result } = response;
  const hasTimeBehind = "timeBehindMs" in result && result.timeBehindMs !== undefined;
  return <article className="public-result-detail">
    <header><p className="muted">{result.className}{"courseVariantCode" in result && result.courseVariantCode && ` · ${variantText.variantShort(result.courseVariantCode)}`}</p><h2>{result.givenName} {result.familyName}</h2>{result.organisationName && <p>{result.organisationName}</p>}</header>
    <dl><div><dt>{sv.publicResultsPosition}</dt><dd>{"position" in result ? result.position ?? "–" : "–"}</dd></div>
      <div><dt>{sv.publicResultsStatus}</dt><dd className={resultClass(result.status)}>{sv.publicResultsStatusLabels[result.status]}<br /><small>{sv.publicResultsReasonLabels[result.reason]}</small></dd></div>
      <div><dt>{sv.publicResultsTime}</dt><dd>{"elapsedMs" in result ? duration(result.elapsedMs) : "–"}</dd></div>
      <div><dt>{sv.publicResultsTimeBehind}</dt><dd>{hasTimeBehind ? `+${duration(result.timeBehindMs)}` : "–"}</dd></div>
    </dl>
    {"missingControls" in result && result.missingControls.length > 0 && <p><strong>{sv.publicResultsMissingControls}:</strong> {result.missingControls.join(", ")}</p>}
    {"extraPunches" in result && result.extraPunches.length > 0 && <p><strong>{sv.publicResultsExtraPunches}:</strong> {result.extraPunches.join(", ")}</p>}
    {"splits" in result && result.splits.length > 0 && <details><summary>{sv.publicResultsShowSplits}</summary><ol>
      {result.splits.map((split) => <li key={`${split.controlCode}:${split.occurrence}`}>
        <span><strong>{sv.publicResultsControl}</strong> {split.controlCode}{split.occurrence > 1 ? ` (${split.occurrence})` : ""}</span>
        <span><strong>{sv.publicResultsLeg}</strong> {duration(split.legMs)}</span>
        <span><strong>{sv.publicResultsTotal}</strong> {duration(split.elapsedMs)}</span>
      </li>)}
    </ol></details>}
  </article>;
}
