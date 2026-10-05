"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { adminRaceMapStateSchema, PARTICIPANT_ROUTE_CONTENT_TYPE, participantRouteUploadResponseSchema, RACE_MAP_MAX_BYTES,
  raceMapProblemSchema, type AdminRaceMapState, type RaceMapProblem } from "@o-tid/contracts";
import { raceMapSv } from "../../i18n/race-map-sv";
import { Button, Field, Notice, Section } from "../ui";
import { MapGeoreference } from "./map-georeference";
import type { Message } from "./source-sync-actions";
import styles from "./map-routes.module.css";
import type { Workspace } from "./workspace-state";

const text = raceMapSv;

async function problemOf(response: Response): Promise<RaceMapProblem | undefined> {
  if (response.status !== 422) return undefined;
  const parsed = raceMapProblemSchema.safeParse(await response.json());
  return parsed.success ? parsed.data.error : undefined;
}

/**
 * Resultat → Karta och vägval (PLAN.md steg 16, ADR-0171): kartbilden, georeferensen med tre punkter och löparnas
 * GPX-rutter. Bara admin skriver; den publika sträcktidsanalysen visar vägvalen när kartan är georefererad.
 */
export function MapRoutesSection({ ws }: { ws: Workspace }) {
  const { authenticated, busy, busyRef, beginRequest, request, json, finish, current, csrf, requireSession, raceId } = ws;
  const [state, setState] = useState<AdminRaceMapState>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [image, setImage] = useState<string>();
  const [message, setMessage] = useState<Message>();
  const [runner, setRunner] = useState("");
  const mapFile = useRef<HTMLInputElement>(null), routeFile = useRef<HTMLInputElement>(null);
  const imageVersion = useRef<string | undefined>(undefined);

  async function load(preserveMessage = false) {
    if (busyRef.current) return;
    if (!preserveMessage) setMessage(undefined);
    const op = beginRequest();
    try {
      const response = await request("/map", op);
      if (!response.ok) throw new Error("Kartan kunde inte hämtas");
      const next = adminRaceMapStateSchema.parse(await json(response, op));
      // Bilden hämtas bara när kartan är ny eller utbytt.
      const version = next.map?.uploadedAt;
      if (version && version !== imageVersion.current) {
        const imageResponse = await request("/map/image", op);
        if (!imageResponse.ok) throw new Error("Kartbilden kunde inte hämtas");
        const blob = await imageResponse.blob();
        setImage(previous => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(blob); });
        imageVersion.current = version;
      }
      if (!version) { setImage(previous => { if (previous) URL.revokeObjectURL(previous); return undefined; }); imageVersion.current = undefined; }
      setState(next); setLoadFailed(false);
    } catch { if (current(op)) setLoadFailed(true); } finally { finish(op); }
  }
  useEffect(() => { if (authenticated && !state && !loadFailed && !busy && !busyRef.current) void load(); }, [authenticated, state, loadFailed, busy]);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image); }, [image]);

  /** En skrivning med besked: ok → nytt tillstånd, 422 → begripligt fel, annat → allmänt fel. */
  async function write(path: string, init: RequestInit, done: (response: Response) => Promise<Message>, problems: Partial<Record<RaceMapProblem, string>>,
    failed: string) {
    if (busyRef.current || !requireSession()) return;
    setMessage(undefined);
    const op = beginRequest();
    let next: Message | undefined;
    try {
      const response = await request(path, op, { ...init, headers: { ...init.headers, "x-otid-csrf": csrf() } });
      const problem = await problemOf(response);
      if (problem) next = { tone: "error", text: problems[problem] ?? failed };
      else if (!response.ok) throw new Error("Skrivningen misslyckades");
      else next = await done(response);
    } catch { if (current(op)) next = { tone: "error", text: failed }; } finally { finish(op); }
    if (next) setMessage(next);
    if (next?.tone === "ok") await load(true);
  }

  async function uploadMap() {
    const file = mapFile.current?.files?.[0];
    if (!file) { setMessage({ tone: "error", text: text.map.chooseFile }); return; }
    if (file.size > RACE_MAP_MAX_BYTES) { setMessage({ tone: "error", text: text.map.tooLarge }); return; }
    const type = file.type === "image/png" || file.type === "image/jpeg" ? file.type : /\.png$/i.test(file.name) ? "image/png" : "image/jpeg";
    await write("/map", { method: "PUT", headers: { "content-type": type, "x-otid-file-name": encodeURIComponent(file.name.slice(0, 200)) },
      body: await file.arrayBuffer() }, async () => {
      if (mapFile.current) mapFile.current.value = "";
      return { tone: "ok", text: text.map.saved };
    }, { INVALID_IMAGE: text.map.invalid, IMAGE_TOO_LARGE: text.map.tooLarge }, text.map.failed);
  }

  async function uploadRoute() {
    const file = routeFile.current?.files?.[0];
    const chosen = state?.runners.find(row => row.entryId === runner);
    if (!file || !chosen) { setMessage({ tone: "error", text: text.routes.chooseBoth }); return; }
    await write("/routes", { method: "POST", headers: { "content-type": PARTICIPANT_ROUTE_CONTENT_TYPE, "x-otid-entry-id": chosen.entryId,
      "x-otid-file-name": encodeURIComponent(file.name.slice(0, 200)) }, body: await file.arrayBuffer() }, async response => {
      const saved = participantRouteUploadResponseSchema.parse(await response.json());
      if (routeFile.current) routeFile.current.value = "";
      setRunner("");
      return { tone: "ok", text: text.routes.saved(chosen.name, saved.coveredLegs, saved.legs) };
    }, { INVALID_GPX: text.routes.invalid, ROUTE_WITHOUT_TIMES: text.routes.noTimes, NOT_INDIVIDUAL: text.routes.notIndividual }, text.routes.failed);
  }

  const names = new Map(state?.runners.map(row => [row.entryId, row]) ?? []);
  const map = state?.map;
  return <Section id={`map-routes-${raceId}`} title={text.title} help={text.help}
    actions={map?.georeferencedAt ? <Link href={`/results/${raceId}/splits`}>{text.analysisLink}</Link> : undefined}>
    <div className={styles.body}>
      {!state && !loadFailed && <p className={styles.muted} role="status">{text.loading}</p>}
      {loadFailed && <Notice tone="error" role="alert">{text.loadFailed}{" "}
        <Button variant="quiet" onClick={() => { setLoadFailed(false); }}>{text.retry}</Button></Notice>}
      {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
      {state && <>
        <section className={styles.part} aria-labelledby={`map-image-${raceId}`}>
          <h3 id={`map-image-${raceId}`}>{text.map.heading}</h3>
          {map && <p className={styles.current}><span>{text.map.current(map.fileName, map.width, map.height)}</span>
            <span className={styles.state} data-ok={map.georeferencedAt ? "true" : "false"}>
              {map.georeferencedAt ? text.map.georeferenced : text.map.notGeoreferenced}</span></p>}
          <form className={styles.inlineForm} onSubmit={event => { event.preventDefault(); void uploadMap(); }}>
            <Field label={text.map.file} help={text.map.fileHelp}>
              <input ref={mapFile} type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" disabled={busy} /></Field>
            <div className={styles.actions}>
              <Button type="submit" variant={map ? "secondary" : "primary"} disabled={busy}>{map ? text.map.replace : text.map.upload}</Button>
              {map && <Button variant="quiet" disabled={busy} onClick={() => void write("/map", { method: "DELETE" },
                async () => ({ tone: "ok", text: text.map.removed }), {}, text.map.failed)}>{text.map.remove}</Button>}
            </div>
          </form>
        </section>
        {map && image && <MapGeoreference key={map.uploadedAt} map={map} image={image} busy={busy}
          onSave={tiePoints => write("/map/georeference", { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ formatVersion: 1, tiePoints }) }, async () => ({ tone: "ok", text: text.georeference.saved }),
          { INVALID_GEOREFERENCE: text.georeference.invalid, NO_MAP: text.georeference.failed }, text.georeference.failed)}
          onInvalid={() => setMessage({ tone: "error", text: text.georeference.incomplete })} />}
        <section className={styles.part} aria-labelledby={`map-routes-list-${raceId}`}>
          <h3 id={`map-routes-list-${raceId}`}>{text.routes.heading}</h3>
          <p className={styles.muted}>{text.routes.help}{!map?.georeferencedAt && ` ${text.routes.noMapYet}`}</p>
          <form className={styles.routeForm} onSubmit={event => { event.preventDefault(); void uploadRoute(); }}>
            <Field label={text.routes.runner}><select value={runner} disabled={busy} onChange={event => setRunner(event.target.value)}>
              <option value="">{text.routes.chooseRunner}</option>
              {state.runners.map(row => <option key={row.entryId} value={row.entryId}>{row.name} · {row.className}</option>)}
            </select></Field>
            <Field label={text.routes.file}><input ref={routeFile} type="file" accept=".gpx,application/gpx+xml" disabled={busy} /></Field>
            <div className={styles.actions}><Button type="submit" disabled={busy}>{text.routes.upload}</Button></div>
          </form>
          {state.routes.length === 0 ? <p className={styles.muted}>{text.routes.none}</p> :
            <table className={styles.table} aria-label={text.routes.table}>
              <thead><tr><th scope="col">{text.routes.columns.runner}</th><th scope="col">{text.routes.columns.className}</th>
                <th scope="col" className={styles.wide}>{text.routes.columns.file}</th><th scope="col">{text.routes.columns.covered}</th>
                <th scope="col"><span className={styles.hidden}>{text.routes.columns.actions}</span></th></tr></thead>
              <tbody>{state.routes.map(route => {
                const who = names.get(route.entryId);
                return <tr key={route.entryId}>
                  <th scope="row">{who?.name ?? ""}</th><td>{who?.className ?? ""}</td><td className={styles.wide}>{route.fileName}</td>
                  <td className={styles.num}>{text.routes.covered(route.coveredLegs, route.legs)}</td>
                  <td><Button variant="quiet" disabled={busy} aria-label={text.routes.removeLabel(who?.name ?? "")}
                    onClick={() => void write("/routes", { method: "DELETE", headers: { "x-otid-entry-id": route.entryId } },
                      async () => ({ tone: "ok", text: text.routes.removed }), {}, text.routes.failed)}>{text.routes.remove}</Button></td>
                </tr>;
              })}</tbody>
            </table>}
        </section>
      </>}
    </div>
  </Section>;
}
