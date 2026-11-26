"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { MapProjectView, SourceDownloadPolicy } from "@o-tid/contracts";
import { mapBankEn } from "../../i18n/map-bank-en";
import { mapBankSv } from "../../i18n/map-bank-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { useTexts } from "../language-provider";
import { MapSharingPanel, type CatalogStatusResponse } from "../map-bank/map-sharing-panel";
import sharingStyles from "../map-bank/map-sharing-panel.module.css";
import { Button, Notice, Select } from "../ui";

type Run = (action: () => Promise<{ status: number; json: unknown }>, ok: string, conflict?: string) => Promise<unknown>;

/** Statusbrickor för kartprojektets nedladdningsspärr och publicering i Kartbanken. */
export function MapProjectPolicyBadges({
  project,
  publishedInCatalog
}: {
  project: Pick<MapProjectView, "effectiveSourceDownloadPolicy" | "publishedInCatalog">;
  publishedInCatalog?: boolean | undefined;
}) {
  const mapBankText = useTexts(mapBankSv, mapBankEn);
  const downloadLocked = project.effectiveSourceDownloadPolicy === "CUSTODIANS_ONLY";
  const catalogPublished = publishedInCatalog ?? project.publishedInCatalog;
  if (!downloadLocked && typeof catalogPublished !== "boolean") return null;
  return (
    <div className={sharingStyles.policyBadges} data-testid="map-project-policy-badges">
      {downloadLocked && (
        <span className={sharingStyles.policyBadge} data-tone="locked" data-testid="map-project-download-locked-badge">
          {mapBankText.badges.downloadLocked}
        </span>
      )}
      {catalogPublished === true && (
        <span className={sharingStyles.policyBadge} data-tone="public" data-testid="map-project-catalog-published">
          {mapBankText.badges.publishedInCatalog}
        </span>
      )}
      {catalogPublished === false && (
        <span className={sharingStyles.policyBadge} data-tone="muted" data-testid="map-project-catalog-unpublished">
          {mapBankText.badges.notPublishedInCatalog}
        </span>
      )}
    </div>
  );
}

/**
 * Synlig toppsektion för "Delning & skydd" på kartprojektets sida (direkt efter Exportera).
 * Samlar projektets nedladdningsspärr (redigerbar för ägare/klubbadmin; förklaring om ärvd från klubbarkiv)
 * samt delning i publika kartbanken (`/kartbank`).
 */
export function MapProjectSharingSection({
  project,
  base,
  busy,
  run,
  onSaved,
  onCatalogStatusChange,
  initialCatalog
}: {
  project: MapProjectView;
  base: string;
  busy: boolean;
  run: Run;
  onSaved: () => Promise<void>;
  onCatalogStatusChange?: ((published: boolean) => void) | undefined;
  initialCatalog?: CatalogStatusResponse | undefined;
}) {
  const mapBankText = useTexts(mapBankSv, mapBankEn);
  const text = mapBankText.projectProtection;
  const manage = project.viewer.canManage;
  const inherited = project.sourceDownloadLockedByArchive;
  const effectiveLocked = project.effectiveSourceDownloadPolicy === "CUSTODIANS_ONLY";
  const [policy, setPolicy] = useState<SourceDownloadPolicy>(project.sourceDownloadPolicy);

  useEffect(() => {
    setPolicy(project.sourceDownloadPolicy);
  }, [project.sourceDownloadPolicy]);

  const shownPolicy: SourceDownloadPolicy = inherited ? "CUSTODIANS_ONLY" : policy;

  function savePolicy(event: FormEvent) {
    event.preventDefault();
    if (!manage || inherited) return;
    void run(
      () => clubRequest(base, "PUT", { formatVersion: 1, sourceDownloadPolicy: policy }),
      mapBankText.sharing.saved
    );
  }

  return (
    <section aria-labelledby="map-project-sharing" id="delning-skydd" data-testid="map-project-sharing-section">
      <h2 id="map-project-sharing">{mapBankText.sharing.projectPanelTitle}</h2>
      <div className={sharingStyles.panel}>
        {manage ? (
          <>
            <form
              className={`${sharingStyles.section} ${sharingStyles.form}`}
              onSubmit={savePolicy}
              data-testid="map-project-protection-form"
            >
              <h4>{text.heading}</h4>
              <p className={sharingStyles.help}>{text.help}</p>
              {inherited && (
                <Notice tone="attention" role="status">
                  <span data-testid="map-project-archive-lock-note">{text.inheritedFromArchive}</span>
                </Notice>
              )}
              <Select
                label={mapBankText.sharing.downloadPolicyLabel}
                value={shownPolicy}
                disabled={busy || inherited}
                data-testid="map-project-download-policy-select"
                onChange={event => setPolicy(event.target.value as SourceDownloadPolicy)}
              >
                <option value="ALLOWED">{text.policyAllowed}</option>
                <option value="CUSTODIANS_ONLY">{text.policyLocked}</option>
              </Select>
              <div className={sharingStyles.actions}>
                <Button
                  type="submit"
                  disabled={busy || inherited || policy === project.sourceDownloadPolicy}
                  data-testid="map-project-save-protection"
                >
                  {mapBankText.sharing.saveProtection}
                </Button>
              </div>
            </form>

            <MapSharingPanel
              kind="map-project"
              projectId={project.projectId}
              projectName={project.name}
              onSaved={onSaved}
              hideProtection
              onCatalogStatusChange={onCatalogStatusChange}
              initialCatalog={initialCatalog}
            />
          </>
        ) : (
          <div className={sharingStyles.section} data-testid="map-project-protection-readonly">
            <h4>{text.heading}</h4>
            <p className={sharingStyles.help}>
              {effectiveLocked ? text.readOnlyLocked : text.readOnlyAllowed}
            </p>
            {inherited && (
              <p className={sharingStyles.help} data-testid="map-project-archive-lock-note">
                {text.inheritedFromArchive}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
