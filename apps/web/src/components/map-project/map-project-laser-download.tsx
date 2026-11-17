"use client";

import { useState } from "react";
import type { GeoJobView } from "@o-tid/contracts";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import { geoOutputsSize, megabytes, zipGeoOutputs } from "../../lib/geo-outputs-zip";
import { mapProjectBase } from "../../lib/map-project-client";
import { useLanguage, useTexts } from "../language-provider";
import { Button } from "../ui";
import styles from "./map-project-editor.module.css";

/** Ägaren 2026-11-17: en klar laserkörnings filer som en zip (bilder med världsfiler och DXF), till exempel för QGIS. */
export function MapProjectLaserDownload({ projectId, job }: { projectId: string; job: GeoJobView }) {
  const text = useTexts(mapSourcesSv.laser, mapSourcesEn.laser), language = useLanguage();
  const [state, setState] = useState<{ done: number; total: number } | { failed: string } | undefined>();
  const working = state !== undefined && "done" in state;
  const download = async () => {
    setState({ done: 0, total: job.outputs.length });
    const result = await zipGeoOutputs(mapProjectBase(projectId), job, (done, total) => setState({ done, total }));
    if (result.status !== "ok") { setState({ failed: result.name }); return; }
    const url = URL.createObjectURL(new Blob([result.bytes.slice().buffer], { type: "application/zip" })), link = document.createElement("a");
    link.href = url; link.download = result.fileName; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setState(undefined);
  };
  return <span className={styles.actions}>
    <Button variant="secondary" disabled={working} onClick={() => void download()} data-testid="map-project-laser-download">
      {working ? text.downloading(state.done, state.total) : text.download(megabytes(geoOutputsSize(job), language === "en" ? "." : ","))}</Button>
    {state && "failed" in state && <span role="alert" className={styles.problem}> {text.downloadFailed(state.failed)}</span>}
  </span>;
}
