"use client";

import type { CourseSettingDocument } from "@o-tid/course-setting";
import { useState } from "react";
import { mapReplaceEn } from "../../i18n/course-setting-map-replace-en";
import { mapReplaceSv } from "../../i18n/course-setting-map-replace-sv";
import { raceMapSv } from "../../i18n/race-map-sv";
import { raceMapEn } from "../../i18n/workspace-small-en";
import { controlsOutsideNewMap, uploadCourseSettingMap } from "../../lib/course-setting-map-upload";
import { RACE_MAP_SOURCE_PARTS } from "@o-tid/contracts";
import { useTexts } from "../language-provider";
import { MapFileUpload } from "../race-administrator/map-file-upload";
import type { Message } from "../race-administrator/source-sync-actions";
import { Notice } from "../ui";
import styles from "./course-setting.module.css";

/**
 * Byt kartfil direkt i banläggningen (ägaren 2026-11-17), i menyn bredvid Fil och versioner, för den som är admin. Det osparade
 * skickas först; efter bytet läses banläggningen på nytt med beskedet (och hur många kontroller som hamnade utanför kartan).
 */
export function MapReplacePanel({ raceId, mapFile, document, flush, onReplaced }: {
  raceId: string; mapFile: { fileName: string; scale: number } | null; document: CourseSettingDocument;
  flush: () => Promise<boolean>; onReplaced: (notice: string) => void;
}) {
  const text = useTexts(mapReplaceSv, mapReplaceEn);
  const raceMapText = useTexts(raceMapSv, raceMapEn);
  const [message, setMessage] = useState<Message>();
  async function upload(form: FormData): Promise<Message | undefined> {
    if (!await flush()) return { tone: "error", text: text.unsaved };
    const result = await uploadCourseSettingMap(raceId, form, raceMapText);
    if (result?.tone !== "ok") return result;
    const outside = await controlsOutsideNewMap(form, document).catch(() => undefined);
    const file = form.get(RACE_MAP_SOURCE_PARTS.file);
    const name = file instanceof File ? file.name : "";
    onReplaced([text.replaced(name), outside ? text.outside(outside) : "", text.checkPhone].filter(Boolean).join(" "));
    return undefined;
  }
  return <section className={styles.panel} aria-labelledby="course-setting-map-replace">
    <h2 id="course-setting-map-replace">{text.heading}</h2>
    {mapFile && <p>{text.current(mapFile.fileName, mapFile.scale.toLocaleString("sv-SE"))}</p>}
    <p className={styles.muted}>{text.help}</p>
    <MapFileUpload disabled={false} hasMap={mapFile !== null} upload={upload} onMessage={setMessage} />
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
  </section>;
}
