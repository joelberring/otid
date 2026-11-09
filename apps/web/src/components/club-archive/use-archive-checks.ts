"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clubArchiveChecksEn } from "../../i18n/club-archive-more-en";
import { useTexts } from "../language-provider";
import type { ClubArchiveEntryView, ClubArchiveList, ClubArchiveListItem } from "@o-tid/contracts";
import { courseSummaries, layoutOverprint, readPpen, type CourseSettingDocument, type OverprintPrimitive } from "@o-tid/course-setting";
import { MAP_READER_VERSION } from "@o-tid/map-file";
import { clubArchiveChecksSv } from "../../i18n/club-archive-checks-sv";
import { clubBase, clubRequest, fetchCourseFileText, renderMapVersion } from "../../lib/club-archive-client";
import {
  checkStatusOf, encodeThumbnail, planChecks, refreshSummaries, renderFailureReason, saveEntryThumbnail, saveMapCheck, type CheckJob as Job,
  type EncodedPng
} from "../../lib/club-archive-thumbnails";
import type { MapFileRenderError, MapFileRenderResult } from "../../lib/map-file-worker-protocol";
import { paintCourseOnMap, type CourseData } from "./course-preview";

/**
 * ADR-0196: kontrollen av klubbarkivets kartor och bilderna av kartorna och träningarna, i en administratörs webbläsare.
 * Varje kartversion ritas en gång (högst 2 400 px) och ger både versionens bild och bilderna av träningarna som gjordes på
 * den. Automatiskt görs bara det som saknas eller ritades med en äldre läsare, högst sex kartversioner per besök; "Kontrollera
 * alla kartor igen" gör om allt. Servern sparar resultatet, så en körning som avbryts fortsätter nästa gång.
 */
const RENDER_MAX_SIDE = 2400;
const MAP_THUMBNAIL_SIDE = 480;
const ENTRY_THUMBNAIL = { width: 360, height: 240 };
export const AUTO_VERSION_LIMIT = 6;


export type ChecksState = { running: false; message?: { tone: "ok" | "error"; text: string } | undefined }
  | { running: true; forced: boolean; done: number; total: number; label: string };

type Ready = { rendered: MapFileRenderResult; bitmap: ImageBitmap };

/** Den längsta banan i banfilen (längd, annars flest kontroller). */
const longest = <T extends { lengthM?: number | null; controls?: number }>(courses: readonly T[]) =>
  [...courses].sort((a, b) => (b.lengthM ?? 0) - (a.lengthM ?? 0) || (b.controls ?? 0) - (a.controls ?? 0))[0];

async function entryImage(clubId: string, entry: ClubArchiveListItem, ready: Ready): Promise<{ image: EncodedPng | null; courseName: string | null }> {
  const courseFileId = entry.thumbnailSource?.courseFileId ?? null;
  let course: { document?: CourseSettingDocument; primitives: readonly OverprintPrimitive[]; courseData?: CourseData } = { primitives: [] };
  let courseName: string | null = null;
  if (courseFileId) {
    const viewResult = await clubRequest(`${clubBase(clubId)}/archive/${entry.entryId}`);
    const file = viewResult.status === 200 ? (viewResult.json as ClubArchiveEntryView).courseFiles.find(item => item.courseFileId === courseFileId) : undefined;
    if (file?.kind === "PPEN") {
      try {
        const document = readPpen(await fetchCourseFileText(clubId, courseFileId)).document;
        const pick = longest(courseSummaries(document).map(summary => ({ ...summary, lengthM: summary.lengthMeters, controls: summary.controlCount })));
        if (pick) { course = { document, primitives: layoutOverprint(document, { course: pick.course }) }; courseName = pick.name; }
      } catch (error) { console.error("Banfilen kunde inte läsas för träningens bild", error); }
    } else if (file?.courseData) {
      const pick = longest(file.courses);
      const data = file.courseData.find(item => item.name === pick?.name && item.points.length > 0) ?? file.courseData.find(item => item.points.length > 0);
      if (data) { course = { primitives: [], courseData: data }; courseName = data.name; }
    }
  }
  const image = await encodeThumbnail(ENTRY_THUMBNAIL.width, ENTRY_THUMBNAIL.height, (ctx, size) => paintCourseOnMap(ctx, size, ready, course));
  return { image, courseName: courseName?.slice(0, 120) ?? null };
}

function mapImage(ready: Ready): Promise<EncodedPng | null> {
  const { bitmap } = ready;
  const factor = Math.min(1, MAP_THUMBNAIL_SIDE / Math.max(bitmap.width, bitmap.height));
  return encodeThumbnail(bitmap.width * factor, bitmap.height * factor, (ctx, size) => {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  });
}

/** En kartversion: rita, spara kontrollen och träningarnas bilder. Sant när kartan fungerar. */
async function runJob(clubId: string, job: Job, signal: AbortSignal): Promise<boolean> {
  let rendered: MapFileRenderResult | MapFileRenderError;
  try {
    rendered = await renderMapVersion(clubId, job.versionId, job.fileName, undefined, signal, RENDER_MAX_SIDE);
  } catch (error) {
    // Filen kunde inte hämtas (nätet, inloggningen): inget sparas, nästa körning försöker igen.
    if (!signal.aborted) console.error("Kartfilen kunde inte hämtas för kontrollen", error);
    return false;
  }
  if (signal.aborted) return false;
  if (rendered.type === "error") {
    const reason = renderFailureReason(rendered.code, rendered.message).slice(0, 300);
    if (job.check) await saveMapCheck(clubId, job.versionId, { readerVersion: MAP_READER_VERSION, status: checkStatusOf(rendered.code),
      detail: rendered.message?.slice(0, 300) ?? null, fileVersion: null, thumbnail: null });
    for (const entry of job.entries) {
      if (signal.aborted) return false;
      await saveEntryThumbnail(clubId, entry.entryId, { readerVersion: MAP_READER_VERSION, status: "MAP_FAILED", detail: reason, mapVersionId: job.versionId,
        courseName: null, image: null });
    }
    return false;
  }
  const bitmap = await createImageBitmap(rendered.png);
  try {
    const ready = { rendered, bitmap };
    if (job.check) await saveMapCheck(clubId, job.versionId, { readerVersion: MAP_READER_VERSION, status: "OK", detail: null,
      fileVersion: rendered.metadata.version.slice(0, 60) || null, thumbnail: await mapImage(ready), fingerprint: rendered.fingerprint ?? null });
    for (const entry of job.entries) {
      if (signal.aborted) return true;
      const { image, courseName } = await entryImage(clubId, entry, ready);
      await saveEntryThumbnail(clubId, entry.entryId, image
        ? { readerVersion: MAP_READER_VERSION, status: "OK", detail: null, mapVersionId: job.versionId, courseName, image }
        : { readerVersion: MAP_READER_VERSION, status: "MAP_FAILED", detail: clubArchiveChecksSv.explain.TOO_LARGE, mapVersionId: job.versionId, courseName, image: null });
    }
    return true;
  } finally {
    bitmap.close();
  }
}

/**
 * Kör kontrollen i bakgrunden när en medlem som får rita kartorna (`canCheck`) öppnar arkivet, och ger "Kontrollera alla kartor
 * igen" (bara administratörer, som också räknar om banfilernas sammanfattningar). `reload` hämtar
 * arkivet på nytt efter varje kartversion, så att bilderna och märkena syns efter hand.
 */
export function useArchiveChecks(clubId: string, list: ClubArchiveList | undefined, canCheck: boolean, reload: () => Promise<void>) {
  const text = useTexts(clubArchiveChecksSv, clubArchiveChecksEn);
  const [state, setState] = useState<ChecksState>({ running: false });
  const controller = useRef<AbortController | null>(null);
  const started = useRef(false);
  const listRef = useRef(list);
  listRef.current = list;

  const run = useCallback(async (force: boolean) => {
    const current = listRef.current;
    if (!current || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    try {
      let summariesFailed = false;
      if (force) summariesFailed = (await refreshSummaries(clubId)) === null;
      const all = planChecks(current, force);
      const jobs = force ? all : all.slice(0, AUTO_VERSION_LIMIT);
      let failed = 0;
      for (const [index, job] of jobs.entries()) {
        if (abort.signal.aborted) break;
        setState({ running: true, forced: force, done: index, total: jobs.length, label: job.label });
        if (!await runJob(clubId, job, abort.signal) && job.check) failed++;
        if (!abort.signal.aborted) await reload();
      }
      if (abort.signal.aborted) return;
      const checked = jobs.filter(job => job.check).length;
      setState({ running: false, message: force ? summariesFailed ? { tone: "error", text: text.summariesFailed } : { tone: "ok", text: text.finished(checked, failed) }
        : undefined });
    } finally {
      controller.current = null;
    }
  }, [clubId, reload]);

  useEffect(() => {
    if (!canCheck || !list || started.current) return;
    started.current = true;
    void run(false);
  }, [canCheck, list, run]);

  useEffect(() => () => controller.current?.abort(), []);

  const recheckAll = useCallback(() => {
    void (async () => {
      // En automatisk körning avbryts först; det den hann med är redan sparat.
      controller.current?.abort();
      while (controller.current) await new Promise(resolve => setTimeout(resolve, 50));
      await run(true);
    })();
  }, [run]);
  const stop = useCallback(() => {
    controller.current?.abort();
    setState({ running: false, message: { tone: "ok", text: text.stopped } });
  }, []);
  return { state, recheckAll, stop };
}
