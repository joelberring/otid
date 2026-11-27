"use client";

import { useCallback, useEffect, useState } from "react";
import { regenerableMissingSchema, type MapProjectView, type RegenerableMissing } from "@o-tid/contracts";
import { mapProjectRegenerableEn } from "../../i18n/map-project-regenerable-en";
import { mapProjectRegenerableSv } from "../../i18n/map-project-regenerable-sv";
import { clubRequest } from "../../lib/club-request";
import { mapProjectBase } from "../../lib/map-project-client";
import { useTexts } from "../language-provider";
import { Button, Notice } from "../ui";
import type { useMapProjectLayers } from "./use-map-project-layers";
import styles from "./map-project-editor.module.css";

/**
 * PLAN.md steg M4: när projektet öppnas och underlag saknas (taget ur förrådet för kontots gräns eller för att det var orört)
 * säger O-Tid det tydligt och återskapar det med ett tryck: laserkörningarna körs om (räknas inte mot laserkvoten) och bilderna
 * hämtas igen med sitt recept. Passerar kontot sin gräns fast allt som får tas bort är borta, säger O-Tid det också.
 */
export function MapProjectRegenerableNotice({ view, layers }: { view: MapProjectView; layers: ReturnType<typeof useMapProjectLayers> }) {
  const text = useTexts(mapProjectRegenerableSv, mapProjectRegenerableEn);
  const base = mapProjectBase(view.projectId);
  const [missing, setMissing] = useState<RegenerableMissing>();
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string }>();
  const load = useCallback(async () => {
    const response = await clubRequest(`${base}/regenerable`).catch(() => undefined);
    const parsed = regenerableMissingSchema.safeParse(response?.json);
    if (response?.status === 200 && parsed.success) setMissing(parsed.data);
  }, [base]);
  useEffect(() => { void load(); }, [load]);
  if (!missing) return null;
  // Underlag från en laserkörning återskapas med körningen.
  const fetched = missing.layers.filter(layer => layer.source !== "LASER");
  const runs = missing.laserRuns;
  const count = runs.length + fetched.length;
  if (count === 0 && missing.overLimitProjects.length === 0) return null;
  const mb = Math.round((runs.reduce((sum, run) => sum + run.bytes, 0) + fetched.reduce((sum, layer) => sum + layer.bytes, 0)) / 1048576);

  async function regenerate() {
    setMessage(undefined);
    let done = 0, failed = 0, queued = 0, problem: string | undefined;
    for (const run of runs) {
      setBusy(text.working(++done, count));
      const response = await clubRequest(`${base}/geo-jobs/${encodeURIComponent(run.jobId)}/regenerate`, "POST").catch(() => undefined);
      const error = (response?.json as { error?: string } | undefined)?.error;
      if (response?.status === 200 || response?.status === 201) queued += 1;
      else { failed += 1; problem = error === "SOURCE_NO_CREDENTIAL" ? text.noCredential : error === "GEO_JOB_BUSY" ? text.busy : problem; }
    }
    for (const layer of fetched) {
      setBusy(text.working(++done, count));
      const row = layers.layers.find(candidate => candidate.layerId === layer.layerId);
      if (!row || !await layers.regenerate(row)) failed += 1;
    }
    setBusy(undefined);
    await layers.reload();
    await load();
    setMessage(failed > 0 ? { tone: "error", text: `${text.failed(failed)}${problem ? ` ${problem}` : ""}` } : { tone: "info", text: text.queued(queued) });
  }

  return <div className={styles.notice} data-testid="map-project-regenerable">
    {count > 0 && <Notice tone="attention" role="status">{text.missing(runs.length, fetched.length, mb)}{" "}
      {view.viewer.canPropose ? <Button variant="secondary" disabled={!!busy} onClick={() => void regenerate()} data-testid="map-project-regenerate">
        {text.regenerate}</Button> : text.readOnly}
      {busy && <span role="status"> {busy}</span>}</Notice>}
    {missing.overLimitProjects.length > 0 && <Notice tone="attention" role="status">{text.overLimit(missing.overLimitProjects)}</Notice>}
    {message && <Notice tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>{message.text}{" "}
      <Button variant="quiet" onClick={() => setMessage(undefined)}>{text.ok}</Button></Notice>}
  </div>;
}
