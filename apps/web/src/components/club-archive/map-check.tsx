"use client";

import type { ClubArchiveListItem, ClubMapCheckView, ClubMapVersionView } from "@o-tid/contracts";
import { clubArchiveChecksEn } from "../../i18n/club-archive-more-en";
import { useTexts } from "../language-provider";
import { clubArchiveChecksSv } from "../../i18n/club-archive-checks-sv";
import { checkExplanation, checkLabel, entryThumbnailUrl, mapThumbnailUrl } from "../../lib/club-archive-thumbnails";
import styles from "./archive-checks.module.css";

const chipStatus = (check: ClubMapCheckView | null) => !check ? "NONE" : check.status === "OK" ? "OK" : "FAILED";

/** ADR-0196: "Fungerar · OCAD 11.2" eller skälet ("OCAD 7 stöds inte", "Filen är skadad"), i text och inte bara färg. */
export function MapCheckChip({ check, checking = false, explain = false }: { check: ClubMapCheckView | null; checking?: boolean; explain?: boolean }) {
  const text = useTexts(clubArchiveChecksSv, clubArchiveChecksEn);
  const why = checkExplanation(check, text);
  return <span>
    <span className={styles.chip} data-status={chipStatus(check)} data-testid="map-check" title={why || undefined}>
      {checking ? text.checking : checkLabel(check, text)}</span>
    {explain && why && <span className={`${styles.why} ${styles.block}`}>{why}</span>}
  </span>;
}

/** Kartversionens bild, eller en ruta med varför den saknas. */
export function MapThumbnail({ clubId, version, name }: { clubId: string; version: ClubMapVersionView | undefined; name: string }) {
  const text = useTexts(clubArchiveChecksSv, clubArchiveChecksEn);
  const check = version?.check ?? null;
  if (version && check?.thumbnail) {
    return <img className={styles.thumb} src={mapThumbnailUrl(clubId, version.versionId, check.checkedAt)} alt={text.mapImage(name)} loading="lazy"
      data-testid="map-thumbnail" />;
  }
  return <div className={styles.placeholder} data-testid="map-thumbnail-missing">{check ? checkLabel(check, text) : text.noImage}</div>;
}

/** Träningens lilla bild i listan: längsta banan på kartan, eller varför den saknas. */
export function EntryThumbnail({ clubId, entry }: { clubId: string; entry: ClubArchiveListItem }) {
  const text = useTexts(clubArchiveChecksSv, clubArchiveChecksEn);
  const thumbnail = entry.thumbnail;
  if (thumbnail?.status === "OK") {
    return <img className={styles.entryThumb} src={entryThumbnailUrl(clubId, entry.entryId, thumbnail.createdAt)}
      alt={thumbnail.courseName ? `${text.trainingImage(entry.title)} (${thumbnail.courseName})` : text.trainingImage(entry.title)} loading="lazy"
      data-testid="entry-thumbnail" />;
  }
  const label = !entry.thumbnailSource ? text.trainingNoMap : thumbnail?.status === "MAP_FAILED" ? text.trainingMapFailed : text.noImage;
  return <span className={styles.entryPlaceholder} data-testid="entry-thumbnail-missing" title={thumbnail?.detail ?? undefined}>{label}</span>;
}
