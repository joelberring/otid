"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { adminCourseControlGeometryStateResponseSchema, adminMapAssetStateResponseSchema, adminMapGeoreferenceStateResponseSchema, adminPrivateRouteContextStateResponseSchema, adminPublicParticipantRoutePublicationStateSchema, privateRouteContextBindResponseSchema, privateRoutePreviewCandidatesResponseSchema, privateRoutePreviewResponseSchema, privateRouteContextBindRequestSchema, publicParticipantRouteReleaseResponseSchema, publicParticipantRouteWithdrawResponseSchema, type PrivateRoutePreviewResponse } from "@o-tid/contracts";
import { privateRoutePreviewSv as text } from "../i18n/private-route-preview-sv";
import { readRaceAdministratorCsrfCookie } from "../lib/race-administrator-cookies";

async function json(response: Response): Promise<unknown> { try { return await response.json(); } catch { return undefined; } }
function csrf(): string | undefined { return typeof document === "undefined" ? undefined : readRaceAdministratorCsrfCookie(document.cookie, new URL(window.location.href)); }
export function PrivateRoutePreview({ raceId }: { raceId: string }) {
  const bindRetry = useRef<{ body: string; key: string } | null>(null);
  const base = `/api/admin/races/${raceId}`, [routes, setRoutes] = useState<ReturnType<typeof privateRoutePreviewCandidatesResponseSchema.parse>["routes"]>([]);
  const [maps, setMaps] = useState<ReturnType<typeof adminMapAssetStateResponseSchema.parse>["storedCandidates"]>([]);
  const [georeferences, setGeoreferences] = useState<ReturnType<typeof adminMapGeoreferenceStateResponseSchema.parse>["georeferences"]>([]);
  const [geometries, setGeometries] = useState<ReturnType<typeof adminCourseControlGeometryStateResponseSchema.parse>["geometries"]>([]);
  const [routeId, setRouteId] = useState(""), [mapId, setMapId] = useState(""), [georeferenceId, setGeoreferenceId] = useState(""), [geometryRevisionId, setGeometryRevisionId] = useState(""), [contextRevision, setContextRevision] = useState(0), [contextMessage, setContextMessage] = useState<string>(text.contextNone), [preview, setPreview] = useState<PrivateRoutePreviewResponse>(), [previewKey, setPreviewKey] = useState(""), [publication, setPublication] = useState<{ publicationId: string; revision: number }>(), [publicationRevision, setPublicationRevision] = useState(0), [message, setMessage] = useState("");
  useEffect(() => { void (async () => {
    const [routeResponse, mapResponse, geoResponse, geometryResponse] = await Promise.all([fetch(`${base}/route-preview/candidates`, { cache: "no-store" }), fetch(`${base}/map`, { cache: "no-store" }), fetch(`${base}/map/georeferences`, { cache: "no-store" }), fetch(`${base}/course-control-geometries`, { cache: "no-store" })]);
    const r = privateRoutePreviewCandidatesResponseSchema.safeParse(await json(routeResponse)), m = adminMapAssetStateResponseSchema.safeParse(await json(mapResponse)), g = adminMapGeoreferenceStateResponseSchema.safeParse(await json(geoResponse)), c = adminCourseControlGeometryStateResponseSchema.safeParse(await json(geometryResponse));
    if (!routeResponse.ok || !mapResponse.ok || !geoResponse.ok || !geometryResponse.ok || !r.success || !m.success || !g.success || !c.success || r.data.raceId !== raceId || m.data.raceId !== raceId || g.data.raceId !== raceId || c.data.raceId !== raceId) { setMessage(text.unavailable); return; }
    setRoutes(r.data.routes); setMaps(m.data.storedCandidates); setGeoreferences(g.data.georeferences); setGeometries(c.data.geometries); setRouteId(r.data.routes[0]?.routeUploadId ?? ""); setMapId(m.data.storedCandidates[0]?.uploadId ?? "");
  })(); }, [base, raceId]);
  const matching = useMemo(() => georeferences.filter(item => item.manifestId === mapId), [georeferences, mapId]);
  const matchingGeometries = useMemo(() => geometries.filter(item => item.mapManifestId === mapId && item.georeferenceId === georeferenceId), [geometries, mapId, georeferenceId]);
  useEffect(() => setGeoreferenceId(current => matching.some(item => item.georeferenceId === current) ? current : (matching[0]?.georeferenceId ?? "")), [matching]);
  useEffect(() => setGeometryRevisionId(current => matchingGeometries.some(item => item.geometryRevisionId === current) ? current : ""), [matchingGeometries]);
  useEffect(() => {
    if (!routeId) return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`${base}/route-context?${new URLSearchParams({ routeUploadId: routeId })}`, { credentials: "same-origin", cache: "no-store" });
        const parsed = adminPrivateRouteContextStateResponseSchema.safeParse(await json(response));
        if (!active) return;
        if (!response.ok || !parsed.success || parsed.data.raceId !== raceId || parsed.data.routeUploadId !== routeId) { setContextRevision(0); setContextMessage(text.contextNone); return; }
        setContextRevision(parsed.data.latestContextRevision);
        setContextMessage(parsed.data.activeContext ? text.contextActive(parsed.data.activeContext.revision) : text.contextNone);
      } catch { if (active) { setContextRevision(0); setContextMessage(text.contextNone); } }
    })();
    return () => { active = false; };
  }, [base, raceId, routeId]);
  useEffect(() => { if (!routeId) return; void (async () => { const response = await fetch(`${base}/route-publications?${new URLSearchParams({ routeUploadId: routeId })}`, { cache: "no-store", credentials: "same-origin" }); const parsed = adminPublicParticipantRoutePublicationStateSchema.safeParse(await json(response)); if (!response.ok || !parsed.success || parsed.data.raceId !== raceId || parsed.data.routeUploadId !== routeId) { setPublication(undefined); setPublicationRevision(0); return; } setPublicationRevision(parsed.data.latestPublicationRevision); const active = parsed.data.activePublication; setPublication(active ? { publicationId: active.publicationId, revision: active.revision } : undefined); })(); }, [base, raceId, routeId]);
  async function load() {
    if (!routeId || !mapId || !georeferenceId) return; setMessage("");
    const parameters = new URLSearchParams({ routeUploadId: routeId, mapManifestId: mapId, georeferenceId }); const response = await fetch(`${base}/route-preview?${parameters}`, { cache: "no-store", credentials: "same-origin" }); const parsed = privateRoutePreviewResponseSchema.safeParse(await json(response));
    if (!response.ok || !parsed.success || parsed.data.raceId !== raceId) { setPreview(undefined); setPreviewKey(""); setMessage(text.incompatible); return; } setPreview(parsed.data); setPreviewKey(`${routeId}:${mapId}:${georeferenceId}`);
  }
  async function release() {
    const token = csrf(); if (!token || !routeId || !mapId || !georeferenceId) { setMessage(text.releaseFailed); return; }
    const response = await fetch(`${base}/route-publications`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `route-publication-release:${crypto.randomUUID()}` }, body: JSON.stringify({ formatVersion: 1, routeUploadId: routeId, mapManifestId: mapId, georeferenceId, expectedPublicationRevision: publicationRevision }) });
    const parsed = publicParticipantRouteReleaseResponseSchema.safeParse(await json(response)); if (!response.ok || !parsed.success || parsed.data.raceId !== raceId) { setMessage(text.releaseFailed); return; } setPublication({ publicationId: parsed.data.publicationId, revision: parsed.data.revision }); setPublicationRevision(parsed.data.revision); setMessage(text.releaseReady);
  }
  async function bind() {
    const token = csrf(); if (!token || !routeId || !mapId || !georeferenceId || !geometryRevisionId || previewKey !== `${routeId}:${mapId}:${georeferenceId}`) { setMessage(text.bindFailed); return; }
    const request = privateRouteContextBindRequestSchema.parse({ formatVersion: 1, routeUploadId: routeId, mapManifestId: mapId, georeferenceId, geometryRevisionId, expectedContextRevision: contextRevision });
    const body = JSON.stringify(request);
    const key = bindRetry.current?.body === body ? bindRetry.current.key : `private-route-context-bind:${crypto.randomUUID()}`;
    bindRetry.current = { body, key };
    try {
      const response = await fetch(`${base}/route-context`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": key }, body });
      const parsed = privateRouteContextBindResponseSchema.safeParse(await json(response));
      if (!response.ok || !parsed.success || parsed.data.raceId !== raceId || parsed.data.routeUploadId !== routeId) {
        if (response.status === 409 || response.status === 400 || response.status === 403) bindRetry.current = null;
        setMessage(text.bindFailed); return;
      }
      bindRetry.current = null;
      setContextRevision(parsed.data.revision); setContextMessage(text.contextActive(parsed.data.revision)); setMessage(text.bindReady);
    } catch { setMessage(text.bindFailed); }
  }
  async function withdraw() {
    if (!publication) return; const token = csrf(); if (!token) { setMessage(text.releaseFailed); return; }
    const response = await fetch(`${base}/route-publications/${publication.publicationId}/withdraw`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `route-publication-withdraw:${crypto.randomUUID()}` }, body: JSON.stringify({ formatVersion: 1, publicationId: publication.publicationId, expectedPublicationRevision: publication.revision }) });
    const parsed = publicParticipantRouteWithdrawResponseSchema.safeParse(await json(response)); if (!response.ok || !parsed.success || parsed.data.raceId !== raceId) { setMessage(text.releaseFailed); return; } setPublication(undefined); setPublicationRevision(parsed.data.revision); setMessage(text.withdrawReady);
  }
  const path = preview?.points.reduce((value, point, index, all) => `${value}${index === 0 || point.segment !== all[index - 1]?.segment ? "M" : "L"}${point.x} ${point.y} `, "") ?? "";
  const previewMatchesCurrent = Boolean(preview && previewKey === `${routeId}:${mapId}:${georeferenceId}`);
  const image = previewMatchesCurrent ? `${base}/route-preview/map?${new URLSearchParams({ mapManifestId: mapId, georeferenceId })}` : "";
  return <section className="private-route-preview stack"><h1>{text.title}</h1><p>{text.intro}</p><p role="status">{message}</p><div className="panel stack"><label>{text.route}<select value={routeId} onChange={event => setRouteId(event.target.value)}>{routes.map(route => <option key={route.routeUploadId} value={route.routeUploadId}>{route.displayName} · {text.pointCount(route.pointCount)}</option>)}</select></label><label>{text.map}<select value={mapId} onChange={event => setMapId(event.target.value)}>{maps.map(map => <option key={map.uploadId} value={map.uploadId}>{map.title}</option>)}</select></label><label>{text.georeference}<select value={georeferenceId} onChange={event => setGeoreferenceId(event.target.value)}>{matching.map(item => <option key={item.georeferenceId} value={item.georeferenceId}>{text.revision(item.revision)}</option>)}</select></label><label>{text.geometry}<select value={geometryRevisionId} onChange={event => setGeometryRevisionId(event.target.value)}><option value="">{text.noGeometry}</option>{matchingGeometries.map(item => <option key={item.geometryRevisionId} value={item.geometryRevisionId}>{text.geometryRevision(item.revision, item.courseVersionId)}</option>)}</select></label><p role="status">{contextMessage}</p><button type="button" disabled={!routeId || !mapId || !georeferenceId} onClick={() => void load()}>{text.show}</button><button type="button" disabled={!routeId || !mapId || !georeferenceId || !geometryRevisionId || !previewMatchesCurrent} onClick={() => void bind()}>{text.bind}</button><button type="button" disabled={!routeId || !mapId || !georeferenceId || Boolean(publication)} onClick={() => void release()}>{text.release}</button>{publication && <button type="button" onClick={() => void withdraw()}>{text.withdraw}</button>}</div>{previewMatchesCurrent && preview && <div className="panel"><svg viewBox={`0 0 ${preview.imageWidth} ${preview.imageHeight}`} role="img" aria-label={text.imageLabel}><image href={image} width={preview.imageWidth} height={preview.imageHeight} /><path d={path} fill="none" stroke="#c00020" strokeWidth={Math.max(1, Math.min(preview.imageWidth, preview.imageHeight) / 500)} /></svg></div>}</section>;
}
