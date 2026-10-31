"use client";

import { useRef, useState } from "react";
import { RACE_MAP_SOURCE_MAX_BYTES, RACE_MAP_SOURCE_PARTS, type AdminRaceMapState } from "@o-tid/contracts";
import { raceMapSv } from "../../i18n/race-map-sv";
import { renderMapFile, type MapFileWorkerErrorCode } from "../../lib/map-file-worker-protocol";
import { Button, Field } from "../ui";
import type { Message } from "./source-sync-actions";
import styles from "./map-routes.module.css";

const text = raceMapSv.mapFile;
type Source = NonNullable<AdminRaceMapState["source"]>;

/** Workern som läser och ritar kartfilen (egen fil så att den byggs som Worker). */
const createWorker = () => new Worker(new URL("../../lib/map-file-worker.ts", import.meta.url), { type: "module" });

/**
 * Steg 59: "Ladda upp kartfil (OCAD eller Mapper)". Webbläsaren läser och ritar filen i en Worker och skickar originalet,
 * bilden och georeferensen i en uppladdning (`upload`). Förloppet visas med ord.
 */
export function MapFileUpload({ disabled, hasMap, upload, onMessage }: {
  disabled: boolean;
  hasMap: boolean;
  /** Skickar formuläret; ger beskedet (ok eller fel). */
  upload: (form: FormData, georeferenced: boolean) => Promise<Message | undefined>;
  onMessage: (message: Message | undefined) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<"reading" | "drawing" | "saving">();

  async function run() {
    const file = input.current?.files?.[0];
    if (!file) { onMessage({ tone: "error", text: text.chooseFile }); return; }
    if (file.size > RACE_MAP_SOURCE_MAX_BYTES) { onMessage({ tone: "error", text: text.tooLarge }); return; }
    onMessage(undefined);
    setStage("reading");
    try {
      const bytes = await file.arrayBuffer();
      const original = new Blob([bytes]);
      const result = await renderMapFile(createWorker, { bytes, fileName: file.name }, setStage);
      if (result.type === "error") { onMessage({ tone: "error", text: text.errors[result.code satisfies MapFileWorkerErrorCode] }); return; }
      setStage("saving");
      const form = new FormData();
      form.append(RACE_MAP_SOURCE_PARTS.metadata, new Blob([JSON.stringify(result.metadata)], { type: "application/json" }), "metadata.json");
      form.append(RACE_MAP_SOURCE_PARTS.file, original, file.name.slice(0, 200));
      form.append(RACE_MAP_SOURCE_PARTS.image, result.png, "karta.png");
      const message = await upload(form, result.metadata.tiePoints !== null);
      if (message?.tone === "ok" && input.current) input.current.value = "";
      onMessage(message);
    } finally { setStage(undefined); }
  }

  const working = stage !== undefined;
  return <form className={styles.inlineForm} onSubmit={event => { event.preventDefault(); void run(); }} aria-busy={working || undefined}>
    <Field label={text.file} help={text.fileHelp}>
      <input ref={input} type="file" accept=".ocd,.omap,.xmap" disabled={disabled || working} /></Field>
    <div className={styles.actions}>
      <Button type="submit" variant={hasMap ? "secondary" : "primary"} disabled={disabled || working}>{hasMap ? text.replace : text.upload}</Button>
    </div>
    {working && <p className={styles.progress} role="status">{text[stage]}</p>}
  </form>;
}

/** Raden efter uppladdningen: format och version, skala, koordinatsystem, antal objekt, förenklingar och georeferensen. */
export function MapFileSummary({ source, downloadHref }: { source: Source; downloadHref: string }) {
  const summary = text.summary;
  const crs = source.crs ? (source.crs.kind === "EPSG" ? summary.crs(source.crs.code) : summary.crs(null)) : summary.noCrs;
  const skipped = source.summary.warnings.filter(warning => warning.count > 0);
  return <div className={styles.sourceSummary}>
    <p className={styles.current}>
      <span>{summary.format(source.format, source.version)}</span>
      <span>{summary.scale(source.scale)}</span>
      <span>{crs}</span>
      <span>{summary.objects(source.summary.objectCount)}</span>
      <span className={styles.state} data-ok={source.georeferencedFromFile ? "true" : "false"}>
        {source.georeferencedFromFile ? summary.fromFile : summary.setPoints}</span>
      <a href={downloadHref} download>{text.download}</a>
    </p>
    {source.summary.simplifications.length > 0 && <p className={styles.muted}>
      {summary.simplifications}: {source.summary.simplifications.join(". ")}.</p>}
    {skipped.length > 0 && <p className={styles.muted}>{skipped.map(warning => warning.text).join(" ")}</p>}
  </div>;
}
