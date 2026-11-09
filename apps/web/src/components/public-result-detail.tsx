"use client";

import { publicResultDetailResponseSchema, type PublicResultDetailResponse } from "@o-tid/contracts";
import { courseVariantsEn } from "../i18n/workspace-tools-en";
import React, { useEffect, useRef, useState } from "react";
import { courseVariantsSv } from "../i18n/course-variants-sv";
import { useListTexts } from "./lists/use-list-texts";
import { publicResultEn, publicResultSv } from "../i18n/public-en";
import { useTexts } from "./language-provider";
import { startPublicResultEventStream } from "../lib/public-result-event-stream-client";
import { anyStale, staleRetryMs } from "../lib/public-stale";
import { STALE_RETRY_MS, timerShouldFetch } from "../lib/use-public-race-data";
import { formatDuration } from "../lib/clock-time";
import { forkingSv } from "../i18n/forking-sv";
import { RunnerForking } from "./forking/runner-forking";
import { PublicRunnerControlMap } from "./control-map/runner-control-map";

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
  const variantText = useTexts(courseVariantsSv, courseVariantsEn);
  const text = useTexts(publicResultSv, publicResultEn), listTexts = useListTexts();
  const [response, setResponse] = useState(initial);
  const [unavailable, setUnavailable] = useState(false);
  const [showForking, setShowForking] = useState(false);
  const refreshInFlight = useRef(false);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      if (disposed || refreshInFlight.current) return;
      refreshInFlight.current = true;
      lastFetch = Date.now();
      try {
        const result = await fetch(`/api/public/races/${raceId}/results/${publicResultId}`, { cache: "no-store" });
        // Steg 54: många besökare (503) – raden som visas ligger kvar, nytt försök efter Retry-After.
        const busy = result.status === 503 ? (Number(result.headers.get("retry-after")) || 3) * 1_000 : undefined;
        if (busy === undefined && !result.ok) { if (!disposed) setUnavailable(true); return; }
        if ((busy !== undefined || anyStale(result)) && retry === undefined) {
          retry = window.setTimeout(() => { retry = undefined; void refresh(); },
            (busy ?? staleRetryMs(result) ?? STALE_RETRY_MS.minMs) + Math.random() * STALE_RETRY_MS.spreadMs);
        }
        if (busy !== undefined) return;
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
    // Steg 51: med öppen resultatström hämtar sidan av sig själv bara som reserv (`timerShouldFetch`).
    let streamOpen = false, lastFetch = 0, retry: number | undefined;
    const timer = window.setInterval(() => { if (timerShouldFetch(streamOpen, lastFetch, Date.now(), 5_000)) void refresh(); }, 5_000);
    const stopEventStream = typeof window.EventSource === "function"
      ? startPublicResultEventStream(raceId, window.EventSource, () => { void refresh(); }, undefined, (open) => { streamOpen = open; })
      : undefined;
    return () => {
      disposed = true;
      window.clearInterval(timer); window.clearTimeout(retry);
      stopEventStream?.();
    };
  }, [raceId, publicResultId]);
  if (unavailable) return <p role="alert">{text.unavailable}</p>;
  const { result } = response;
  const hasTimeBehind = "timeBehindMs" in result && result.timeBehindMs !== undefined;
  // Rogaining (ADR-0170 beslut 5): summan i stället för tid efter, och de räknade kontrollerna.
  const rogaining = "rogaining" in result ? result.rogaining : undefined;
  return <article className="public-result-detail">
    <header><p className="muted">{result.className}{"courseVariantCode" in result && result.courseVariantCode && ` · ${variantText.variantShort(result.courseVariantCode)}`}</p><h2>{result.givenName} {result.familyName}</h2>{result.organisationName && <p>{result.organisationName}</p>}</header>
    <dl><div><dt>{text.position}</dt><dd>{"position" in result ? result.position ?? "–" : "–"}</dd></div>
      <div><dt>{text.status}</dt><dd className={resultClass(result.status)}>{text.statusLabels[result.status]}<br /><small>{text.reasonLabels[result.reason]}</small></dd></div>
      <div><dt>{text.time}</dt><dd>{"elapsedMs" in result ? duration(result.elapsedMs) : "–"}</dd></div>
      {rogaining ? <div><dt>{listTexts.results.total}</dt><dd>{listTexts.results.pointsShort(rogaining.total)}<br />
        <small>{listTexts.results.points} {rogaining.controlPoints} · {listTexts.results.penalty} {rogaining.penalty}</small></dd></div>
        : <div><dt>{text.behind}</dt><dd>{hasTimeBehind ? `+${duration(result.timeBehindMs)}` : "–"}</dd></div>}
    </dl>
    {rogaining && rogaining.controls.length > 0 && <p><strong>{listTexts.results.scoredControls}:</strong> {rogaining.controls
      .map(control => listTexts.results.scoredControl(control.controlCode, control.points)).join(", ")}</p>}
    {"missingControls" in result && result.missingControls.length > 0 && <p><strong>{text.missing}:</strong> {result.missingControls.join(", ")}</p>}
    {"extraPunches" in result && result.extraPunches.length > 0 && <p><strong>{text.extra}:</strong> {result.extraPunches.join(", ")}</p>}
    {/* Steg 49: gafflad klass: banbilden med löparens variant ("Visa gafflingar"). */}
    {response.classCourse?.forking && "courseVariantCode" in result && result.courseVariantCode && <section className="public-result-forking">
      <button type="button" className="secondary" aria-pressed={showForking} onClick={() => setShowForking(!showForking)}>{forkingSv.showForking}</button>
      {showForking && <RunnerForking view={response.classCourse.forking} code={result.courseVariantCode}
        name={`${result.givenName} ${result.familyName}`} compact={false} />}
    </section>}
    {/* Steg 52: löparens bana på kartan, bara när banorna är publika (ADR-0176). */}
    {response.controlMap && <PublicRunnerControlMap raceId={raceId} publicResultId={publicResultId} />}
    {"splits" in result && result.splits && result.splits.length > 0 && <details><summary>{text.showSplits}</summary><ol>
      {result.splits.map((split) => <li key={`${split.controlCode}:${split.occurrence}`}>
        <span><strong>{text.control}</strong> {split.controlCode}{split.occurrence > 1 ? ` (${split.occurrence})` : ""}</span>
        <span><strong>{text.leg}</strong> {duration(split.legMs)}</span>
        <span><strong>{text.total}</strong> {duration(split.elapsedMs)}</span>
      </li>)}
    </ol></details>}
  </article>;
}
