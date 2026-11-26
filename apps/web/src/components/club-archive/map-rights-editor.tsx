"use client";

import { useState, type FormEvent } from "react";
import type { ClubMapView, MapAgreement, MapUsageScope, SourceDownloadPolicy } from "@o-tid/contracts";
import { clubArchiveChecksSv } from "../../i18n/club-archive-checks-sv";
import { clubArchiveChecksEn } from "../../i18n/club-archive-more-en";
import { mapBankEn } from "../../i18n/map-bank-en";
import { mapBankSv } from "../../i18n/map-bank-sv";
import { clubBase, clubRequest } from "../../lib/club-archive-client";
import { useTexts } from "../language-provider";
import { MapSharingPanel, type CatalogStatusResponse } from "../map-bank/map-sharing-panel";
import sharingStyles from "../map-bank/map-sharing-panel.module.css";
import { MapAgreementFields } from "../training-group/map-agreement";
import { Button, Notice, Select } from "../ui";
import { useClubFailure } from "./use-club-failure";
import styles from "./archive-checks.module.css";

export function ClubMapPolicyBadges({
  map,
  publishedInCatalog
}: {
  map: Pick<ClubMapView, "sourceDownloadPolicy" | "usageScope" | "publishedInCatalog">;
  publishedInCatalog?: boolean | undefined;
}) {
  const mapBankText = useTexts(mapBankSv, mapBankEn);
  const downloadLocked = map.sourceDownloadPolicy === "CUSTODIANS_ONLY";
  const catalogPublished = publishedInCatalog ?? map.publishedInCatalog;
  const hasAny = downloadLocked
    || map.usageScope === "CLUB_ACTIVITIES_ONLY"
    || map.usageScope === "ADMIN_ONLY"
    || typeof catalogPublished === "boolean";
  if (!hasAny) return null;
  return (
    <div className={sharingStyles.policyBadges} data-testid="club-map-policy-badges">
      {downloadLocked && (
        <span className={sharingStyles.policyBadge} data-tone="locked" data-testid="badge-download-locked">
          {mapBankText.badges.downloadLocked}
        </span>
      )}
      {map.usageScope === "CLUB_ACTIVITIES_ONLY" && (
        <span className={sharingStyles.policyBadge} data-testid="badge-usage-club">
          {mapBankText.badges.clubActivitiesOnly}
        </span>
      )}
      {map.usageScope === "ADMIN_ONLY" && (
        <span className={sharingStyles.policyBadge} data-tone="locked" data-testid="badge-usage-admin">
          {mapBankText.badges.adminOnly}
        </span>
      )}
      {catalogPublished === true && (
        <span className={sharingStyles.policyBadge} data-tone="public" data-testid="badge-catalog-published">
          {mapBankText.badges.publishedInCatalog}
        </span>
      )}
      {catalogPublished === false && (
        <span className={sharingStyles.policyBadge} data-tone="muted" data-testid="badge-catalog-unpublished">
          {mapBankText.badges.notPublishedInCatalog}
        </span>
      )}
    </div>
  );
}

/**
 * Enad panel för "Rättigheter, skydd & delning" på klubbkartor (i Kartor-fliken och på arkivpostens sida).
 * Samlar tre block i ett tydligt flöde:
 * 1. Vem får ladda ner & använda kartfilen (`sourceDownloadPolicy` + `usageScope`)
 * 2. Ägare & avtal (`MapAgreementFields`)
 * 3. Publik kartbank (`/kartbank`) via `MapSharingPanel`
 */
export function MapRightsEditor({
  clubId,
  map,
  onSaved,
  onCatalogStatusChange,
  defaultOpen = false,
  initialCatalog
}: {
  clubId: string;
  map: ClubMapView;
  onSaved: () => Promise<void> | void;
  onCatalogStatusChange?: ((published: boolean) => void) | undefined;
  defaultOpen?: boolean | undefined;
  initialCatalog?: CatalogStatusResponse | undefined;
}) {
  const failure = useClubFailure();
  const text = useTexts(clubArchiveChecksSv.rights, clubArchiveChecksEn.rights);
  const mapBankText = useTexts(mapBankSv, mapBankEn);
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState<MapAgreement>(() => agreementOf(map));
  const [downloadPolicy, setDownloadPolicy] = useState<SourceDownloadPolicy>(map.sourceDownloadPolicy ?? "ALLOWED");
  const [usageScope, setUsageScope] = useState<MapUsageScope>(map.usageScope ?? "ANY");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();

  function toggleOpen() {
    if (!open) {
      setValue(agreementOf(map));
      setDownloadPolicy(map.sourceDownloadPolicy ?? "ALLOWED");
      setUsageScope(map.usageScope ?? "ANY");
      setMessage(undefined);
    }
    setOpen(current => !current);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await clubRequest(`${clubBase(clubId)}/maps/${encodeURIComponent(map.mapId)}`, "PUT", {
        formatVersion: 1,
        name: map.name,
        agreement: value,
        sourceDownloadPolicy: downloadPolicy,
        usageScope
      });
      if (result.status !== 200) {
        setMessage({ tone: "error", text: failure(result.status) });
        return;
      }
      setMessage({ tone: "ok", text: text.saved });
      setOpen(false);
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.rights}>
      <div className={styles.buttons}>
        <Button
          variant="secondary"
          aria-expanded={open}
          aria-label={`${text.edit}: ${map.name}`}
          data-testid="map-rights-toggle"
          onClick={toggleOpen}
        >
          {open ? mapBankText.sharing.closePanel : text.edit}
        </Button>
      </div>

      {open && (
        <div className={sharingStyles.panel} data-testid="map-rights-panel">
          <p className={sharingStyles.panelHeading}>{mapBankText.sharing.clubPanelTitle}</p>
          <form className={styles.rights} onSubmit={event => void save(event)} aria-label={text.title(map.name)}>
            <div className={`${sharingStyles.section} ${sharingStyles.form}`} data-testid="club-map-protection-section">
              <h4>{mapBankText.sharing.whoCanUseHeading}</h4>
              <Select
                label={mapBankText.sharing.downloadPolicyLabel}
                value={downloadPolicy}
                disabled={busy}
                onChange={event => setDownloadPolicy(event.target.value as SourceDownloadPolicy)}
              >
                <option value="ALLOWED">{mapBankText.sharing.downloadPolicyAllowed}</option>
                <option value="CUSTODIANS_ONLY">{mapBankText.sharing.downloadPolicyLocked}</option>
              </Select>
              <Select
                label={mapBankText.sharing.usageScopeLabel}
                value={usageScope}
                disabled={busy}
                onChange={event => setUsageScope(event.target.value as MapUsageScope)}
              >
                <option value="ANY">{mapBankText.sharing.usageScopeAny}</option>
                <option value="CLUB_ACTIVITIES_ONLY">{mapBankText.sharing.usageScopeClubOnly}</option>
                <option value="ADMIN_ONLY">{mapBankText.sharing.usageScopeAdminOnly}</option>
              </Select>
            </div>

            <div className={sharingStyles.section} data-testid="club-map-agreement-section">
              <h4>{mapBankText.sharing.ownerAndAgreementHeading}</h4>
              <p className={styles.why}>{text.help}</p>
              <MapAgreementFields value={value} onChange={setValue} disabled={busy} />
            </div>

            <div className={styles.buttons}>
              <Button type="submit" disabled={busy}>{text.save}</Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>{text.cancel}</Button>
            </div>
          </form>

          <MapSharingPanel
            kind="club-map"
            clubId={clubId}
            map={map}
            onSaved={onSaved}
            hideProtection
            catalogHeadingOverride={mapBankText.sharing.catalogBlockHeading}
            onCatalogStatusChange={onCatalogStatusChange}
            initialCatalog={initialCatalog}
          />
        </div>
      )}

      {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
    </div>
  );
}

function agreementOf(map: MapAgreement): MapAgreement {
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
