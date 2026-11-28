"use client";

import type { ClubStorage } from "@o-tid/contracts";
import { clubStorageEn } from "../../i18n/club-storage-en";
import { clubStorageSv } from "../../i18n/club-storage-sv";
import { useTexts } from "../language-provider";
import { Notice, numeric, Table } from "../ui";
import styles from "./club-archive.module.css";

/**
 * PLAN.md steg M7: beskedet vid 80 % och vid taket, överst på klubbsidan för ledare, administratörer och ägare (inget när
 * lagringen räcker).
 */
export function ClubStorageNotice({ storage }: { storage: ClubStorage }) {
  const text = useTexts(clubStorageSv, clubStorageEn);
  return storage.full ? <Notice tone="error" role="alert" data-testid="club-storage-notice">{text.full(storage.usedBytes, storage.limitBytes)}</Notice>
    : storage.warning ? <Notice tone="attention" role="status" data-testid="club-storage-notice">{text.warning(storage.usedBytes, storage.limitBytes)}</Notice>
    : null;
}

/** PLAN.md steg M7, steg F2: «Klubbens lagring» med kartorna störst först, under fliken Klubben (för administratören). */
export function ClubStorageSection({ storage }: { storage: ClubStorage }) {
  const text = useTexts(clubStorageSv, clubStorageEn);
  return <section aria-label={text.title} data-testid="club-storage">
    <details className={styles.card}>
      <summary><strong>{text.title}</strong> {text.summary(storage.usedBytes, storage.limitBytes)}</summary>
      <p className={styles.small}>{text.help}</p>
      {storage.maps.length === 0 && storage.courseFileBytes === 0 ? <p className={styles.muted}>{text.empty}</p> : <Table aria-label={text.title}>
        <thead><tr><th>{text.columns.map}</th><th className={numeric}>{text.columns.versions}</th><th className={numeric}>{text.columns.size}</th></tr></thead>
        <tbody>
          {storage.maps.map(map => <tr key={map.mapId}><th scope="row">{map.name}</th><td className={numeric}>{map.versions}</td>
            <td className={numeric}>{text.mb(map.bytes)}</td></tr>)}
          {storage.courseFileBytes > 0 && <tr><th scope="row">{text.courseFiles}</th><td /><td className={numeric}>{text.mb(storage.courseFileBytes)}</td></tr>}
        </tbody>
      </Table>}
    </details>
  </section>;
}
