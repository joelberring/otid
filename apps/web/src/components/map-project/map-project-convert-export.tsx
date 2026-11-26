"use client";

import { useState } from "react";
import type { MapConversionReportView } from "@o-tid/contracts";
import { mapProjectEn } from "../../i18n/map-project-en";
import { mapProjectSv } from "../../i18n/map-project-sv";
import { useTexts } from "../language-provider";
import { Button, Notice } from "../ui";
import { useMapProjectFailure } from "./use-map-project-failure";
import styles from "./map-project.module.css";

/** Avkodar base64-kodad UTF-8 JSON ur svarsheadern `x-otid-conversion-report`. */
export function decodeConversionReportHeader(headerValue: string | null): MapConversionReportView | undefined {
  if (!headerValue) return undefined;
  try {
    const binary = atob(headerValue);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const parsed = JSON.parse(new TextDecoder("utf-8").decode(bytes)) as Partial<MapConversionReportView>;
    if (parsed.formatVersion === 1 && Array.isArray(parsed.warnings) && typeof parsed.fileName === "string") {
      return parsed as MapConversionReportView;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Etapp 5B: Fullkartekonvertering (`.omap` → `.ocd` och `.ocd` → `.omap`) i Exportera-sektionen.
 * Visas ENDAST när `canDownloadSource` är sant (samma säkerhetsspärr som källfilen och ändringsexporten),
 * laddar ner den konverterade filen och visar tydlig formatgapsrapport direkt under knappen.
 */
export function MapProjectConvertExport({
  base,
  sourceFormat,
  canDownloadSource,
  initialReport
}: {
  base: string;
  sourceFormat: "OCD" | "OMAP";
  canDownloadSource: boolean;
  initialReport?: MapConversionReportView | undefined;
}) {
  const failure = useMapProjectFailure();
  const text = useTexts(mapProjectSv.page, mapProjectEn.page);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<MapConversionReportView | undefined>(initialReport);

  if (!canDownloadSource) return null;

  const targetParam = sourceFormat === "OMAP" ? "ocd-full" : "omap-full";
  const buttonLabel = sourceFormat === "OMAP" ? text.convertToOcd : text.convertToOmap;
  const buttonTestId = sourceFormat === "OMAP" ? "map-project-export-ocd-full" : "map-project-export-omap-full";
  const fallbackFileName = sourceFormat === "OMAP" ? "karta.ocd" : "karta.omap";

  async function convertAndDownload() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${base}/export?format=${targetParam}`, { credentials: "same-origin" });
      if (!response.ok) {
        setError(failure(response.status));
        return;
      }
      const parsedReport = decodeConversionReportHeader(response.headers.get("x-otid-conversion-report"));
      const blob = await response.blob();
      const fileName = parsedReport?.fileName || fallbackFileName;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      if (parsedReport) setReport(parsedReport);
    } catch {
      setError(failure(0));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <h3>{text.convertTitle}</h3>
    <p className={styles.muted}>{text.convertHelp}</p>
    <div className={styles.actions}>
      <Button variant="secondary" disabled={busy} aria-busy={busy} data-testid={buttonTestId} onClick={() => void convertAndDownload()}>
        {busy ? text.convertWorking : buttonLabel}
      </Button>
    </div>
    {error && <Notice tone="error" role="alert">{error}</Notice>}
    {report && (report.warnings.length > 0 ? (
      <Notice tone="attention" role="status">
        <div data-testid="map-project-conversion-warnings">
          <p>{text.convertDoneWithWarnings(report.fileName, report.objects, report.warnings.length)}</p>
          <ul className={styles.refusals}>
            {report.warnings.map(warning => {
              const formatter = text.convertWarnings[warning.code];
              return <li key={warning.code}>{formatter ? formatter(warning.count) : warning.message}</li>;
            })}
          </ul>
        </div>
      </Notice>
    ) : (
      <Notice tone="ok" role="status">
        <span data-testid="map-project-conversion-ok">{text.convertDone(report.fileName, report.objects)}</span>
      </Notice>
    ))}
  </>;
}
