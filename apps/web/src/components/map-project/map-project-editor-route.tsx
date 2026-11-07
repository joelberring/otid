"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { MapProjectView } from "@o-tid/contracts";
import { mapProjectSv } from "../../i18n/map-project-sv";
import { mapProjectEditorSv } from "../../i18n/map-project-editor-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectBase, mapProjectFailure } from "../../lib/map-project-client";
import { Notice } from "../ui";
import { MapProjectEditor } from "./map-project-editor";
import styles from "./map-project.module.css";

/** ADR-0219 (K1): hämtar projektet och visar editorn (404 för den som inte är med). */
export function MapProjectEditorRoute({ projectId }: { projectId: string }) {
  const [view, setView] = useState<MapProjectView>();
  const [problem, setProblem] = useState("");
  useEffect(() => {
    void clubRequest(mapProjectBase(projectId)).then(result => {
      if (result.status === 200) setView(result.json as MapProjectView);
      else setProblem(mapProjectFailure(result.status));
    });
  }, [projectId]);
  if (view) return <MapProjectEditor view={view} />;
  return <main className={styles.page}>
    {problem ? <><Notice tone="error" role="alert">{problem}</Notice><p><Link href="/organizer/map-projects">{mapProjectSv.list.title}</Link></p></>
      : <p aria-live="polite">{mapProjectEditorSv.loading}</p>}
  </main>;
}
