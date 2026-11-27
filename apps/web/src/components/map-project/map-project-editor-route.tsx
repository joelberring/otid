"use client";

import { useMapProjectFailure } from "./use-map-project-failure";
import { useEffect, useState } from "react";
import { mapProjectEditorEn } from "../../i18n/map-project-en";
import { mapProjectEn } from "../../i18n/map-project-en";
import { useTexts } from "../language-provider";
import Link from "next/link";
import type { MapProjectView } from "@o-tid/contracts";
import { mapProjectSv } from "../../i18n/map-project-sv";
import { mapProjectEditorSv } from "../../i18n/map-project-editor-sv";
import { mapBankEn } from "../../i18n/map-bank-en";
import { mapBankSv } from "../../i18n/map-bank-sv";
import { clubRequest } from "../../lib/club-request";
import { mapProjectBase } from "../../lib/map-project-client";
import { forgetMapProjectCopy, saveMapProjectView, savedMapProjectView } from "../../lib/map-project-offline";
import { Notice } from "../ui";
import { MapProjectEditor } from "./map-project-editor";
import styles from "./map-project.module.css";

/**
 * ADR-0219 (K1): hämtar projektet och visar editorn (404 för den som inte är med). K3: utan nät visas projektet som det
 * senast lästes i telefonen; med nät sparas det (och editorn sparar sidskalet när kartan är läst) för nästa gång.
 */
export function MapProjectEditorRoute({ projectId }: { projectId: string }) {
  const failure = useMapProjectFailure();
  const mapProjectEditorText = useTexts(mapProjectEditorSv, mapProjectEditorEn);
  const mapProjectText = useTexts(mapProjectSv, mapProjectEn);
  const mapBankText = useTexts(mapBankSv, mapBankEn);
  const [view, setView] = useState<MapProjectView>();
  const [offlineSince, setOfflineSince] = useState<string>();
  const [problem, setProblem] = useState("");
  useEffect(() => {
    let closed = false;
    const fromPhone = async () => {
      const saved = await savedMapProjectView(projectId).catch(() => undefined);
      if (closed) return;
      if (saved) { setView(saved.view); setOfflineSince(saved.savedAt); } else setProblem(failure(0));
    };
    clubRequest(mapProjectBase(projectId)).then(result => {
      if (closed) return;
      if (result.status === 200) {
        const loaded = result.json as MapProjectView;
        setView(loaded);
        if (loaded.viewer.canDownloadSource) {
          void saveMapProjectView(loaded).catch(error => console.error("Projektet kunde inte sparas i telefonen", error));
        } else {
          void forgetMapProjectCopy(projectId).catch(() => undefined);
        }
        return;
      }
      if (result.status === 403 || result.status === 404) void forgetMapProjectCopy(projectId).catch(() => undefined);
      setProblem(failure(result.status));
    }, () => void fromPhone());
    return () => { closed = true; };
  }, [projectId]);
  if (view && !view.viewer.canDownloadSource) {
    return <main className={styles.page}>
      <p className={styles.kicker}><Link href={`/organizer/map-projects/${encodeURIComponent(projectId)}`}>{mapProjectEditorText.back}</Link></p>
      <h1>{view.name}</h1>
      <Notice tone="attention" role="status"><span data-testid="map-project-editor-locked-notice">{mapBankText.projectProtection.lockedForMember}</span></Notice>
    </main>;
  }
  if (view) return <MapProjectEditor view={view} offlineSince={offlineSince} />;
  return <main className={styles.page}>
    {problem ? <><Notice tone="error" role="alert">{problem}</Notice><p><Link href="/organizer/map-projects">{mapProjectText.list.title}</Link></p></>
      : <p aria-live="polite">{mapProjectEditorText.loading}</p>}
  </main>;
}
