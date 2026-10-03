"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { participantPrivateRouteDetailResponseSchema, participantPrivateRouteOverlayResponseSchema } from "@o-tid/contracts";
import { participantMeSv as text } from "../i18n/participant-claim-sv";
import { publicRoutePlaybackMarker } from "../lib/public-route-playback";
import { PRIVATE_ROUTE_START_OFFSET_LIMIT_SECONDS, privateRouteStartAlignment } from "../lib/private-route-start-alignment";
import { privateRouteControlTimeTarget } from "../lib/private-route-control-time";

const playbackSpeed = 20;

async function json(response: Response): Promise<unknown> { try { return await response.json(); } catch { return undefined; } }
function dateTime(value: string): string { return new Date(value).toLocaleString("sv-SE"); }
function duration(value: number): string {
  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours} h ${minutes} min ${seconds} s` : `${minutes} min ${seconds} s`;
}

function resultSplitDuration(value: number): string {
  const wholeSeconds = Math.floor(value / 1_000);
  const base = `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
  const remainder = value % 1_000;
  return remainder === 0 ? base : `${base}.${String(remainder).padStart(3, "0")}`;
}

type PrivateRouteResultSplits = NonNullable<ReturnType<typeof participantPrivateRouteOverlayResponseSchema.parse>>["resultSplits"];
type AvailablePrivateRouteResultSplits = Extract<PrivateRouteResultSplits, { status: "AVAILABLE" }>;

export function ParticipantPrivateRouteResultSplits({ resultSplits }: { resultSplits: PrivateRouteResultSplits }) {
  return <section className="participant-private-route-result-splits" aria-labelledby="participant-private-route-result-splits-title">
    {resultSplits.status === "AVAILABLE" ? <details>
        <summary id="participant-private-route-result-splits-title">{text.privateRouteResultSplitsTitle}</summary>
        <p>{text.privateRouteResultSplitsRevision} {resultSplits.resultRevision}</p>
        <p>{text.privateRouteResultSplitsPreliminary}</p>
        <p>{text.privateRouteResultSplitsGpsNotice}</p>
        <ol>
          {resultSplits.splits.map((split) => <li key={`${split.controlCode}:${split.occurrence}`}>
            <span><strong>{text.privateRouteResultSplitControl}</strong> {split.controlCode}{split.occurrence > 1 ? ` (${split.occurrence})` : ""}</span>
            <span><strong>{text.privateRouteResultSplitLeg}</strong> {resultSplitDuration(split.legMs)}</span>
            <span><strong>{text.privateRouteResultSplitElapsed}</strong> {resultSplitDuration(split.elapsedMs)}</span>
          </li>)}
        </ol>
      </details> : <>
        <h3 id="participant-private-route-result-splits-title">{text.privateRouteResultSplitsTitle}</h3>
        <p role="status">{text.privateRouteResultSplitsUnavailable}</p>
      </>}
  </section>;
}

export function ParticipantPrivateRouteControlTimeSelector({
  splits,
  selectedKey,
  disabled,
  jumpDisabled,
  status,
  onSelect,
  onJump
}: {
  splits: AvailablePrivateRouteResultSplits["splits"];
  selectedKey: string;
  disabled: boolean;
  jumpDisabled: boolean;
  status: string;
  onSelect: (key: string) => void;
  onJump: () => void;
}) {
  return <section className="participant-private-route-control-time" aria-labelledby="participant-private-route-control-time-title">
    <h3 id="participant-private-route-control-time-title">{text.privateRouteControlTimeTitle}</h3>
    <p id="participant-private-route-control-time-notice">{text.privateRouteControlTimeNotice}</p>
    <label htmlFor="private-route-control-time-select">{text.privateRouteControlTimeSelect}</label>
    <select
      id="private-route-control-time-select"
      data-testid="private-route-control-time-select"
      value={selectedKey}
      disabled={disabled}
      aria-describedby="private-route-control-time-notice private-route-control-time-status"
      onChange={(event) => onSelect(event.currentTarget.value)}
    >
      <option value="">{text.privateRouteControlTimeChoose}</option>
      {splits.map((split) => <option key={`${split.controlCode}:${split.occurrence}`} value={`${split.controlCode}:${split.occurrence}`}>
        {text.privateRouteResultSplitControl} {split.controlCode}{split.occurrence > 1 ? ` (${split.occurrence})` : ""} · {resultSplitDuration(split.elapsedMs)}
      </option>)}
    </select>
    <button
      type="button"
      data-testid="private-route-control-time-jump"
      disabled={jumpDisabled}
      aria-describedby="private-route-control-time-notice private-route-control-time-status"
      onClick={onJump}
    >{text.privateRouteControlTimeJump}</button>
    <p id="private-route-control-time-status" data-testid="private-route-control-time-status" role="status" aria-live="polite">{status}</p>
  </section>;
}

export function ParticipantPrivateRouteDetail({ routeUploadId }: { routeUploadId: string }) {
  const [item, setItem] = useState<ReturnType<typeof participantPrivateRouteDetailResponseSchema.parse>>();
  const [loaded, setLoaded] = useState(false);
  const [overlay, setOverlay] = useState<ReturnType<typeof participantPrivateRouteOverlayResponseSchema.parse>>();
  const [overlayLoaded, setOverlayLoaded] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playbackElapsedMilliseconds, setPlaybackElapsedMilliseconds] = useState(0);
  const [startOffsetText, setStartOffsetText] = useState("0");
  const [selectedControlTimeKey, setSelectedControlTimeKey] = useState("");
  const playbackElapsedRef = useRef(0);

  useEffect(() => {
    let active = true;
    void fetch(`/api/participant/me/routes/${encodeURIComponent(routeUploadId)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async response => {
        const parsed = participantPrivateRouteDetailResponseSchema.safeParse(await json(response));
        if (!response.ok || !parsed.success || parsed.data.routeUploadId !== routeUploadId) throw new Error("unavailable");
        if (active) setItem(parsed.data);
      })
      .catch(() => { if (active) setItem(undefined); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [routeUploadId]);

  useEffect(() => {
    let active = true;
    setOverlay(undefined); setOverlayLoaded(false); setMapLoaded(false); setMapFailed(false);
    setPlaying(false); playbackElapsedRef.current = 0; setPlaybackElapsedMilliseconds(0);
    setStartOffsetText("0");
    void fetch(`/api/participant/me/routes/${encodeURIComponent(routeUploadId)}/overlay`, { credentials: "same-origin", cache: "no-store" })
      .then(async response => {
        const parsed = participantPrivateRouteOverlayResponseSchema.safeParse(await json(response));
        if (!response.ok || !parsed.success || parsed.data.routeUploadId !== routeUploadId) throw new Error("unavailable");
        if (active) { setOverlay(parsed.data); setMapLoaded(false); setMapFailed(false); }
      })
      .catch(() => { if (active) setOverlay(undefined); })
      .finally(() => { if (active) setOverlayLoaded(true); });
    return () => { active = false; };
  }, [routeUploadId]);

  const playback = overlay?.playback;
  const resultStart = overlay?.resultStart;
  const gpxTiming = overlay?.metadata.timing;
  const offsetSeconds = /^-?\d+$/.test(startOffsetText) ? Number(startOffsetText) : Number.NaN;
  const startAlignment = resultStart?.status === "AVAILABLE" && gpxTiming?.status === "AVAILABLE" && playback?.status === "AVAILABLE"
    ? privateRouteStartAlignment({
      gpxStartedAt: gpxTiming.startedAt,
      resultStartedAt: resultStart.startedAt,
      offsetSeconds,
      durationMilliseconds: gpxTiming.durationMilliseconds
    })
    : null;

  useEffect(() => {
    setStartOffsetText("0");
  }, [routeUploadId, overlay?.contextRevision, resultStart?.status, resultStart?.status === "AVAILABLE" ? resultStart.resultRevision : undefined]);

  useEffect(() => {
    setSelectedControlTimeKey("");
  }, [routeUploadId, overlay]);

  const playbackDuration = playback?.status === "AVAILABLE" && overlay?.metadata.timing.status === "AVAILABLE"
    ? overlay.metadata.timing.durationMilliseconds
    : 0;
  const setPlaybackElapsed = (next: number) => {
    const value = Math.max(0, Math.min(playbackDuration, Math.round(next)));
    playbackElapsedRef.current = value;
    setPlaybackElapsedMilliseconds(value);
  };

  useEffect(() => {
    setPlaying(false);
    playbackElapsedRef.current = 0;
    setPlaybackElapsedMilliseconds(0);
  }, [playback?.status, playbackDuration]);

  useEffect(() => {
    if (!playing || playback?.status !== "AVAILABLE" || !mapLoaded || mapFailed) return;
    let animationFrame: number | undefined;
    const startedAt = window.performance.now() - playbackElapsedRef.current / playbackSpeed;
    const tick = (now: number) => {
      const next = Math.min(playbackDuration, (now - startedAt) * playbackSpeed);
      setPlaybackElapsed(next);
      if (next >= playbackDuration) { setPlaying(false); return; }
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => { if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame); };
  }, [playing, playback?.status, playbackDuration, mapLoaded, mapFailed]);

  const trackPath = useMemo(() => overlay?.points.reduce((value, point, index, points) => `${value}${index === 0 || point.segment !== points[index - 1]?.segment ? "M" : "L"}${point.x} ${point.y} `, "") ?? "", [overlay]);
  const playbackMarker = overlay && playback?.status === "AVAILABLE" && mapLoaded && !mapFailed
    ? publicRoutePlaybackMarker(overlay.points, playback.pointElapsedMilliseconds, playbackElapsedMilliseconds)
    : null;
  const overlayIsCurrent = overlay?.routeUploadId === routeUploadId;
  const availableResultSplits = overlay?.resultSplits.status === "AVAILABLE" ? overlay.resultSplits : undefined;
  const availableResultStart = overlay?.resultStart.status === "AVAILABLE" ? overlay.resultStart : undefined;
  const resultTimesMatch = Boolean(availableResultSplits && availableResultStart && availableResultSplits.resultRevision === availableResultStart.resultRevision);
  const controlTimeSplits = overlayIsCurrent && resultTimesMatch && availableResultSplits ? availableResultSplits.splits : [];
  const selectedControlTime = controlTimeSplits.find(split => `${split.controlCode}:${split.occurrence}` === selectedControlTimeKey);
  const canSelectControlTime = Boolean(overlayIsCurrent && resultTimesMatch && gpxTiming?.status === "AVAILABLE" && playback?.status === "AVAILABLE");
  const controlTimeTarget = selectedControlTime && availableResultStart && gpxTiming?.status === "AVAILABLE" && playback?.status === "AVAILABLE"
    ? privateRouteControlTimeTarget({
      gpxStartedAt: gpxTiming.startedAt,
      resultStartedAt: availableResultStart.startedAt,
      offsetSeconds,
      splitElapsedMilliseconds: selectedControlTime.elapsedMs,
      durationMilliseconds: playbackDuration
    })
    : null;
  const controlTimeMarker = controlTimeTarget?.status === "IN_RANGE" && overlay && playback?.status === "AVAILABLE"
    ? publicRoutePlaybackMarker(overlay.points, playback.pointElapsedMilliseconds, controlTimeTarget.elapsedMilliseconds)
    : null;
  const controlTimeStatus = !overlayIsCurrent || !resultTimesMatch
    ? text.privateRouteControlTimeUnavailable
    : gpxTiming?.status !== "AVAILABLE" || playback?.status !== "AVAILABLE"
      ? text.privateRouteControlTimeGpxUnavailable
      : !selectedControlTime
        ? ""
        : !controlTimeTarget
          ? text.privateRouteControlTimeOffsetInvalid
          : controlTimeTarget.status === "OUT_OF_RANGE"
            ? text.privateRouteControlTimeOutOfRange
            : !controlTimeMarker
              ? text.privateRouteControlTimeGap
              : text.privateRouteControlTimeReady;
  const controlTimeJumpDisabled = !canSelectControlTime || !selectedControlTime || !mapLoaded || mapFailed || controlTimeTarget?.status !== "IN_RANGE";

  return <main className="participant-me participant-private-route-detail" aria-labelledby="participant-private-route-title">
    <Link href="/me">{text.privateRouteBack}</Link>
    <h1 id="participant-private-route-title">{text.privateRouteTitle}</h1>
    {!loaded && <p aria-live="polite">{text.loading}</p>}
    {loaded && !item && <p role="status">{text.privateRouteUnavailable}</p>}
    {item && <>
      <section className="panel stack">
        <h2>{item.eventName}</h2>
        <p>{text.race}: {item.raceName}</p>
        <p>{text.privateRouteStoredAt} {dateTime(item.storedAt)}</p>
        <section aria-labelledby="participant-private-route-sharing-title">
          <h3 id="participant-private-route-sharing-title">{text.privateRouteSharingTitle}</h3>
          <dl>
            <dt>{text.privateRouteConsent}</dt>
            <dd>{item.sharing.consent === "GRANTED" ? text.privateRouteConsentGranted : text.privateRouteConsentNotGranted}</dd>
            <dt>{text.privateRouteAdminRelease}</dt>
            <dd>{item.sharing.adminRelease === "ACTIVE" ? text.privateRouteAdminReleaseActive : text.privateRouteAdminReleaseInactive}</dd>
            <dt>{text.privateRoutePublicAvailability}</dt>
            <dd>{item.sharing.publicRoute.status === "AVAILABLE"
              ? <><span>{text.privateRoutePublicAvailable}</span>{" "}<Link href={`/results/${encodeURIComponent(item.raceId)}/participants/${encodeURIComponent(item.sharing.publicRoute.publicResultId)}/route`}>{text.privateRoutePublicLink}</Link></>
              : text.privateRoutePublicUnavailable}</dd>
          </dl>
          <p>{text.privateRouteSharingExplanation}</p>
        </section>
        <dl>
          <dt>{text.privateRouteDistance}</dt><dd>{(item.metadata.distanceMeters / 1000).toLocaleString("sv-SE", { maximumFractionDigits: 2 })} km</dd>
          <dt>{text.privateRoutePoints}</dt><dd>{item.metadata.pointCount}</dd>
          <dt>{text.privateRouteSegments}</dt><dd>{item.metadata.segmentCount}</dd>
          <dt>{text.privateRouteDuration}</dt>
          <dd>{item.metadata.timing.status === "AVAILABLE"
            ? `${dateTime(item.metadata.timing.startedAt)} – ${dateTime(item.metadata.timing.finishedAt)} (${duration(item.metadata.timing.durationMilliseconds)})`
            : text.privateRouteTimeUnavailable}</dd>
        </dl>
      </section>
      {!overlayLoaded && <p aria-live="polite">{text.privateRouteOverlayLoading}</p>}
      {overlayLoaded && !overlay && <p className="warning" role="status">{text.privateRouteOverlayMissing}</p>}
      {overlay && <section className="panel stack" aria-label={text.privateRouteOverlayLabel}>
        <h2>{text.privateRouteOverlayLabel}</h2>
        <p>{text.privateRouteContextNotice}</p>
        <p className="warning">{text.privateRouteGpsNotice}</p>
        <ParticipantPrivateRouteResultSplits resultSplits={overlay.resultSplits} />
        <section className="participant-private-route-start-alignment" aria-labelledby="participant-private-route-start-alignment-title" data-testid="private-route-start-alignment">
          <h3 id="participant-private-route-start-alignment-title">{text.privateRouteStartAlignmentTitle}</h3>
          <p>{text.privateRouteStartAlignmentNotice}</p>
          <p>{text.privateRouteStartPreliminary}</p>
          <dl>
            <dt>{text.privateRouteStartGpxClock}</dt>
            <dd>{gpxTiming?.status === "AVAILABLE" ? dateTime(gpxTiming.startedAt) : text.privateRouteStartGpxUnavailable}</dd>
            <dt>{text.privateRouteStartResultClock}</dt>
            <dd>{resultStart?.status === "AVAILABLE"
              ? <>{dateTime(resultStart.startedAt)} · {text.privateRouteResultSplitsRevision} {resultStart.resultRevision}</>
              : text.privateRouteStartUnavailable}</dd>
          </dl>
          <label>{text.privateRouteStartOffset}
            <input
              data-testid="private-route-start-offset"
              type="number"
              inputMode="numeric"
              min={-PRIVATE_ROUTE_START_OFFSET_LIMIT_SECONDS}
              max={PRIVATE_ROUTE_START_OFFSET_LIMIT_SECONDS}
              step="1"
              value={startOffsetText}
              disabled={resultStart?.status !== "AVAILABLE" || gpxTiming?.status !== "AVAILABLE" || playback?.status !== "AVAILABLE"}
              onChange={(event) => setStartOffsetText(event.currentTarget.value)}
              aria-describedby="participant-private-route-start-offset-help"
            />
          </label>
          <p id="participant-private-route-start-offset-help">{text.privateRouteStartOffsetHelp}</p>
          <div>
            <button
              data-testid="private-route-start-jump"
              type="button"
              disabled={!mapLoaded || mapFailed || startAlignment?.status !== "IN_RANGE"}
              onClick={() => {
                if (!startAlignment || startAlignment.status !== "IN_RANGE") return;
                setPlaying(false);
                setPlaybackElapsed(startAlignment.elapsedMilliseconds);
              }}
            >{text.privateRouteStartJump}</button>
            <button
              className="secondary"
              data-testid="private-route-start-reset"
              type="button"
              onClick={() => setStartOffsetText("0")}
            >{text.privateRouteStartReset}</button>
          </div>
          <p className="warning" role="status" data-testid="private-route-start-alignment-status">
            {resultStart?.status !== "AVAILABLE"
              ? text.privateRouteStartUnavailable
              : gpxTiming?.status !== "AVAILABLE" || playback?.status !== "AVAILABLE"
                ? text.privateRouteStartGpxUnavailable
                : !startAlignment
                  ? text.privateRouteStartOffsetInvalid
                  : startAlignment.status === "OUT_OF_RANGE"
                    ? text.privateRouteStartOutOfRange
                    : ""}
          </p>
        </section>
        {availableResultSplits && <ParticipantPrivateRouteControlTimeSelector
          splits={controlTimeSplits}
          selectedKey={selectedControlTime ? selectedControlTimeKey : ""}
          disabled={!canSelectControlTime}
          jumpDisabled={controlTimeJumpDisabled}
          status={controlTimeStatus}
          onSelect={setSelectedControlTimeKey}
          onJump={() => {
            const currentSplit = controlTimeSplits.find(split => `${split.controlCode}:${split.occurrence}` === selectedControlTimeKey);
            if (!currentSplit || !availableResultStart || gpxTiming?.status !== "AVAILABLE" || playback?.status !== "AVAILABLE") return;
            const target = privateRouteControlTimeTarget({
              gpxStartedAt: gpxTiming.startedAt,
              resultStartedAt: availableResultStart.startedAt,
              offsetSeconds,
              splitElapsedMilliseconds: currentSplit.elapsedMs,
              durationMilliseconds: playbackDuration
            });
            if (!target || target.status !== "IN_RANGE") return;
            if (!mapLoaded || mapFailed) return;
            setPlaying(false);
            setPlaybackElapsed(target.elapsedMilliseconds);
          }}
        />}
        {playback?.status === "UNAVAILABLE" && <p className="warning" role="status">{text.privateRoutePlaybackUnavailable}</p>}
        {mapFailed && <p className="warning" role="status">{text.privateRouteMapUnavailable}</p>}
        {playback?.status === "AVAILABLE" && <section className="participant-private-route-playback" aria-label={text.privateRoutePlaybackTitle}>
          <h2>{text.privateRoutePlaybackTitle}</h2>
          <p>{text.privateRoutePlaybackNotice}</p>
          <div>
            <button type="button" disabled={!mapLoaded || mapFailed} onClick={() => {
              if (playing) { setPlaying(false); return; }
              if (playbackElapsedRef.current >= playbackDuration) setPlaybackElapsed(0);
              setPlaying(true);
            }}>{playing ? text.privateRoutePlaybackPause : text.privateRoutePlaybackPlay}</button>
            <button className="secondary" type="button" disabled={!mapLoaded || mapFailed} onClick={() => { setPlaying(false); setPlaybackElapsed(0); }}>{text.privateRoutePlaybackRestart}</button>
            <output aria-live="polite">{duration(playbackElapsedMilliseconds)} / {duration(playbackDuration)}</output>
          </div>
          <label>{text.privateRoutePlaybackTimeline}
            <input type="range" min="0" max={playbackDuration} step="1000" value={playbackElapsedMilliseconds} disabled={!mapLoaded || mapFailed} onChange={(event) => { setPlaying(false); setPlaybackElapsed(Number(event.currentTarget.value)); }} />
          </label>
        </section>}
        {!mapFailed && <div className="participant-private-route-map">
          <svg viewBox={`0 0 ${overlay.imageWidth} ${overlay.imageHeight}`} role="img" aria-label={text.privateRouteOverlayLabel}>
            <image href={`/api/participant/me/routes/${encodeURIComponent(routeUploadId)}/map?contextRevision=${overlay.contextRevision}`} width={overlay.imageWidth} height={overlay.imageHeight} onLoad={() => setMapLoaded(true)} onError={() => { setMapLoaded(false); setMapFailed(true); setPlaying(false); }} />
            {mapLoaded && <path d={trackPath} fill="none" stroke="#b00020" strokeWidth={Math.max(2, Math.min(overlay.imageWidth, overlay.imageHeight) / 400)} strokeLinecap="round" strokeLinejoin="round" />}
            {playbackMarker && <circle className="participant-private-route-playback-marker" cx={playbackMarker.x} cy={playbackMarker.y} r={Math.max(5, Math.min(overlay.imageWidth, overlay.imageHeight) / 80)} />}
            {mapLoaded && overlay.controls.map(control => <g key={control.sequence}>
              <circle cx={control.x} cy={control.y} r={Math.max(5, Math.min(overlay.imageWidth, overlay.imageHeight) / 140)} fill="#fff" stroke="#111" strokeWidth={2} />
              <text x={control.x} y={control.y} textAnchor="middle" dominantBaseline="central" fontSize={Math.max(8, Math.min(overlay.imageWidth, overlay.imageHeight) / 100)} fill="#111">{control.controlCode}</text>
            </g>)}
          </svg>
        </div>}
      </section>}
    </>}
  </main>;
}
