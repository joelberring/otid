"use client";
import React, { useCallback, useEffect, useState, type FormEvent } from "react";
import { adminCourseControlGeometryStateResponseSchema, adminMapAssetStateResponseSchema, adminMapGeoreferenceStateResponseSchema, courseControlGeometryResponseSchema, type AdminCourseControlGeometryStateResponse, type AdminMapAssetStateResponse, type AdminMapGeoreferenceStateResponse } from "@o-tid/contracts";
import { readRaceAdministratorCsrfCookie } from "../lib/race-administrator-cookies";
import { courseControlGeometrySv as text } from "../i18n/course-control-geometry-sv";

type Position = { pixelX: string; pixelY: string };
function csrf() { return typeof document === "undefined" || typeof window === "undefined" ? undefined : readRaceAdministratorCsrfCookie(document.cookie, new URL(window.location.href)); }
async function json(response: Response): Promise<unknown> { try { return await response.json(); } catch { return undefined; } }
export function CourseControlGeometryAdmin({ raceId }: { raceId: string }) {
  const mapBase = `/api/admin/races/${raceId}/map`, base = `/api/admin/races/${raceId}/course-control-geometries`;
  const [state, setState] = useState<AdminCourseControlGeometryStateResponse>(); const [maps, setMaps] = useState<AdminMapAssetStateResponse>(); const [geos, setGeos] = useState<AdminMapGeoreferenceStateResponse>();
  const [courseId, setCourseId] = useState(""), [mapId, setMapId] = useState(""), [geoId, setGeoId] = useState(""), [positions, setPositions] = useState<Record<string, Position>>({}), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const load = useCallback(async (preserveMessage = false) => {
    if (!preserveMessage) setMessage("");
    setState(undefined); setMaps(undefined); setGeos(undefined);
    try {
      const [a, b, c] = await Promise.all([fetch(base, { credentials: "same-origin", cache: "no-store" }), fetch(mapBase, { credentials: "same-origin", cache: "no-store" }), fetch(`${mapBase}/georeferences`, { credentials: "same-origin", cache: "no-store" })]);
      const geometry = adminCourseControlGeometryStateResponseSchema.safeParse(await json(a)), map = adminMapAssetStateResponseSchema.safeParse(await json(b)), geo = adminMapGeoreferenceStateResponseSchema.safeParse(await json(c));
      if (!a.ok || !b.ok || !c.ok || !geometry.success || !map.success || !geo.success || geometry.data.raceId !== raceId || map.data.raceId !== raceId || geo.data.raceId !== raceId) { setMessage(text.loadError); return; }
      setState(geometry.data); setMaps(map.data); setGeos(geo.data);
      setCourseId(current => current || geometry.data.courses[0]?.courseVersionId || "");
      setMapId(current => current || map.data.storedCandidates[0]?.uploadId || "");
    } catch { setMessage(text.loadError); }
  }, [base, mapBase, raceId]);
  useEffect(() => { void load(); }, [load]);
  const course = state?.courses.find(item => item.courseVersionId === courseId); const availableGeos = geos?.georeferences.filter(item => item.manifestId === mapId) ?? [];
  useEffect(() => { setGeoId(current => availableGeos.some(item => item.georeferenceId === current) ? current : (availableGeos[0]?.georeferenceId ?? "")); }, [mapId, geos]);
  useEffect(() => { setPositions(course ? Object.fromEntries(course.controls.map(control => [control.courseControlId, { pixelX: "", pixelY: "" }])) : {}); }, [courseId, state]);
  async function save(event: FormEvent) { event.preventDefault(); if (busy || !course || !mapId || !geoId) return; const token = csrf(); const points = course.controls.map(control => ({ courseControlId: control.courseControlId, pixelX: Number(positions[control.courseControlId]?.pixelX), pixelY: Number(positions[control.courseControlId]?.pixelY) })); if (!token || points.some(point => !Number.isFinite(point.pixelX) || !Number.isFinite(point.pixelY))) { setMessage(text.saveError); return; } const expectedGeometryRevision = Math.max(0, ...state!.geometries.filter(item => item.courseVersionId === courseId && item.mapManifestId === mapId).map(item => item.revision)); setBusy(true); try { const response = await fetch(base, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `course-control-geometry:${crypto.randomUUID()}` }, body: JSON.stringify({ formatVersion: 1, courseVersionId: courseId, mapManifestId: mapId, georeferenceId: geoId, expectedGeometryRevision, points }) }); const parsed = courseControlGeometryResponseSchema.safeParse(await json(response)); if (!response.ok || !parsed.success || parsed.data.raceId !== raceId) throw new Error(); setMessage(text.saved); await load(true); } catch { setMessage(text.saveError); } finally { setBusy(false); } }
  const change = (id: string, field: keyof Position, value: string) => setPositions(current => ({ ...current, [id]: { pixelX: current[id]?.pixelX ?? "", pixelY: current[id]?.pixelY ?? "", [field]: value } }));
  return <section className="course-control-geometry-admin stack">
    <h2>{text.title}</h2>
    <p>{text.intro}</p>
    {message && <p role="status" aria-live="polite">{message}</p>}
    <details className="private-map-admin-details">
      <summary>{text.openDetails}</summary>
      <form className="panel stack" onSubmit={event => void save(event)}>
        {state?.courses.length ? <>
          <label>{text.course}<select value={courseId} disabled={busy} onChange={event => setCourseId(event.target.value)}>{state.courses.map(item => <option key={item.courseVersionId} value={item.courseVersionId}>{item.courseName} · v{item.version}</option>)}</select></label>
          <label>{text.map}<select value={mapId} disabled={busy} onChange={event => setMapId(event.target.value)}>{maps?.storedCandidates.map(item => <option key={item.uploadId} value={item.uploadId}>{item.title}</option>)}</select></label>
          <label>{text.calibration}<select value={geoId} disabled={busy} onChange={event => setGeoId(event.target.value)}>{availableGeos.map(item => <option key={item.georeferenceId} value={item.georeferenceId}>{item.revision}</option>)}</select></label>
          <fieldset disabled={busy || !geoId}><legend>{text.positions}</legend>{course?.controls.map(control => <div className="course-control-geometry-point" key={control.courseControlId}><strong>{control.sequence}. {control.controlCode}</strong><label>{text.pixelX}<input required type="number" min="0" step="any" value={positions[control.courseControlId]?.pixelX ?? ""} onChange={event => change(control.courseControlId, "pixelX", event.target.value)} /></label><label>{text.pixelY}<input required type="number" min="0" step="any" value={positions[control.courseControlId]?.pixelY ?? ""} onChange={event => change(control.courseControlId, "pixelY", event.target.value)} /></label></div>)}</fieldset>
          <button disabled={busy || !geoId}>{text.save}</button>
        </> : state ? <p>{text.noCourse}</p> : null}
      </form>
      <section className="panel stack"><h2>{text.history}</h2><button type="button" className="secondary" onClick={() => void load()} disabled={busy}>{text.refresh}</button>{state && (!state.geometries.length ? <p>{text.none}</p> : state.geometries.map(item => <p key={item.geometryRevisionId}>{text.revision(item.revision)} · {new Date(item.decidedAt).toLocaleString("sv-SE")}</p>))}</section>
    </details>
  </section>;
}
