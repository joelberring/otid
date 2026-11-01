"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CourseSettingInspection, CourseSettingMode, CourseSettingNote, CourseSettingPresence, CourseSettingSuggestion
} from "@o-tid/contracts";
import {
  courseSettingEventsUrl, fetchCourseSetting, fetchCourseSettingInspections, fetchCourseSettingNotes, fetchCourseSettingSuggestions
} from "../../lib/course-setting-api";
import { openCourseSettingStream } from "../../lib/course-setting-stream-client";

/**
 * Steg 66: notiserna, förslagen, arbetssättet och närvaron, hållna aktuella med banläggningens ström. En ny version från
 * någon (även samma konto i en annan flik) lämnas till `onRemoteVersion`; editorns sparande hoppar över en version som det
 * redan har. Notiser och förslag hämtas om vid varje besked (en lätt fråga).
 *
 * Steg 67: bockarna för "kollad" på samma sätt. Utan nät misslyckas hämtningen tyst (det som visas står kvar).
 */
export function useCourseSettingCollaboration(raceId: string, initialMode: CourseSettingMode,
  onRemoteVersion: (version: number, by: string) => void,
  saved?: { readonly notes?: readonly CourseSettingNote[] | undefined; readonly inspections?: readonly CourseSettingInspection[] | undefined }) {
  const [notes, setNotes] = useState<readonly CourseSettingNote[]>(saved?.notes ?? []);
  const [suggestions, setSuggestions] = useState<readonly CourseSettingSuggestion[]>([]);
  const [presence, setPresence] = useState<CourseSettingPresence>([]);
  const [mode, setMode] = useState<CourseSettingMode>(initialMode);
  const [inspections, setInspections] = useState<readonly CourseSettingInspection[]>(saved?.inspections ?? []);
  const remote = useRef(onRemoteVersion);
  remote.current = onRemoteVersion;

  const reloadNotes = useCallback(async () => {
    try { setNotes((await fetchCourseSettingNotes(raceId)).notes); } catch (error) { console.error("Notiserna kunde inte hämtas", error); }
  }, [raceId]);
  const reloadSuggestions = useCallback(async () => {
    try { setSuggestions((await fetchCourseSettingSuggestions(raceId)).suggestions); } catch (error) { console.error("Förslagen kunde inte hämtas", error); }
  }, [raceId]);
  const reloadInspections = useCallback(async () => {
    try { setInspections((await fetchCourseSettingInspections(raceId)).inspections); } catch (error) { console.error("Bockarna kunde inte hämtas", error); }
  }, [raceId]);
  const reloadState = useCallback(async () => {
    try {
      const state = await fetchCourseSetting(raceId);
      if (state.setting) { setMode(state.setting.mode); remote.current(state.setting.version, ""); }
    } catch (error) { console.error("Banläggningen kunde inte hämtas", error); }
  }, [raceId]);

  useEffect(() => {
    void reloadNotes(); void reloadSuggestions(); void reloadInspections();
    return openCourseSettingStream(courseSettingEventsUrl(raceId), {
      version: (version, by) => remote.current(version, by),
      notes: () => void reloadNotes(),
      suggestions: () => void reloadSuggestions(),
      mode: () => void reloadState(),
      inspections: () => void reloadInspections(),
      presence: setPresence,
      reconnected: () => { void reloadNotes(); void reloadSuggestions(); void reloadState(); void reloadInspections(); }
    });
  }, [raceId, reloadNotes, reloadSuggestions, reloadState, reloadInspections]);

  return { notes, suggestions, presence, mode, setMode, reloadNotes, reloadSuggestions, inspections, setInspections, reloadInspections };
}
