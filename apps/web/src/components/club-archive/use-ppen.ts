"use client";

import { useEffect, useState } from "react";
import type { ClubArchiveCourseFileView } from "@o-tid/contracts";
import { readPpen, type CourseSettingDocument } from "@o-tid/course-setting";
import { fetchCourseFileText } from "../../lib/club-archive-client";

/** En .ppen läst i webbläsaren (för banpåtrycket och "Använd igen"). */
export function usePpen(clubId: string, file: ClubArchiveCourseFileView | undefined) {
  const [state, setState] = useState<{ fileId: string; ppen: string; document: CourseSettingDocument } | { fileId: string; failed: true }>();
  useEffect(() => {
    if (!file || file.kind !== "PPEN") return;
    let active = true;
    void fetchCourseFileText(clubId, file.courseFileId).then(ppen => {
      if (!active) return;
      try { setState({ fileId: file.courseFileId, ppen, document: readPpen(ppen).document }); }
      catch { setState({ fileId: file.courseFileId, failed: true }); }
    }).catch(() => { if (active) setState({ fileId: file.courseFileId, failed: true }); });
    return () => { active = false; };
  }, [clubId, file]);
  return state && state.fileId === file?.courseFileId && !("failed" in state) ? state : undefined;
}

