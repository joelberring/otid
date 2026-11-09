"use client";

import { useEffect, useState } from "react";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { useTexts } from "../language-provider";
import type { MapProjectView, MapSourceCredentialView } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import { accountRequest } from "../../lib/account-client";
import { clubRequest } from "../../lib/club-archive-client";
import type { Bounds } from "../../lib/course-setting-viewport";
import { areaBox, type BoxArea } from "../../lib/map-project-area-box";
import { mapProjectBase } from "../../lib/map-project-client";
import { Button } from "../ui";
import type { useMapProjectLayers } from "./use-map-project-layers";
import styles from "./map-project-editor.module.css";

interface OrthoItem { id: string; collection: string | null; datetime: string | null; href: string; title: string | null }
type Area = BoxArea & { areaId: string };

/**
 * ADR-0219 tillägget om hämtningen (K4c): ortofoton från Lantmäteriet med kontots egna uppgifter. Servern söker; de valda
 * bilderna läses i delar genom serverns `asset`-anrop och läggs till som underlag (en per bildruta), klippta till rutan.
 */
export function MapProjectOrthoPanel({ view, layers, georeference, bounds, areas }: { view: MapProjectView; layers: ReturnType<typeof useMapProjectLayers>;
  georeference: MapGeoreference | undefined; bounds: Bounds | undefined; areas: readonly Area[] }) {
  const text = useTexts(mapSourcesSv.ortho, mapSourcesEn.ortho);
  const base = mapProjectBase(view.projectId);
  const [credential, setCredential] = useState<MapSourceCredentialView>();
  const [where, setWhere] = useState("");
  const [items, setItems] = useState<OrthoItem[]>();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const area = areas.find(row => row.areaId === where);

  useEffect(() => {
    void accountRequest("/api/account/map-sources/lantmateriet").then(result => {
      if (result.status === 200) setCredential(result.json as MapSourceCredentialView);
    }, () => undefined);
  }, []);
  // Ett annat område: sök igen.
  useEffect(() => { setItems(undefined); setChosen(new Set()); }, [where]);

  if (!layers.canAdd || !georeference || !bounds) return null;
  const say = (error: string | number | undefined) => setMessage({ tone: "error", text: typeof error === "string" && error in text.problems
    ? (text.problems as unknown as Record<string, string>)[error]! : text.problems.generic(error ?? 0) });

  async function search() {
    setBusy(text.searching); setMessage(undefined);
    try {
      const result = await clubRequest(`${base}/sources/lantmateriet/search`, "POST", { formatVersion: 1, box: areaBox(bounds!, georeference!, area).wgs84 })
        .catch(() => ({ status: 0, json: undefined }));
      const body = result.json as { items?: OrthoItem[]; error?: string } | undefined;
      if (result.status !== 200 || !body?.items) { say(body?.error ?? result.status); return; }
      setItems(body.items);
      // Förval: den nyaste årgången (samma samling som den nyaste bilden).
      const newest = body.items[0]?.collection;
      setChosen(new Set(body.items.filter(item => item.collection === newest).map(item => item.id)));
    } finally { setBusy(undefined); }
  }

  async function add() {
    const selected = (items ?? []).filter(item => chosen.has(item.id));
    const { box } = areaBox(bounds!, georeference!, area);
    let added = 0;
    for (const [index, item] of selected.entries()) {
      setBusy(text.adding(index + 1, selected.length));
      const url = `${base}/sources/lantmateriet/asset?href=${encodeURIComponent(item.href)}`;
      if (await layers.addRemote(url, box, text.name(item.collection, item.id), false)) added += 1;
    }
    setBusy(undefined);
    await layers.reload();
    if (added > 0) { setMessage({ tone: "ok", text: text.added(added) }); setItems(undefined); }
  }

  const ready = credential?.saved?.readable;
  return <details className={styles.settings} data-testid="map-project-ortho">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {credential && !ready ? <p className={styles.muted}>{text.noCredential} <a href="/konto#konto-lantmateriet">{text.account}</a></p> : <>
      <label>{text.where}<select value={where} onChange={event => setWhere(event.target.value)} data-testid="map-project-ortho-area">
        <option value="">{text.whole}</option>
        {areas.map(row => <option key={row.areaId} value={row.areaId}>{row.name}</option>)}
      </select></label>
      <span className={styles.actions}>
        <Button variant="secondary" disabled={!!busy} onClick={() => void search()} data-testid="map-project-ortho-search">{text.search}</Button>
      </span>
      {items && items.length === 0 && <p className={styles.muted}>{text.none}</p>}
      {items && items.length > 0 && <fieldset className={styles.importLayers} data-testid="map-project-ortho-items">
        {items.map(item => <label key={item.id} className={styles.check}>
          <input type="checkbox" checked={chosen.has(item.id)} onChange={() => setChosen(current => {
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
            return next;
          })} />{text.item(item.datetime, item.collection, item.id)}</label>)}
        <span className={styles.actions}>
          <Button disabled={!!busy || chosen.size === 0} onClick={() => void add()} data-testid="map-project-ortho-add">{text.add(chosen.size)}</Button>
        </span>
      </fieldset>}
    </>}
    {busy && <p role="status" className={styles.muted}>{busy}</p>}
    {message && <p role={message.tone === "ok" ? "status" : "alert"} className={message.tone === "ok" ? styles.muted : styles.problem}
      data-testid="map-project-ortho-message">{message.text}</p>}
  </details>;
}
