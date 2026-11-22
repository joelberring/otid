"use client";

import type { ClubStorage } from "@o-tid/contracts";
import { clubStorageEn } from "../../i18n/club-storage-en";
import { clubStorageSv } from "../../i18n/club-storage-sv";
import { useTexts } from "../language-provider";
import { Notice, numeric, Table } from "../ui";
import styles from "./club-archive.module.css";

/**
 * PLAN.md steg M7: klubbens lagring på klubbsidan för ledare, administratörer och ägare. Beskedet vid 80 % och vid taket står
 * alltid synligt; kartorna, störst först, under «Klubbens lagring».
 */
export function ClubStorageSection({ storage }: { storage: ClubStorage }) {
  const text = useTexts(clubStorageSv, clubStorageEn);
  return <section aria-label={text.title} data-testid="club-storage">
    {storage.full ? <Notice tone="error" role="alert">{text.full(storage.usedBytes, storage.limitBytes)}</Notice>
      : storage.warning && <Notice tone="attention" role="status">{text.warning(storage.usedBytes, storage.limitBytes)}</Notice>}
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
