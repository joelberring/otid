"use client";

import { useEffect, useMemo, useState } from "react";
import { clubMapDuplicatesEn } from "../../i18n/club-space-en";
import { useTexts } from "../language-provider";
import type { Texts } from "../../lib/language";
import type { UsableClubMap, UsableClubMapsResponse } from "@o-tid/contracts";
import { clubMapDuplicatesSv } from "../../i18n/club-map-duplicates-sv";
import { raceMapSv } from "../../i18n/race-map-sv";
import { raceMapEn } from "../../i18n/workspace-small-en";
import { clubRequest, renderMapVersion, sendRenderedMap } from "../../lib/club-archive-client";
import { Button, Notice } from "../ui";
import { MapThumbnail } from "./map-check";
import styles from "./map-duplicates.module.css";

/**
 * ADR-0210 beslut 7: "Välj karta från klubbarkivet" i stället för att ladda upp kartfilen. Kartorna i kontots klubbar med
 * bild, namn och "5 versioner, 2014–2023"; senaste versionen är förvald. Kartan blir tävlingens kartfil på samma sätt som
 * "Använd igen": versionen ritas i webbläsaren och tävlingen pekar på arkivets innehåll (ADR-0189), bara bilden skickas,
 * och kartans rättigheter följer med. Vem som får använda kartan avgör servern (`mayUseClubMap`).
 */
export type ClubMapChoice = { clubId: string; versionId: string; fileName: string; mapName: string; year: number };
type Stage = keyof typeof clubMapDuplicatesSv.picker.working;

/** Kartversionen ritas och sparas som tävlingens kartfil. Ger felets text, eller undefined när det gick. */
export async function applyClubMap(choice: ClubMapChoice, raceId: string, onStage: (stage: Stage) => void,
  text: Pick<Texts<typeof clubMapDuplicatesSv.picker>, "tooLarge" | "failed"> = clubMapDuplicatesSv.picker,
  mapErrors: Texts<typeof raceMapSv.mapFile.errors> = raceMapSv.mapFile.errors): Promise<string | undefined> {
  onStage("reading");
  const rendered = await renderMapVersion(choice.clubId, choice.versionId, choice.fileName, stage => onStage(stage));
  if (rendered.type === "error") return mapErrors[rendered.code];
  onStage("saving");
  const saved = await sendRenderedMap(choice.clubId, choice.versionId, "race", raceId, rendered);
  if (saved.status === 200) return undefined;
  return (saved.json as { error?: string } | undefined)?.error === "MAP_FILE_TOO_LARGE" ? text.tooLarge : text.failed;
}

function useUsableMaps(raceId?: string) {
  const [maps, setMaps] = useState<UsableClubMap[]>();
  const [plannedMapId, setPlannedMapId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void clubRequest(raceId ? `/api/organizer/club-maps?race=${encodeURIComponent(raceId)}` : "/api/organizer/club-maps").then(result => {
      if (!active) return;
      if (result.status === 200) {
        const response = result.json as UsableClubMapsResponse;
        setMaps(response.maps);
        setPlannedMapId(response.plannedMapId ?? null);
      }
      else { setFailed(result.status !== 401); setMaps([]); }
    }).catch((error: unknown) => { console.error("Klubbarnas kartor kunde inte hämtas", error); if (active) { setFailed(true); setMaps([]); } });
    return () => { active = false; };
  }, [raceId]);
  return { maps, plannedMapId, failed };
}

function PickerItem({ item, multipleClubs, raceType, busy, onUse }: { item: UsableClubMap; multipleClubs: boolean; raceType?: string | undefined;
  busy: boolean; onUse: (choice: ClubMapChoice) => void }) {
  const clubMapDuplicatesText = useTexts(clubMapDuplicatesSv, clubMapDuplicatesEn);
  const text = useTexts(clubMapDuplicatesSv.picker, clubMapDuplicatesEn.picker);
  const { map } = item;
  const [versionId, setVersionId] = useState(map.latestVersionId ?? "");
  const version = map.versions.find(candidate => candidate.versionId === versionId) ?? map.versions[0]!;
  return <li className={styles.pickerItem} data-testid="club-map-choice">
    <MapThumbnail clubId={item.clubId} version={version} name={map.name} />
    <h4>{map.name}</h4>
    {multipleClubs && <span className={styles.meta}>{text.club(item.clubName)}</span>}
    <span className={styles.meta} data-testid="club-map-choice-summary">{clubMapDuplicatesText.versions.summary(map.versions.length, map.years)}</span>
    {item.issues.map(issue => <span key={issue} className={styles.issue}>{text.issues[issue]}</span>)}
    {raceType && raceType !== "TRAINING" && item.issues.includes("TRAINING_ONLY") && <span className={styles.issue}>{text.trainingOnlyRace}</span>}
    {map.versions.length > 1 && <label className={styles.meta}>{text.version}
      <select value={version.versionId} onChange={event => setVersionId(event.target.value)}>
        {map.versions.map(candidate => <option key={candidate.versionId} value={candidate.versionId}>
          {text.versionLabel(candidate.year, candidate.fileName, candidate.versionId === map.latestVersionId)}</option>)}
      </select></label>}
    <Button variant="secondary" disabled={busy} aria-label={text.useMap(map.name)}
      onClick={() => onUse({ clubId: item.clubId, versionId: version.versionId, fileName: version.fileName, mapName: map.name, year: version.year })}>
      {text.use}</Button>
  </li>;
}

/**
 * Listan att välja ur. `onUse` får valet (sparas direkt i en tävling, eller kommer ihåg valet tills tävlingen är skapad).
 * Utan kartor i kontots klubbar visas ingenting.
 */
export function ClubMapPicker({ raceType, busy = false, label, raceId, onUse }: { raceType?: string | undefined; busy?: boolean; label?: string;
  raceId?: string | undefined; onUse: (choice: ClubMapChoice) => void }) {
  const text = useTexts(clubMapDuplicatesSv.picker, clubMapDuplicatesEn.picker);
  const { maps, plannedMapId, failed } = useUsableMaps(raceId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("sv-SE");
    return (maps ?? []).filter(item => !needle || item.map.name.toLocaleLowerCase("sv-SE").includes(needle)
      || item.map.versions.some(version => version.fileName.toLocaleLowerCase("sv-SE").includes(needle)));
  }, [maps, query]);
  if (failed) return <Notice tone="error" role="alert">{text.loadFailed}</Notice>;
  if (!maps || maps.length === 0) return null;
  const multipleClubs = new Set(maps.map(item => item.clubId)).size > 1;
  // ADR-0221: kartan som valdes i klubbens terminsplanering står först, utan att listan behöver öppnas.
  const planned = plannedMapId ? maps.find(item => item.map.mapId === plannedMapId) : undefined;
  return <div className={styles.picker} data-testid="club-map-picker">
    {label && <span className={styles.meta}>{label}</span>}
    {planned && <div data-testid="club-map-planned"><span className={styles.meta}>{text.planned}</span>
      <ul className={styles.pickerList}><PickerItem item={planned} multipleClubs={multipleClubs} raceType={raceType} busy={busy} onUse={onUse} /></ul></div>}
    <div className={styles.buttons}>
      <Button variant="secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? text.close : text.open}</Button>
    </div>
    {open && <>
      <p className={styles.help}>{text.help}</p>
      {maps.length > 6 && <input className={styles.search} type="search" aria-label={text.search} placeholder={text.search} value={query}
        onChange={event => setQuery(event.target.value)} />}
      <ul className={styles.pickerList}>{shown.map(item => <PickerItem key={`${item.clubId}-${item.map.mapId}`} item={item} multipleClubs={multipleClubs}
        raceType={raceType} busy={busy} onUse={choice => { setOpen(false); onUse(choice); }} />)}</ul>
    </>}
  </div>;
}

/** Banläggningens start: välj kartan och spara den direkt i tävlingen. */
export function ClubMapToRace({ raceId, raceType, disabled, onSaved, onMessage }: { raceId: string; raceType?: string | undefined; disabled: boolean;
  onSaved: () => Promise<void>; onMessage: (message: { tone: "ok" | "error"; text: string } | undefined) => void }) {
  const raceMapText = useTexts(raceMapSv, raceMapEn);
  const text = useTexts(clubMapDuplicatesSv.picker, clubMapDuplicatesEn.picker);
  const [stage, setStage] = useState<Stage>();
  async function use(choice: ClubMapChoice) {
    onMessage(undefined);
    try {
      const problem = await applyClubMap(choice, raceId, setStage, text, raceMapText.mapFile.errors);
      if (problem) { onMessage({ tone: "error", text: problem }); return; }
      onMessage({ tone: "ok", text: text.saved(choice.mapName) });
      await onSaved();
    } catch (error) {
      console.error("Klubbens karta kunde inte bli tävlingens", error);
      onMessage({ tone: "error", text: text.failed });
    } finally { setStage(undefined); }
  }
  return <>
    <ClubMapPicker raceType={raceType} raceId={raceId} busy={disabled || stage !== undefined} onUse={choice => void use(choice)} />
    {stage && <p role="status">{text.working[stage]}</p>}
  </>;
}

/** Ny tävling: kartan väljs i formuläret och sparas när tävlingen är skapad (`applyClubMap`). */
export function ClubMapChoiceField({ value, disabled, onChange }: { value: ClubMapChoice | undefined; disabled: boolean;
  onChange: (choice: ClubMapChoice | undefined) => void }) {
  const text = useTexts(clubMapDuplicatesSv.picker, clubMapDuplicatesEn.picker);
  if (value) {
    return <div className={styles.picker} data-testid="club-map-chosen">
      <span className={styles.meta}>{text.createLabel}</span>
      <p className={styles.summary}>{text.chosen(value.mapName, value.year)}</p>
      <div className={styles.buttons}><Button variant="secondary" disabled={disabled} onClick={() => onChange(undefined)}>{text.remove}</Button></div>
    </div>;
  }
  return <ClubMapPicker busy={disabled} label={text.createLabel} onUse={onChange} />;
}
