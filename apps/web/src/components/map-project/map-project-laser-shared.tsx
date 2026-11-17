"use client";

import type { GeoJobList } from "@o-tid/contracts";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import { useTexts } from "../language-provider";
import styles from "./map-project-editor.module.css";

/** Geo-serverns läge och kön över alla kartprojekt (ägaren 2026-11-13); `testId` skiljer laserpanelens rad från guidens. */
export function LaserServerStatus({ list, testId }: { list: GeoJobList; testId: string }) {
  const text = useTexts(mapSourcesSv.laser, mapSourcesEn.laser);
  return <p className={styles.muted} role="status" data-testid={`${testId}-server`}>{text.server[list.server.state]}
    {list.server.detail ? ` ${list.server.detail}` : ""}
    {list.queue && list.queue.running + list.queue.waiting > 0 && <span data-testid={`${testId}-queue`}> {text.queue(list.queue.running, list.queue.waiting, list.queue.users)}</span>}</p>;
}
