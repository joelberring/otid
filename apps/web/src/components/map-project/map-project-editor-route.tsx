"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { MapProjectView } from "@o-tid/contracts";
import { mapProjectSv } from "../../i18n/map-project-sv";
import { mapProjectEditorSv } from "../../i18n/map-project-editor-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectBase, mapProjectFailure } from "../../lib/map-project-client";
import { forgetMapProjectCopy, saveMapProjectShell, saveMapProjectView, savedMapProjectView } from "../../lib/map-project-offline";
import { Notice } from "../ui";
import { MapProjectEditor } from "./map-project-editor";
import styles from "./map-project.module.css";

/**
 * ADR-0219 (K1): hämtar projektet och visar editorn (404 för den som inte är med). K3: utan nät visas projektet som det
 * senast lästes i telefonen; med nät sparas det och sidskalet för nästa gång (kartan i skogen).
 */
export function MapProjectEditorRoute({ projectId }: { projectId: string }) {
  const [view, setView] = useState<MapProjectView>();
  const [offlineSince, setOfflineSince] = useState<string>();
  const [problem, setProblem] = useState("");
  useEffect(() => {
    let closed = false;
    const fromPhone = async () => {
      const saved = await savedMapProjectView(projectId).catch(() => undefined);
      if (closed) return;
      if (saved) { setView(saved.view); setOfflineSince(saved.savedAt); } else setProblem(mapProjectFailure(0));
    };
    clubRequest(mapProjectBase(projectId)).then(result => {
      if (closed) return;
      if (result.status === 200) {
        const loaded = result.json as MapProjectView;
        setView(loaded);
        void saveMapProjectView(loaded).catch(error => console.error("Projektet kunde inte sparas i telefonen", error));
        void saveMapProjectShell(projectId).catch(error => console.error("Kartsidan kunde inte sparas för offline", error));
        return;
      }
      if (result.status === 403 || result.status === 404) void forgetMapProjectCopy(projectId).catch(() => undefined);
      setProblem(mapProjectFailure(result.status));
    }, () => void fromPhone());
    return () => { closed = true; };
  }, [projectId]);
  if (view) return <MapProjectEditor view={view} offlineSince={offlineSince} />;
  return <main className={styles.page}>
    {problem ? <><Notice tone="error" role="alert">{problem}</Notice><p><Link href="/organizer/map-projects">{mapProjectSv.list.title}</Link></p></>
      : <p aria-live="polite">{mapProjectEditorSv.loading}</p>}
  </main>;
}
