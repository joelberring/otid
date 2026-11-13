"use client";

import type { GeoJobList } from "@o-tid/contracts";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import { useTexts } from "../language-provider";
import styles from "./map-project-editor.module.css";

/** Uppgifterna till Lantmäteriet saknas: beskedet och länken till Mitt konto (där de läggs in; lösenordet visas aldrig igen). */
export function LaserCredentialHint() {
  const text = useTexts(mapSourcesSv.ortho, mapSourcesEn.ortho);
  return <p className={styles.muted}>{text.noCredential} <a href="/konto#konto-lantmateriet">{text.account}</a></p>;
}

/** Geo-serverns läge och kön över alla kartprojekt (ägaren 2026-11-13); `testId` skiljer laserpanelens rad från guidens. */
export function LaserServerStatus({ list, testId }: { list: GeoJobList; testId: string }) {
  const text = useTexts(mapSourcesSv.laser, mapSourcesEn.laser);
  return <p className={styles.muted} role="status" data-testid={`${testId}-server`}>{text.server[list.server.state]}
    {list.server.detail ? ` ${list.server.detail}` : ""}
    {list.queue && list.queue.running + list.queue.waiting > 0 && <span data-testid={`${testId}-queue`}> {text.queue(list.queue.running, list.queue.waiting, list.queue.users)}</span>}</p>;
}
