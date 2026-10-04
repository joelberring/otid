"use client";

import { organizerAccountSessionStatusSchema, publicResultFollowIdempotencyKey, publicResultFollowListResponseSchema, publicResultFollowSetRequestSchema, publicResultFollowSetResponseSchema, publicResultListResponseSchema, type PublicResultListResponse } from "@o-tid/contracts";
import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { sv } from "../i18n/sv";
import { courseVariantsSv as variantText } from "../i18n/course-variants-sv";
import { hasPublicResultFavorite, parsePublicResultFavorites, publicResultFavoritesStorageKey, togglePublicResultFavorite, type PublicResultFavorite } from "../lib/public-result-favorites";
import { startPublicResultEventStream } from "../lib/public-result-event-stream-client";
import { filterPublicResults, publicResultClassNames } from "../lib/public-results-filter";
import { readOrganizerCsrf } from "../lib/organizer-client";
import { formatDuration } from "../lib/clock-time";

function duration(milliseconds?: number) {
  if (milliseconds === undefined) return "–";
  return formatDuration(milliseconds);
}

function resultClass(status: PublicResultListResponse["results"][number]["status"]): string {
  if (status === "OK") return "result-ok";
  if (status === "MP") return "result-mp";
  if (status === "DSQ") return "result-dsq";
  if (status === "DNF") return "result-dnf";
  if (status === "OOC") return "result-ooc";
  if (status === "NT") return "result-nt";
  return "result-dns";
}

function controlLabel(controlCode: number, occurrence: number): string {
  return occurrence === 1 ? String(controlCode) : `${controlCode} (${occurrence})`;
}

export function hasActivePublicResultFilters(query: string, classFilter: string, favoritesOnly: boolean): boolean {
  return query.trim() !== "" || classFilter !== "" || favoritesOnly;
}

export function PublicResults({ raceId, initial }: { raceId: string; initial: PublicResultListResponse }) {
  const [rows, setRows] = useState(initial.results);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [favorites, setFavorites] = useState<PublicResultFavorite[]>([]);
  const [followMode, setFollowMode] = useState<"checking" | "local" | "loading" | "server" | "error">("checking");
  const [followedIds, setFollowedIds] = useState<string[]>([]);
  const [followError, setFollowError] = useState("");
  const [followAttempt, setFollowAttempt] = useState<{ request: { formatVersion: 1; requestId: string; raceId: string; publicResultId: string; followed: boolean }; key: string }>();
  const [followBusy, setFollowBusy] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const refreshInFlight = useRef(false);
  useEffect(() => {
    try { setFavorites(parsePublicResultFavorites(window.localStorage.getItem(publicResultFavoritesStorageKey))); } catch { /* Optional local preference. */ }
  }, []);
  useEffect(() => { void loadFollowMode(); }, [raceId]);
  useEffect(() => { if (followAttempt && followMode === "server") void saveFollowAttempt(followAttempt); }, [followAttempt, followMode]);
  async function loadFollowMode() {
    setFollowMode("checking"); setFollowError("");
    try {
      let session: Response;
      try { session = await fetch("/api/organizer/session", { credentials: "same-origin", cache: "no-store" }); }
      catch { setFollowMode("local"); setFollowError(sv.publicResultsUnknownSessionLocal); return; }
      if (session.status === 401 || session.status === 403) { setFollowMode("local"); return; }
      const sessionData = organizerAccountSessionStatusSchema.safeParse(await session.json());
      if (!session.ok || !sessionData.success) throw new Error();
      setFollowMode("loading");
      const response = await fetch("/api/participant/me/follows", { credentials: "same-origin", cache: "no-store" });
      const data = publicResultFollowListResponseSchema.safeParse(await response.json());
      if (!response.ok || !data.success) throw new Error();
      setFollowedIds(data.data.items.filter(item => item.raceId === raceId).map(item => item.publicResultId));
      setFollowMode("server");
    } catch { setFollowMode("error"); setFollowError(sv.publicResultsFollowLoadError); }
  }
  async function saveFollowAttempt(attempt: NonNullable<typeof followAttempt>) {
    if (followBusy) return;
    setFollowBusy(true); setFollowError("");
    try {
      const response = await fetch("/api/participant/me/follows", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "x-otid-csrf": readOrganizerCsrf(document.cookie, new URL(window.location.href)), "idempotency-key": attempt.key },
        body: JSON.stringify(attempt.request) });
      const data = publicResultFollowSetResponseSchema.safeParse(await response.json());
      const req = attempt.request;
      if (!response.ok || !data.success || data.data.requestId !== req.requestId || data.data.raceId !== req.raceId || data.data.publicResultId !== req.publicResultId || data.data.followed !== req.followed) {
        throw new Error(response.status === 401 || response.status === 403 ? sv.publicResultsFollowSessionError : sv.publicResultsFollowSaveError);
      }
      setFollowedIds(current => req.followed ? [...new Set([...current, req.publicResultId])] : current.filter(id => id !== req.publicResultId));
      setFollowAttempt(undefined);
    } catch (error) { setFollowError(error instanceof Error ? error.message : sv.publicResultsFollowSaveError); }
    finally { setFollowBusy(false); }
  }
  function toggleFollow(publicResultId: string) {
    const request = publicResultFollowSetRequestSchema.parse({ formatVersion: 1, requestId: crypto.randomUUID(), raceId, publicResultId, followed: !followedIds.includes(publicResultId) });
    setFollowAttempt({ request, key: publicResultFollowIdempotencyKey(request.requestId) });
  }
  const followFeedback = followMode === "checking" || followMode === "loading"
    ? <p className="public-results-follow-status" role="status">{sv.publicResultsFollowChecking}</p>
    : followMode === "local" && followError
      ? <p className="warning public-results-follow-status" role="status">{followError} <button type="button" onClick={() => void loadFollowMode()}>{sv.publicResultsFollowRetry}</button></p>
    : followMode === "error"
      ? <p className="warning public-results-follow-status" role="alert">{followError} <button type="button" onClick={() => void loadFollowMode()}>{sv.publicResultsFollowRetry}</button></p>
      : followError
        ? <p className="warning public-results-follow-status" role="alert">{followError} {followAttempt && <button type="button" disabled={followBusy} onClick={() => void saveFollowAttempt(followAttempt)}>{followBusy ? sv.publicResultsFollowSaving : sv.publicResultsFollowRetry}</button>}</p>
        : followAttempt && followBusy
          ? <p className="public-results-follow-status" role="status">{sv.publicResultsFollowSaving}</p>
          : null;
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      if (disposed || refreshInFlight.current) return;
      refreshInFlight.current = true;
      try {
        const response = await fetch(`/api/public/races/${raceId}/results`, { cache: "no-store" });
        if (!response.ok) throw new Error("Resultatuppdateringen misslyckades");
        const parsed = publicResultListResponseSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("Resultatuppdateringen hade ogiltigt format");
        if (disposed) return;
        setRows(parsed.data.results);
        setRefreshFailed(false);
        setLastRefreshAt(new Date());
      } catch {
        if (!disposed) setRefreshFailed(true);
      } finally {
        refreshInFlight.current = false;
      }
    };
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    let stopEventStream: (() => void) | undefined;
    if (typeof window.EventSource === "function") {
      stopEventStream = startPublicResultEventStream(raceId, window.EventSource, () => { void refresh(); });
    }
    return () => {
      disposed = true;
      window.clearInterval(timer);
      stopEventStream?.();
    };
  }, [raceId]);
  const classes = useMemo(() => publicResultClassNames(rows), [rows]);
  useEffect(() => {
    if (classFilter !== "" && !classes.includes(classFilter)) setClassFilter("");
  }, [classFilter, classes]);
  const filteredRows = useMemo(() => filterPublicResults(rows, query, classFilter).filter((row) =>
    !favoritesOnly || (followMode !== "server" && followMode !== "local") ||
    ("publicResultId" in row && (followMode === "server" ? followedIds.includes(row.publicResultId) :
      hasPublicResultFavorite(favorites, raceId, row.publicResultId)))
  ), [rows, query, classFilter, favoritesOnly, favorites, followedIds, followMode, raceId]);
  function toggleFavorite(publicResultId: string) {
    setFavorites((current) => {
      const next = togglePublicResultFavorite(current, { raceId, publicResultId });
      try { window.localStorage.setItem(publicResultFavoritesStorageKey, JSON.stringify(next)); } catch { /* Optional local preference. */ }
      return next;
    });
  }
  function toggleComparison(publicResultId: string) {
    setComparisonIds((current) => current.includes(publicResultId)
      ? current.filter((candidate) => candidate !== publicResultId)
      : current.length < 3 ? [...current, publicResultId] : current);
  }
  function clearFilters() {
    setQuery("");
    setClassFilter("");
    setFavoritesOnly(false);
  }
  const mixedClasses = [...new Set(filteredRows
    .filter((row) => row.rankingState === "MIXED_COURSE_VERSIONS")
    .map((row) => row.className))];
  const refreshStatus = lastRefreshAt === null
    ? sv.publicResultsRefreshing
    : sv.publicResultsRefreshedAt(lastRefreshAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  const comparisonHref = comparisonIds.length >= 2
    ? `/results/${raceId}/route-comparison?first=${encodeURIComponent(comparisonIds[0] ?? "")}&second=${encodeURIComponent(comparisonIds[1] ?? "")}${comparisonIds[2] === undefined ? "" : `&third=${encodeURIComponent(comparisonIds[2])}`}`
    : null;
  if (rows.length === 0) return <><p className="public-results-refresh-status" aria-live="polite">{refreshStatus}</p>{followFeedback}<p>{sv.publicResultsEmpty}</p>
    {refreshFailed && <p className="warning" role="alert">{sv.publicResultsRefreshFailed}</p>}</>;
  return <>
    <p className="public-results-refresh-status" aria-live="polite">{refreshStatus}</p>
    {followFeedback}
    {refreshFailed && <p className="warning" role="alert">{sv.publicResultsRefreshFailed}</p>}
    <section className="public-results-controls" aria-label={sv.publicResults}>
      <label>{sv.publicResultsSearch}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label>{sv.publicResultsClassFilter}<select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
        <option value="">{sv.publicResultsAllClasses}</option>
        {classes.map((className) => <option key={className} value={className}>{className}</option>)}
      </select></label>
      <label className="public-results-favorites-only"><input type="checkbox" checked={favoritesOnly} disabled={followMode !== "local" && followMode !== "server"} onChange={(event) => setFavoritesOnly(event.target.checked)} /> {followMode === "server" ? sv.publicResultsFollowedOnly : sv.publicResultsFavoritesOnly}</label>
      <p aria-live="polite">{sv.publicResultsShowing(filteredRows.length, rows.length)}</p>
    </section>
    <section className="public-results-route-comparison" aria-label={sv.publicResultsOpenRouteComparison}>
      <p aria-live="polite">{sv.publicResultsCompareRouteCount(comparisonIds.length)}</p>
      {comparisonHref ? <Link href={comparisonHref}>{sv.publicResultsOpenRouteComparison}</Link> : <small>{sv.publicResultsComparisonUnavailable}</small>}
    </section>
    {mixedClasses.map((className) => <p className="warning" role="alert" key={className}>
      <strong>{className}:</strong> {sv.publicResultsMixedCourseWarning}
    </p>)}
    {filteredRows.length === 0 ? <><p role="status">{sv.publicResultsNoMatches}</p>
      {hasActivePublicResultFilters(query, classFilter, favoritesOnly) && <button type="button" onClick={clearFilters}>{sv.publicResultsClearFilters}</button>}
    </> : <div className="public-results"><table className="public-results-table"><thead><tr><th>{sv.publicResultsClass}</th><th>{sv.publicResultsPosition}</th>
      <th>{sv.publicResultsParticipant}</th><th>{sv.publicResultsStatus}</th><th>{sv.publicResultsTime}</th>
      <th>{sv.publicResultsTimeBehind}</th><th>{sv.publicResultsSplits}</th>
    </tr></thead><tbody>
    {filteredRows.map((row, index) => <tr key={`${row.className}:${row.familyName}:${row.givenName}:${row.revision}:${index}`}>
      <td className="public-result-class" data-label={sv.publicResultsClass}>{row.className}</td>
      <td data-label={sv.publicResultsPosition}>{"position" in row ? row.position ?? "–" : "–"}</td>
      <td className="public-result-participant" data-label={sv.publicResultsParticipant}>{"publicResultId" in row
        ? <><Link href={`/results/${raceId}/participants/${row.publicResultId}`} aria-label={`${sv.publicResultsOpenDetail}: ${row.givenName} ${row.familyName}`}>{row.givenName} {row.familyName}</Link><small>{row.organisationName}</small><span className="public-result-actions">
          {followMode === "local" || followMode === "checking" ? <button type="button" className="public-result-favorite" aria-pressed={hasPublicResultFavorite(favorites, raceId, row.publicResultId)} disabled={followMode === "checking"} onClick={() => toggleFavorite(row.publicResultId)}>{hasPublicResultFavorite(favorites, raceId, row.publicResultId) ? sv.publicResultsRemoveFavorite : sv.publicResultsSaveFavorite}</button>
            : <button type="button" className="public-result-favorite" aria-pressed={followedIds.includes(row.publicResultId)} disabled={followMode !== "server" || followBusy || followAttempt !== undefined} onClick={() => toggleFollow(row.publicResultId)}>{followMode === "loading" ? sv.publicResultsFollowChecking : followedIds.includes(row.publicResultId) ? sv.publicResultsUnfollow : sv.publicResultsFollow}</button>}
          <button type="button" className="public-result-route-comparison" aria-pressed={comparisonIds.includes(row.publicResultId)} disabled={!comparisonIds.includes(row.publicResultId) && comparisonIds.length === 3} onClick={() => toggleComparison(row.publicResultId)}>{comparisonIds.includes(row.publicResultId) ? sv.publicResultsRemoveComparisonRoute : sv.publicResultsCompareRoute}</button></span></>
        : <>{row.givenName} {row.familyName}<small>{row.organisationName}</small></>}</td>
      <td className={resultClass(row.status)} data-label={sv.publicResultsStatus}>{sv.publicResultsStatusLabels[row.status]}<br />
        <small>{sv.publicResultsReasonLabels[row.reason]}</small></td>
      <td data-label={sv.publicResultsTime}>{"elapsedMs" in row ? duration(row.elapsedMs) : "–"}</td>
      <td data-label={sv.publicResultsTimeBehind}>{!("timeBehindMs" in row) || row.timeBehindMs === undefined ? "–" : `+${duration(row.timeBehindMs)}`}</td>
      <td className="public-result-details" data-label={sv.publicResultsSplits}>
        {"courseVariantCode" in row && row.courseVariantCode && <><small>{variantText.variantShort(row.courseVariantCode)}</small><br /></>}
        {"splits" in row && row.splits.length > 0 && <details><summary>{sv.publicResultsShowSplits}</summary><ol>
          {row.splits.map((split) => <li key={`${split.controlCode}:${split.occurrence}`}>
            <span><strong>{sv.publicResultsControl}</strong> {controlLabel(split.controlCode, split.occurrence)}</span>
            <span><strong>{sv.publicResultsLeg}</strong> {duration(split.legMs)}</span>
            <span><strong>{sv.publicResultsTotal}</strong> {duration(split.elapsedMs)}</span>
          </li>)}
        </ol></details>}
        {"missingControls" in row && row.missingControls.length > 0 && <><br /><small>{sv.publicResultsMissingControls}: {row.missingControls.join(", ")}</small></>}
        {"extraPunches" in row && row.extraPunches.length > 0 && <><br /><small>{sv.publicResultsExtraPunches}: {row.extraPunches.join(", ")}</small></>}
      </td>
    </tr>)}
  </tbody></table></div>}</>;
}
