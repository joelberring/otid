"use client";

import Link from "next/link";
import { useState } from "react";
import type { PublicMapListingDetail } from "@o-tid/contracts";
import { municipalityByCode } from "@o-tid/domain";
import { mapBankEn } from "../../i18n/map-bank-en";
import { mapBankSv } from "../../i18n/map-bank-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { useTexts } from "../language-provider";
import { Button, Notice } from "../ui";
import styles from "./public-map-bank.module.css";

export interface PublicMapBankDetailProps {
  readonly listing: PublicMapListingDetail | null;
  readonly loading: boolean;
  readonly error?: string | undefined;
  readonly onClose: () => void;
}

function formatScale(scale: number): string {
  return `1:${scale.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0")}`;
}

/**
 * Detaljkort för en vald karta i publika kartbanken (`/kartbank`).
 * Förhandsvisningsbild visas BARA när `showPreview === true && hasPreview`.
 */
export function PublicMapBankDetail({ listing, loading, error, onClose }: PublicMapBankDetailProps) {
  const text = useTexts(mapBankSv, mapBankEn);
  const [using, setUsing] = useState(false);
  const [signedOutHint, setSignedOutHint] = useState(false);
  const [useError, setUseError] = useState<string>();

  async function handleUseInOtid() {
    if (!listing || using) return;
    setUsing(true);
    setSignedOutHint(false);
    setUseError(undefined);
    try {
      const response = await clubRequest(`/api/organizer/map-bank/${encodeURIComponent(listing.id)}/use`, "POST", { formatVersion: 1 });
      if (response.status === 401) {
        setSignedOutHint(true);
        return;
      }
      if (response.status === 201) {
        const body = response.json as { raceId?: string } | undefined;
        if (body?.raceId) {
          window.location.assign(`/admin/${encodeURIComponent(body.raceId)}/course-setting`);
          return;
        }
      }
      setUseError(text.detail.useInOtidError);
    } catch {
      setUseError(text.detail.useInOtidError);
    } finally {
      setUsing(false);
    }
  }

  if (loading) {
    return (
      <section className={styles.detailCard} aria-live="polite" data-testid="map-bank-detail-loading">
        <p>{text.detail.loading}</p>
      </section>
    );
  }

  if (error || !listing) {
    return (
      <section className={styles.detailCard} data-testid="map-bank-detail-error">
        <Notice tone="error" role="alert">{error ?? text.detail.loadError}</Notice>
        <div>
          <Button variant="secondary" onClick={onClose}>{text.backToList}</Button>
        </div>
      </section>
    );
  }

  const municipalities = listing.municipalityCodes
    .map(code => municipalityByCode(code)?.name ?? code)
    .join(", ");

  const canUse = listing.accessMode === "USE_IN_OTID_LOCKED" || listing.accessMode === "OPEN_DOWNLOAD";
  const canDownload = listing.accessMode === "OPEN_DOWNLOAD";
  const isInfoOnly = listing.accessMode === "INFO_ONLY";

  return (
    <article className={styles.detailCard} aria-labelledby="map-bank-detail-title" data-testid="map-bank-detail">
      <div className={styles.detailHeader}>
        <div className={styles.detailTitleGroup}>
          <span className={styles.badge} data-mode={listing.accessMode}>
            {text.accessModes[listing.accessMode]}
          </span>
          <h2 id="map-bank-detail-title">{listing.title}</h2>
        </div>
        <Button variant="secondary" onClick={onClose} aria-label={text.detail.close}>
          {text.detail.close}
        </Button>
      </div>

      {listing.showPreview && listing.hasPreview && (
        <div className={styles.previewWrap} data-testid="map-bank-preview">
          <img
            src={`/api/public/map-bank/${encodeURIComponent(listing.id)}/preview${listing.previewSha ? `?v=${encodeURIComponent(listing.previewSha)}` : ""}`}
            alt={text.detail.previewAlt(listing.title)}
            className={styles.previewImage}
            loading="lazy"
          />
        </div>
      )}

      {listing.description && <p className={styles.description}>{listing.description}</p>}

      <p className={styles.cardMeta}>{text.accessModeDescriptions[listing.accessMode]}</p>

      <dl className={styles.facts}>
        {listing.clubName && (
          <>
            <dt>{text.detail.club}</dt>
            <dd>{listing.clubName}</dd>
          </>
        )}
        {listing.maker && (
          <>
            <dt>{text.detail.maker}</dt>
            <dd>{listing.maker}</dd>
          </>
        )}
        {municipalities && (
          <>
            <dt>{text.detail.municipalities}</dt>
            <dd>{municipalities}</dd>
          </>
        )}
        {listing.scale && (
          <>
            <dt>{text.detail.scale}</dt>
            <dd>{formatScale(listing.scale)}</dd>
          </>
        )}
        <dt>{text.detail.norm}</dt>
        <dd>{text.norms[listing.norm]}</dd>
        {listing.mapYear && (
          <>
            <dt>{text.detail.year}</dt>
            <dd>{listing.mapYear}</dd>
          </>
        )}
        <dt>{text.detail.format}</dt>
        <dd>.{listing.format.toLowerCase()}</dd>
        {listing.licenseNote && (
          <>
            <dt>{text.detail.license}</dt>
            <dd>{listing.licenseNote}</dd>
          </>
        )}
        {listing.contact && (
          <>
            <dt>{text.detail.contact}</dt>
            <dd>{listing.contact}</dd>
          </>
        )}
      </dl>

      {isInfoOnly && (
        <div className={styles.infoBox} data-testid="map-bank-info-only">
          <strong>{text.detail.infoOnlyTitle}</strong>
          <p>{text.detail.infoOnlyBody}</p>
          <p>{listing.contact || text.detail.noContact}</p>
        </div>
      )}

      {signedOutHint && (
        <Notice tone="attention" role="status">
          <p>{text.detail.useInOtidSignedOut}</p>
          <p>
            <Link href="/organizer">{text.detail.signInLink}</Link>
          </p>
        </Notice>
      )}

      {useError && <Notice tone="error" role="alert">{useError}</Notice>}

      <div className={styles.actions}>
        {canUse && (
          <Button disabled={using} onClick={() => void handleUseInOtid()} data-testid="map-bank-use-button">
            {using ? text.detail.useInOtidBusy : text.detail.useInOtid}
          </Button>
        )}
        {canDownload && (
          <a
            href={`/api/public/map-bank/${encodeURIComponent(listing.id)}/download`}
            download
            className={styles.actionLink}
            data-testid="map-bank-download-link"
          >
            {text.detail.downloadMap(listing.format)}
          </a>
        )}
      </div>
    </article>
  );
}
