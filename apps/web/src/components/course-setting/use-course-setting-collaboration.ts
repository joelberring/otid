"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CourseSettingMode, CourseSettingNote, CourseSettingPresence, CourseSettingSuggestion } from "@o-tid/contracts";
import {
  courseSettingEventsUrl, fetchCourseSetting, fetchCourseSettingNotes, fetchCourseSettingSuggestions
} from "../../lib/course-setting-api";
import { openCourseSettingStream } from "../../lib/course-setting-stream-client";

/**
 * Steg 66: notiserna, förslagen, arbetssättet och närvaron, hållna aktuella med banläggningens ström. En ny version från
 * någon annan lämnas till `onRemoteVersion` (editorns sparande hämtar och spelar upp). Egna besked i strömmen hoppas över;
 * efter egna ändringar hämtar vyn själv.
 */
export function useCourseSettingCollaboration(raceId: string, me: string, initialMode: CourseSettingMode,
  onRemoteVersion: (version: number, by: string) => void) {
  const [notes, setNotes] = useState<readonly CourseSettingNote[]>([]);
  const [suggestions, setSuggestions] = useState<readonly CourseSettingSuggestion[]>([]);
  const [presence, setPresence] = useState<CourseSettingPresence>([]);
  const [mode, setMode] = useState<CourseSettingMode>(initialMode);
  const remote = useRef(onRemoteVersion);
  remote.current = onRemoteVersion;

  const reloadNotes = useCallback(async () => {
    try { setNotes((await fetchCourseSettingNotes(raceId)).notes); } catch (error) { console.error("Notiserna kunde inte hämtas", error); }
  }, [raceId]);
  const reloadSuggestions = useCallback(async () => {
    try { setSuggestions((await fetchCourseSettingSuggestions(raceId)).suggestions); } catch (error) { console.error("Förslagen kunde inte hämtas", error); }
  }, [raceId]);
  const reloadState = useCallback(async () => {
    try {
      const state = await fetchCourseSetting(raceId);
      if (state.setting) { setMode(state.setting.mode); remote.current(state.setting.version, ""); }
    } catch (error) { console.error("Banläggningen kunde inte hämtas", error); }
  }, [raceId]);

  useEffect(() => {
    void reloadNotes(); void reloadSuggestions();
    return openCourseSettingStream(courseSettingEventsUrl(raceId), {
      version: (version, by) => { if (by !== me) remote.current(version, by); },
      notes: by => { if (by !== me) void reloadNotes(); },
      suggestions: by => { if (by !== me) void reloadSuggestions(); },
      mode: by => { if (by !== me) void reloadState(); },
      presence: setPresence,
      reconnected: () => { void reloadNotes(); void reloadSuggestions(); void reloadState(); }
    });
  }, [raceId, me, reloadNotes, reloadSuggestions, reloadState]);

  return { notes, suggestions, presence, mode, setMode, reloadNotes, reloadSuggestions };
}
