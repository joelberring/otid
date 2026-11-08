"use client";

import { useState } from "react";
import type { MapProjectView } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import { csrf } from "../../lib/club-archive-client";
import type { Bounds } from "../../lib/course-setting-viewport";
import { areaBox, type BoxArea } from "../../lib/map-project-area-box";
import { mapProjectBase } from "../../lib/map-project-client";
import { Button } from "../ui";
import type { useMapProjectLayers } from "./use-map-project-layers";
import styles from "./map-project-editor.module.css";

const text = mapSourcesSv.moisture;
type Area = BoxArea & { areaId: string };

/**
 * ADR-0219 K5c: SLU:s markfuktighetskarta för kartan eller en etapp. Servern hämtar bilden (WMS, SWEREF 99 TM) och svarar med
 * världsfilen i ett huvud; bilden läggs till som ett vanligt underlag.
 */
export function MapProjectMoisturePanel({ view, layers, georeference, bounds, areas }: { view: MapProjectView;
  layers: ReturnType<typeof useMapProjectLayers>; georeference: MapGeoreference | undefined; bounds: Bounds | undefined; areas: readonly Area[] }) {
  const [where, setWhere] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  if (!layers.canAdd || !georeference || !bounds) return null;
  const area = areas.find(row => row.areaId === where);
  const problems = mapSourcesSv.laser.problems as unknown as Record<string, string>;

  async function fetchMoisture() {
    setBusy(true); setMessage(undefined);
    try {
      const token = csrf();
      const response = await fetch(`${mapProjectBase(view.projectId)}/sources/markfuktighet`, { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", ...(token ? { "x-otid-csrf": token } : {}) },
        body: JSON.stringify({ formatVersion: 1, box: areaBox(bounds!, georeference!, area).wgs84 }) }).catch(() => undefined);
      if (!response?.ok) {
        const body = await response?.json().catch(() => undefined) as { error?: string } | undefined;
        setMessage({ tone: "error", text: body?.error && body.error in problems ? problems[body.error]! : mapSourcesSv.laser.problems.generic(response?.status ?? 0) });
        return;
      }
      const world = decodeURIComponent(response.headers.get("x-otid-world") ?? "");
      const crs = Number(response.headers.get("x-otid-crs") ?? 3006);
      const files = [new File([await response.blob()], "markfuktighet.png", { type: "image/png" }), new File([world], "markfuktighet.pgw", { type: "text/plain" })];
      if (await layers.upload(files, text.name(area?.name), crs)) setMessage({ tone: "ok", text: text.added });
    } finally { setBusy(false); }
  }

  return <details className={styles.settings} data-testid="map-project-moisture">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    <label>{mapSourcesSv.ortho.where}<select value={where} onChange={event => setWhere(event.target.value)}>
      <option value="">{mapSourcesSv.ortho.whole}</option>
      {areas.map(row => <option key={row.areaId} value={row.areaId}>{row.name}</option>)}
    </select></label>
    <span className={styles.actions}>
      <Button variant="secondary" disabled={busy} onClick={() => void fetchMoisture()} data-testid="map-project-moisture-fetch">{text.fetch}</Button>
    </span>
    {busy && <p role="status" className={styles.muted}>{text.fetching}</p>}
    {message && <p role={message.tone === "ok" ? "status" : "alert"} className={message.tone === "ok" ? styles.muted : styles.problem}
      data-testid="map-project-moisture-message">{message.text}</p>}
    <p className={styles.muted}>{text.attribution}</p>
  </details>;
}
