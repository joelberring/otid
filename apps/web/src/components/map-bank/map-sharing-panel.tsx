"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type {
  ClubMapView,
  MapAgreement,
  MapUsageScope,
  PublicMapAccessMode,
  PublicMapListingDetail,
  PublicMapNorm,
  SourceDownloadPolicy
} from "@o-tid/contracts";
import { mapBankEn } from "../../i18n/map-bank-en";
import { mapBankSv } from "../../i18n/map-bank-sv";
import { clubBase, clubRequest } from "../../lib/club-archive-client";
import { mapProjectBase } from "../../lib/map-project-client";
import { useTexts } from "../language-provider";
import { Button, Field, Notice, Select } from "../ui";
import { MunicipalityPicker } from "./municipality-picker";
import styles from "./map-sharing-panel.module.css";

interface SuggestedCatalogMeta {
  readonly title?: string;
  readonly description?: string;
  readonly clubName?: string;
  readonly maker?: string;
  readonly scale?: number | null;
  readonly norm?: PublicMapNorm;
  readonly mapYear?: number | null;
  readonly municipalityCodes?: readonly string[];
  readonly countyCodes?: readonly string[];
  readonly latestVersionId?: string | null;
}

interface CatalogStatusResponse {
  readonly formatVersion: 1;
  readonly listing: PublicMapListingDetail | null;
  readonly suggested: SuggestedCatalogMeta;
}

export type MapSharingPanelProps =
  | {
      readonly kind: "club-map";
      readonly clubId: string;
      readonly map: ClubMapView;
      readonly onSaved?: () => Promise<void> | void;
      readonly initialCatalog?: CatalogStatusResponse;
    }
  | {
      readonly kind: "map-project";
      readonly projectId: string;
      readonly projectName: string;
      readonly onSaved?: () => Promise<void> | void;
      readonly initialCatalog?: CatalogStatusResponse;
    };

function agreementOf(map: ClubMapView): MapAgreement {
  return {
    ownership: map.ownership,
    ownerKind: map.ownerKind,
    ownerName: map.ownerName,
    agreement: map.agreement,
    validUntil: map.validUntil,
    contact: map.contact,
    trainingOnly: map.trainingOnly,
    feePerPrint: map.feePerPrint,
    noPublicDisplay: map.noPublicDisplay
  };
}

/**
 * Återanvändbar ägarpanel för "Delning & skydd":
 * - För klubbkartor: nedladdningsspärr, användningsbegränsning och publicering i publika kartbanken (`/kartbank`).
 * - För kartprojekt: publicering i publika kartbanken (`/kartbank`).
 */
export function MapSharingPanel(props: MapSharingPanelProps) {
  const allText = useTexts(mapBankSv, mapBankEn);
  const text = allText.sharing;
  const catalogPath = props.kind === "club-map"
    ? `${clubBase(props.clubId)}/maps/${encodeURIComponent(props.map.mapId)}/catalog`
    : `${mapProjectBase(props.projectId)}/catalog`;

  // Skydd (endast klubbkarta)
  const [downloadPolicy, setDownloadPolicy] = useState<SourceDownloadPolicy>(
    props.kind === "club-map" ? (props.map.sourceDownloadPolicy ?? "ALLOWED") : "ALLOWED"
  );
  const [usageScope, setUsageScope] = useState<MapUsageScope>(
    props.kind === "club-map" ? (props.map.usageScope ?? "ANY") : "ANY"
  );
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Publik kartbank
  const [loading, setLoading] = useState(props.initialCatalog === undefined);
  const [loadError, setLoadError] = useState<string>();
  const [listingId, setListingId] = useState<string | null>(props.initialCatalog?.listing?.id ?? null);
  const [published, setPublished] = useState(Boolean(props.initialCatalog?.listing));
  const [accessMode, setAccessMode] = useState<PublicMapAccessMode>(props.initialCatalog?.listing?.accessMode ?? "INFO_ONLY");
  const [showPreview, setShowPreview] = useState(props.initialCatalog?.listing?.showPreview ?? false);
  const [municipalityCodes, setMunicipalityCodes] = useState<string[]>(
    [...(props.initialCatalog?.listing?.municipalityCodes ?? props.initialCatalog?.suggested.municipalityCodes ?? [])]
  );
  const [title, setTitle] = useState(
    props.initialCatalog?.listing?.title ?? props.initialCatalog?.suggested.title ?? (props.kind === "club-map" ? props.map.name : props.projectName)
  );
  const [description, setDescription] = useState(
    props.initialCatalog?.listing?.description ?? props.initialCatalog?.suggested.description ?? ""
  );
  const [clubName, setClubName] = useState(
    props.initialCatalog?.listing?.clubName ?? props.initialCatalog?.suggested.clubName ?? ""
  );
  const [maker, setMaker] = useState(
    props.initialCatalog?.listing?.maker ?? props.initialCatalog?.suggested.maker ?? ""
  );
  const [scale, setScale] = useState<string>(
    props.initialCatalog?.listing?.scale
      ? String(props.initialCatalog.listing.scale)
      : props.initialCatalog?.suggested.scale
        ? String(props.initialCatalog.suggested.scale)
        : ""
  );
  const [norm, setNorm] = useState<PublicMapNorm>(
    props.initialCatalog?.listing?.norm ?? props.initialCatalog?.suggested.norm ?? "OTHER"
  );
  const [mapYear, setMapYear] = useState<string>(
    props.initialCatalog?.listing?.mapYear
      ? String(props.initialCatalog.listing.mapYear)
      : props.initialCatalog?.suggested.mapYear
        ? String(props.initialCatalog.suggested.mapYear)
        : ""
  );
  const [licenseNote, setLicenseNote] = useState(props.initialCatalog?.listing?.licenseNote ?? "");
  const [contact, setContact] = useState(props.initialCatalog?.listing?.contact ?? "");
  const [savingCatalog, setSavingCatalog] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();

  useEffect(() => {
    if (props.initialCatalog !== undefined) return;
    let active = true;
    setLoading(true);
    setLoadError(undefined);
    void clubRequest(catalogPath, "GET").then(result => {
      if (!active) return;
      if (result.status !== 200) {
        setLoadError(text.loadError);
        setLoading(false);
        return;
      }
      const data = result.json as CatalogStatusResponse;
      const src = data.listing;
      const sug = data.suggested ?? {};
      setListingId(src?.id ?? null);
      setPublished(Boolean(src));
      setAccessMode(src?.accessMode ?? "INFO_ONLY");
      setShowPreview(src?.showPreview ?? false);
      setMunicipalityCodes([...(src?.municipalityCodes ?? sug.municipalityCodes ?? [])]);
      setTitle(src?.title ?? sug.title ?? (props.kind === "club-map" ? props.map.name : props.projectName));
      setDescription(src?.description ?? sug.description ?? "");
      setClubName(src?.clubName ?? sug.clubName ?? "");
      setMaker(src?.maker ?? sug.maker ?? "");
      const resolvedScale = src?.scale ?? sug.scale;
      setScale(resolvedScale ? String(resolvedScale) : "");
      setNorm(src?.norm ?? sug.norm ?? "OTHER");
      const resolvedYear = src?.mapYear ?? sug.mapYear;
      setMapYear(resolvedYear ? String(resolvedYear) : "");
      setLicenseNote(src?.licenseNote ?? "");
      setContact(src?.contact ?? "");
      setLoading(false);
    });
    return () => { active = false; };
  }, [catalogPath, props.initialCatalog, props.kind, text.loadError]);

  async function saveProtection(event: FormEvent) {
    event.preventDefault();
    if (props.kind !== "club-map") return;
    setSavingPolicy(true);
    setMessage(undefined);
    try {
      const result = await clubRequest(`${clubBase(props.clubId)}/maps/${encodeURIComponent(props.map.mapId)}`, "PUT", {
        formatVersion: 1,
        name: props.map.name,
        agreement: agreementOf(props.map),
        sourceDownloadPolicy: downloadPolicy,
        usageScope
      });
      if (result.status >= 200 && result.status < 300) {
        setMessage({ tone: "ok", text: text.saved });
        await props.onSaved?.();
      } else {
        setMessage({ tone: "error", text: text.saveError });
      }
    } finally {
      setSavingPolicy(false);
    }
  }

  async function saveCatalog(event: FormEvent) {
    event.preventDefault();
    setSavingCatalog(true);
    setMessage(undefined);
    try {
      if (!published) {
        if (!listingId) return;
        const result = await clubRequest(catalogPath, "DELETE");
        if (result.status >= 200 && result.status < 300) {
          setListingId(null);
          setMessage({ tone: "ok", text: text.unpublished });
          await props.onSaved?.();
        } else {
          setMessage({ tone: "error", text: text.saveError });
        }
        return;
      }
      const parsedScale = scale.trim() ? Number.parseInt(scale.trim(), 10) : null;
      const parsedYear = mapYear.trim() ? Number.parseInt(mapYear.trim(), 10) : null;
      const result = await clubRequest(catalogPath, "PUT", {
        formatVersion: 1,
        title: title.trim(),
        description: description.trim(),
        clubName: clubName.trim(),
        maker: maker.trim(),
        scale: Number.isFinite(parsedScale) ? parsedScale : null,
        norm,
        mapYear: Number.isFinite(parsedYear) ? parsedYear : null,
        licenseNote: licenseNote.trim(),
        contact: contact.trim(),
        accessMode,
        showPreview,
        municipalityCodes
      });
      if (result.status >= 200 && result.status < 300) {
        const saved = (result.json as { listing?: PublicMapListingDetail } | undefined)?.listing;
        setListingId(saved?.id ?? listingId);
        setMessage({ tone: "ok", text: text.published });
        await props.onSaved?.();
      } else {
        setMessage({ tone: "error", text: text.saveError });
      }
    } finally {
      setSavingCatalog(false);
    }
  }

  async function unpublish() {
    setSavingCatalog(true);
    setMessage(undefined);
    try {
      const result = await clubRequest(catalogPath, "DELETE");
      if (result.status >= 200 && result.status < 300) {
        setListingId(null);
        setPublished(false);
        setMessage({ tone: "ok", text: text.unpublished });
        await props.onSaved?.();
      } else {
        setMessage({ tone: "error", text: text.saveError });
      }
    } finally {
      setSavingCatalog(false);
    }
  }

  const fieldPrefix = props.kind === "club-map" ? `club-map-${props.map.mapId}` : `map-project-${props.projectId}`;

  return (
    <div className={styles.panel} data-testid="map-sharing-panel">
      {message && (
        <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>
          {message.text}
        </Notice>
      )}

      {props.kind === "club-map" && (
        <form className={`${styles.section} ${styles.form}`} onSubmit={event => void saveProtection(event)} data-testid="club-map-protection-form">
          <h4>{text.protectionHeading}</h4>
          <Select
            label={text.downloadPolicyLabel}
            value={downloadPolicy}
            disabled={savingPolicy}
            onChange={event => setDownloadPolicy(event.target.value as SourceDownloadPolicy)}
          >
            <option value="ALLOWED">{text.downloadPolicyAllowed}</option>
            <option value="CUSTODIANS_ONLY">{text.downloadPolicyLocked}</option>
          </Select>
          <Select
            label={text.usageScopeLabel}
            value={usageScope}
            disabled={savingPolicy}
            onChange={event => setUsageScope(event.target.value as MapUsageScope)}
          >
            <option value="ANY">{text.usageScopeAny}</option>
            <option value="CLUB_ACTIVITIES_ONLY">{text.usageScopeClubOnly}</option>
            <option value="ADMIN_ONLY">{text.usageScopeAdminOnly}</option>
          </Select>
          <div className={styles.actions}>
            <Button type="submit" disabled={savingPolicy}>{text.saveProtection}</Button>
          </div>
        </form>
      )}

      <section className={styles.section} data-testid="public-catalog-form-section">
        <h4>{text.catalogHeading}</h4>
        <p className={styles.help}>{text.catalogHelp}</p>

        {loading && <p className={styles.help} aria-live="polite">{text.loading}</p>}
        {loadError && <Notice tone="error" role="alert">{loadError}</Notice>}

        {!loading && !loadError && (
          <form className={styles.form} onSubmit={event => void saveCatalog(event)}>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={published}
                disabled={savingCatalog}
                onChange={event => setPublished(event.target.checked)}
              />
              <span>{text.publishToggle}</span>
            </label>

            {published && (
              <>
                <Select
                  label={text.accessModeLabel}
                  value={accessMode}
                  disabled={savingCatalog}
                  onChange={event => setAccessMode(event.target.value as PublicMapAccessMode)}
                >
                  <option value="INFO_ONLY">{text.accessModeOptions.INFO_ONLY}</option>
                  <option value="USE_IN_OTID_LOCKED">{text.accessModeOptions.USE_IN_OTID_LOCKED}</option>
                  <option value="OPEN_DOWNLOAD">{text.accessModeOptions.OPEN_DOWNLOAD}</option>
                </Select>

                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={showPreview}
                    disabled={savingCatalog}
                    onChange={event => setShowPreview(event.target.checked)}
                  />
                  <span>{text.showPreviewLabel}</span>
                </label>
                <p className={styles.warningNote} data-testid="preview-embargo-note">{text.showPreviewWarning}</p>

                <MunicipalityPicker
                  id={`${fieldPrefix}-municipalities`}
                  value={municipalityCodes}
                  onChange={setMunicipalityCodes}
                  disabled={savingCatalog}
                />

                <Field label={text.titleLabel}>
                  <input
                    value={title}
                    maxLength={200}
                    required
                    disabled={savingCatalog}
                    onChange={event => setTitle(event.target.value)}
                  />
                </Field>

                <div className={styles.row}>
                  <Field label={text.clubNameLabel}>
                    <input value={clubName} maxLength={120} disabled={savingCatalog} onChange={event => setClubName(event.target.value)} />
                  </Field>
                  <Field label={text.makerLabel}>
                    <input value={maker} maxLength={200} disabled={savingCatalog} onChange={event => setMaker(event.target.value)} />
                  </Field>
                </div>

                <div className={styles.row}>
                  <Field label={text.scaleLabel}>
                    <input
                      type="number"
                      min={500}
                      max={100000}
                      value={scale}
                      disabled={savingCatalog}
                      onChange={event => setScale(event.target.value)}
                    />
                  </Field>
                  <Select
                    label={text.normLabel}
                    value={norm}
                    disabled={savingCatalog}
                    onChange={event => setNorm(event.target.value as PublicMapNorm)}
                  >
                    <option value="ISOM">{allText.norms.ISOM}</option>
                    <option value="ISSprOM">{allText.norms.ISSprOM}</option>
                    <option value="OTHER">{allText.norms.OTHER}</option>
                  </Select>
                  <Field label={text.yearLabel}>
                    <input
                      type="number"
                      min={1950}
                      max={2100}
                      value={mapYear}
                      disabled={savingCatalog}
                      onChange={event => setMapYear(event.target.value)}
                    />
                  </Field>
                </div>

                <Field label={text.descriptionLabel}>
                  <textarea value={description} maxLength={4000} rows={3} disabled={savingCatalog} onChange={event => setDescription(event.target.value)} />
                </Field>

                <Field label={text.licenseLabel}>
                  <input value={licenseNote} maxLength={1000} disabled={savingCatalog} onChange={event => setLicenseNote(event.target.value)} />
                </Field>

                <Field label={text.contactLabel}>
                  <input value={contact} maxLength={200} disabled={savingCatalog} onChange={event => setContact(event.target.value)} />
                </Field>
              </>
            )}

            <div className={styles.actions}>
              {published && (
                <Button type="submit" disabled={savingCatalog || !title.trim()}>
                  {text.saveCatalog}
                </Button>
              )}
              {listingId && (
                <>
                  <Button type="button" variant="secondary" disabled={savingCatalog} onClick={() => void unpublish()}>
                    {text.unpublishButton}
                  </Button>
                  <Link href="/kartbank" className={styles.catalogLink}>{text.viewInCatalog}</Link>
                </>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
