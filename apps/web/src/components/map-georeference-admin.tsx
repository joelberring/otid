"use client";

import React, { useCallback, useEffect, useState, type FormEvent } from "react";
import { adminMapAssetStateResponseSchema, adminMapGeoreferenceStateResponseSchema, mapGeoreferenceResponseSchema, type AdminMapAssetStateResponse, type AdminMapGeoreferenceStateResponse } from "@o-tid/contracts";
import { readRaceAdministratorCsrfCookie } from "../lib/race-administrator-cookies";
import { mapGeoreferenceSv as text } from "../i18n/map-georeference-sv";

type PointInput = { pixelX: string; pixelY: string; longitude: string; latitude: string };
const emptyPoints: PointInput[] = [{ pixelX: "", pixelY: "", longitude: "", latitude: "" }, { pixelX: "", pixelY: "", longitude: "", latitude: "" }, { pixelX: "", pixelY: "", longitude: "", latitude: "" }];
function csrf(): string | undefined { return typeof document === "undefined" || typeof window === "undefined" ? undefined : readRaceAdministratorCsrfCookie(document.cookie, new URL(window.location.href)); }
async function responseJson(response: Response): Promise<unknown> { try { return await response.json(); } catch { return undefined; } }

export function MapGeoreferenceAdmin({ raceId }: { raceId: string }) {
  const mapBase = `/api/admin/races/${raceId}/map`, base = `${mapBase}/georeferences`;
  const [mapState, setMapState] = useState<AdminMapAssetStateResponse>();
  const [state, setState] = useState<AdminMapGeoreferenceStateResponse>();
  const [manifestId, setManifestId] = useState("");
  const [width, setWidth] = useState(""), [height, setHeight] = useState("");
  const [points, setPoints] = useState<PointInput[]>(emptyPoints);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);

  const load = useCallback(async (preserveMessage = false) => {
    if (!preserveMessage) setMessage("");
    setMapState(undefined); setState(undefined);
    try {
      const [mapResponse, response] = await Promise.all([fetch(mapBase, { credentials: "same-origin", cache: "no-store" }), fetch(base, { credentials: "same-origin", cache: "no-store" })]);
      if (mapResponse.status === 401 || mapResponse.status === 403 || response.status === 401 || response.status === 403) { setMessage(text.unavailable); return; }
      const maps = adminMapAssetStateResponseSchema.safeParse(await responseJson(mapResponse));
      const georeferences = adminMapGeoreferenceStateResponseSchema.safeParse(await responseJson(response));
      if (!mapResponse.ok || !response.ok || !maps.success || !georeferences.success || maps.data.raceId !== raceId || georeferences.data.raceId !== raceId) { setMessage(text.loadError); return; }
      setMapState(maps.data); setState(georeferences.data);
      setManifestId(current => current && maps.data.storedCandidates.some(candidate => candidate.uploadId === current) ? current : (maps.data.storedCandidates[0]?.uploadId ?? ""));
    } catch { setMessage(text.loadError); }
  }, [base, mapBase, raceId]);
  useEffect(() => { void load(); }, [load]);

  function updatePoint(index: number, field: keyof PointInput, value: string) {
    setPoints(current => current.map((point, candidate) => candidate === index ? { ...point, [field]: value } : point));
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || !manifestId) return;
    const csrfToken = csrf(); if (!csrfToken) { setMessage(text.unavailable); return; }
    const imageWidth = Number(width), imageHeight = Number(height);
    const tiePoints = points.map(point => ({ pixelX: Number(point.pixelX), pixelY: Number(point.pixelY), longitude: Number(point.longitude), latitude: Number(point.latitude) }));
    if (!Number.isSafeInteger(imageWidth) || !Number.isSafeInteger(imageHeight) || tiePoints.some(point => Object.values(point).some(value => !Number.isFinite(value)))) { setMessage(text.saveError); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(base, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", "x-otid-csrf": csrfToken, "idempotency-key": `map-georeference:${crypto.randomUUID()}` }, body: JSON.stringify({ formatVersion: 1, manifestId, expectedGeoreferenceRevision: state?.latestGeoreferenceRevision ?? 0, imageWidth, imageHeight, crs: "EPSG:4326", tiePoints }) });
      const parsed = mapGeoreferenceResponseSchema.safeParse(await responseJson(response));
      if (!response.ok || !parsed.success || parsed.data.raceId !== raceId || parsed.data.manifestId !== manifestId) throw new Error("save");
      setMessage(text.saved); await load(true);
    } catch { setMessage(text.saveError); } finally { setBusy(false); }
  }

  return <section className="map-georeference-admin stack"><h2>{text.title}</h2><p>{text.intro}</p>{message && <p role="status" aria-live="polite">{message}</p>}
    <details className="private-map-admin-details"><summary>{text.openDetails}</summary>
    <form className="panel stack" onSubmit={event => void save(event)}>
      {mapState?.storedCandidates.length ? <><label>{text.map}<select value={manifestId} disabled={busy} onChange={event => setManifestId(event.target.value)}>{mapState.storedCandidates.map(candidate => <option key={candidate.uploadId} value={candidate.uploadId}>{candidate.title} · {candidate.mediaType}</option>)}</select></label>
        <fieldset disabled={busy}><legend>{text.dimensions}</legend><label>{text.width}<input type="number" min="1" max="200000" required value={width} onChange={event => setWidth(event.target.value)} /></label><label>{text.height}<input type="number" min="1" max="200000" required value={height} onChange={event => setHeight(event.target.value)} /></label></fieldset>
        <fieldset disabled={busy}><legend>{text.controlPoints}</legend>{points.map((point, index) => <div className="map-georeference-point" key={index}><strong>{text.point(index + 1)}</strong>{(["pixelX", "pixelY", "longitude", "latitude"] as const).map(field => <label key={field}>{text[field]}<input type="number" step="any" required value={point[field]} onChange={event => updatePoint(index, field, event.target.value)} /></label>)}</div>)}</fieldset>
        <p className="muted">{text.numericalNote}</p><button disabled={busy}>{text.save}</button></> : mapState ? <p>{text.noMap}</p> : null}
    </form>
    <section className="panel stack"><div className="pairing-list-heading"><h2>{text.history}</h2><button type="button" className="secondary" disabled={busy} onClick={() => void load()}>{text.refresh}</button></div>
      {state && (!state.georeferences.length ? <p className="muted">{text.none}</p> : <div className="pairing-grant-list">{state.georeferences.map(georeference => <article className="pairing-grant" key={georeference.georeferenceId}><div><strong>{text.revision(georeference.revision)}</strong><span>{text.dimensionsValue(georeference.imageWidth, georeference.imageHeight)} · {text.residual(georeference.maxResidualMeters)}</span><span>{text.source(georeference.sourceHash)} · {new Date(georeference.decidedAt).toLocaleString("sv-SE")}</span></div></article>)}</div>)}
    </section>
    </details>
  </section>;
}
