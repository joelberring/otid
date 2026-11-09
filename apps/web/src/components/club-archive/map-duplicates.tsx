"use client";

import { useClubFailure } from "./use-club-failure";
import { useEffect, useState } from "react";
import { clubMapDuplicatesEn } from "../../i18n/club-space-en";
import { useTexts } from "../language-provider";
import type { Texts } from "../../lib/language";
import type { ClubMapDuplicateCluster, ClubMapDuplicateReason, ClubMapDuplicatesResponse, ClubMapMergeResponse, ClubMapView } from "@o-tid/contracts";
import { clubMapDuplicatesSv } from "../../i18n/club-map-duplicates-sv";
import { clubBase, clubRequest } from "../../lib/club-archive-client";
import { Button, Notice } from "../ui";
import { MapThumbnail } from "./map-check";
import styles from "./map-duplicates.module.css";

/**
 * ADR-0210 beslut 2: "Möjliga dubbletter (n)" i Kartor-fliken (ägare och administratörer) och samma val för "Slå ihop
 * markerade". Varje grupp visar kartorna sida vid sida med bild, namn, år och yta och varför de föreslås; ägaren väljer vilken
 * karta som behåller namnet och uppgifterna. Inget slås ihop av sig självt.
 */
type Message = { tone: "ok" | "error"; text: string };
type Extent = ClubMapDuplicateCluster["extents"][number];

export function reasonText(reason: ClubMapDuplicateReason, text: Texts<typeof clubMapDuplicatesSv.duplicates>): string {
  if (reason.kind === "AREA") return text.reasons.area(reason.overlap, reason.contained);
  if (reason.kind === "SHARED_TRAININGS") return text.reasons.trainings(reason.count);
  return text.reasons[reason.kind];
}

function extentText(extent: Extent | undefined, text: Texts<typeof clubMapDuplicatesSv.duplicates>): string {
  if (extent?.ground) return text.extent.ground(extent.ground.width, extent.ground.height);
  if (extent?.paper) return text.extent.paper(extent.paper.width, extent.paper.height, extent.paper.scale);
  return text.extent.none;
}

/** Förvalet när inget förslag finns: kartan med flest träningar, sedan nyaste versionen. */
export function defaultKeep(maps: readonly ClubMapView[]): string {
  return [...maps].sort((a, b) => b.trainings - a.trainings || (b.years?.to ?? 0) - (a.years?.to ?? 0) || a.name.localeCompare(b.name, "sv"))[0]!.mapId;
}

/** Kartorna sida vid sida: vilken som behålls, vilka som tas med, och knapparna. */
export function MergeChooser({ clubId, maps, keepDefault, extents, reasons, label, onMerged, onDismissed, onMessage }: {
  clubId: string; maps: readonly ClubMapView[]; keepDefault: string; extents?: readonly Extent[]; reasons?: readonly ClubMapDuplicateReason[];
  label: string; onMerged: () => Promise<void>; onDismissed?: () => Promise<void>; onMessage: (message: Message) => void
}) {
  const failure = useClubFailure();
  const clubMapDuplicatesText = useTexts(clubMapDuplicatesSv, clubMapDuplicatesEn);
  const text = useTexts(clubMapDuplicatesSv.duplicates, clubMapDuplicatesEn.duplicates);
  const [keep, setKeep] = useState(keepDefault);
  const [included, setIncluded] = useState(() => new Set(maps.map(map => map.mapId)));
  const [busy, setBusy] = useState(false);
  const chosen = maps.filter(map => included.has(map.mapId));
  const kept = maps.find(map => map.mapId === keep);

  async function merge() {
    if (!kept || chosen.length < 2) return;
    setBusy(true);
    try {
      const result = await clubRequest(`${clubBase(clubId)}/map-merges`, "POST", { formatVersion: 1, keepMapId: keep, mapIds: chosen.map(map => map.mapId) });
      if (result.status !== 200) { onMessage({ tone: "error", text: failure(result.status) }); return; }
      onMessage({ tone: "ok", text: text.merged(kept.name, (result.json as ClubMapMergeResponse).versionsMoved) });
      await onMerged();
    } finally { setBusy(false); }
  }

  async function dismiss() {
    setBusy(true);
    try {
      const result = await clubRequest(`${clubBase(clubId)}/map-duplicates/dismiss`, "POST", { formatVersion: 1, mapIds: maps.map(map => map.mapId) });
      if (result.status !== 200) { onMessage({ tone: "error", text: failure(result.status) }); return; }
      onMessage({ tone: "ok", text: text.dismissed });
      await onDismissed?.();
    } finally { setBusy(false); }
  }

  return <fieldset className={styles.chooser} aria-label={label} disabled={busy}>
    <legend className={styles.legend}>{text.keep}</legend>
    <ul className={styles.maps}>
      {maps.map(map => {
        const latest = map.versions.find(version => version.versionId === map.latestVersionId);
        return <li key={map.mapId} className={styles.map} data-testid="duplicate-map" data-kept={map.mapId === keep || undefined}>
          <MapThumbnail clubId={clubId} version={latest} name={map.name} />
          <label className={styles.keep}>
            <input type="radio" name={`keep-${label}`} checked={map.mapId === keep} disabled={!included.has(map.mapId)}
              onChange={() => setKeep(map.mapId)} />
            <strong>{map.name}</strong>
          </label>
          <span className={styles.meta}>{clubMapDuplicatesText.versions.summary(map.versions.length, map.years)}</span>
          <span className={styles.meta}>{map.versions.map(version => version.fileName).join(", ")}</span>
          {extents && <span className={styles.meta}>{extentText(extents.find(extent => extent.mapId === map.mapId), text)}</span>}
          {maps.length > 2 && <label className={styles.include}>
            <input type="checkbox" checked={included.has(map.mapId)} onChange={event => {
              const next = new Set(included);
              if (event.target.checked) next.add(map.mapId); else next.delete(map.mapId);
              setIncluded(next);
              if (!event.target.checked && map.mapId === keep) setKeep(maps.find(other => next.has(other.mapId))?.mapId ?? keep);
            }} />{text.include(map.name)}</label>}
        </li>;
      })}
    </ul>
    {reasons && reasons.length > 0 && <ul className={styles.reasons} data-testid="duplicate-reasons">
      {reasons.map(reason => <li key={reason.kind}>{reasonText(reason, text)}</li>)}</ul>}
    <p className={styles.help}>{text.mergeHelp}</p>
    <div className={styles.buttons}>
      <Button onClick={() => void merge()} disabled={busy || chosen.length < 2 || !included.has(keep)}>{text.merge}</Button>
      {onDismissed && <Button variant="secondary" onClick={() => void dismiss()} disabled={busy}>{text.notSame}</Button>}
    </div>
  </fieldset>;
}

/** "Möjliga dubbletter (n)": förslagen hämtas när kartorna ändras. */
export function DuplicatesCard({ clubId, maps, onChanged, onMessage }: { clubId: string; maps: readonly ClubMapView[]; onChanged: () => Promise<void>;
  onMessage: (message: Message) => void }) {
  const text = useTexts(clubMapDuplicatesSv.duplicates, clubMapDuplicatesEn.duplicates);
  const [clusters, setClusters] = useState<ClubMapDuplicateCluster[]>();
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const signature = maps.map(map => `${map.mapId}:${map.versions.length}:${map.versions.filter(version => version.check?.fingerprint).length}`).join(",");
  useEffect(() => {
    let active = true;
    void clubRequest(`${clubBase(clubId)}/map-duplicates`).then(result => {
      if (!active) return;
      if (result.status !== 200) { setFailed(true); return; }
      setFailed(false);
      setClusters((result.json as ClubMapDuplicatesResponse).clusters);
    });
    return () => { active = false; };
  }, [clubId, signature, revision]);
  if (failed) return <Notice tone="error" role="alert">{text.loadFailed}</Notice>;
  const shown = (clusters ?? []).map(cluster => ({ cluster, maps: cluster.mapIds.flatMap(id => maps.filter(map => map.mapId === id)) }))
    .filter(item => item.maps.length >= 2);
  if (shown.length === 0) return null;
  return <section className={styles.card} aria-labelledby="map-duplicates" data-testid="map-duplicates">
    <h3 id="map-duplicates">{text.heading(shown.length)}</h3>
    <p className={styles.help}>{text.help}</p>
    {shown.map(({ cluster, maps: members }) => <article key={cluster.mapIds.join()} className={styles.cluster} data-testid="duplicate-cluster"
      data-level={cluster.level}>
      <p className={styles.level}>{text.level[cluster.level]}</p>
      {cluster.unchecked.length > 0 && <p className={styles.help}>{text.unchecked}</p>}
      <MergeChooser clubId={clubId} maps={members} keepDefault={cluster.keepMapId} extents={cluster.extents} reasons={cluster.reasons}
        label={members.map(map => map.name).join(", ")} onMessage={onMessage}
        onMerged={onChanged} onDismissed={async () => { setRevision(value => value + 1); }} />
    </article>)}
  </section>;
}
