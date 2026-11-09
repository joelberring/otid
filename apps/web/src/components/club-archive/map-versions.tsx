"use client";

import { useClubFailure } from "./use-club-failure";
import { useState, type FormEvent } from "react";
import { clubMapDuplicatesEn } from "../../i18n/club-space-en";
import { useTexts } from "../language-provider";
import type { ClubMapCopyField, ClubMapVersionView, ClubMapView } from "@o-tid/contracts";
import { clubMapDuplicatesSv } from "../../i18n/club-map-duplicates-sv";
import { clubBase, clubRequest } from "../../lib/club-archive-client";
import { Button, Field } from "../ui";
import { StartMapProject } from "../map-project/start-map-project";
import styles from "./map-duplicates.module.css";

/**
 * ADR-0210 beslut 3 och 4: versionens år (gissat eller inskrivet), kartritaren och anteckningen, "Kopiera till alla
 * versioner" och "Från kartan" med en förhandsvisning av vad som ändras, och kartans historik med "Ångra sammanslagning".
 */
type Message = { tone: "ok" | "error"; text: string };
type Copy = { fromVersionId: string | null; fields: ClubMapCopyField[]; versionIds: string[]; title: string };

/** Vad kopieringen ändrar: en rad per version och fält som får ett annat värde. */
export function copyChanges(map: ClubMapView, copy: Pick<Copy, "fromVersionId" | "fields" | "versionIds">) {
  const source = copy.fromVersionId === null ? { maker: map.maker, note: null } : map.versions.find(version => version.versionId === copy.fromVersionId);
  if (!source) return [];
  return map.versions.filter(version => copy.versionIds.includes(version.versionId) && version.versionId !== copy.fromVersionId)
    .flatMap(version => copy.fields.filter(field => version[field] !== source[field])
      .map(field => ({ version, field, before: version[field], after: source[field] })));
}

/** Förhandsvisningen och knappen "Kopiera". */
function CopyPreview({ clubId, map, copy, onClose, onChanged, onMessage }: { clubId: string; map: ClubMapView; copy: Copy; onClose: () => void;
  onChanged: () => Promise<void>; onMessage: (message: Message) => void }) {
  const failure = useClubFailure();
  const text = useTexts(clubMapDuplicatesSv.versions, clubMapDuplicatesEn.versions);
  const [fields, setFields] = useState(copy.fields);
  const [busy, setBusy] = useState(false);
  const changes = copyChanges(map, { ...copy, fields });
  async function run() {
    setBusy(true);
    try {
      const result = await clubRequest(`${clubBase(clubId)}/maps/${map.mapId}/versions-copy`, "POST", { formatVersion: 1, fromVersionId: copy.fromVersionId,
        fields, versionIds: copy.versionIds });
      if (result.status !== 200) { onMessage({ tone: "error", text: failure(result.status) }); return; }
      onMessage({ tone: "ok", text: text.copied((result.json as { updated: number }).updated) });
      onClose();
      await onChanged();
    } finally { setBusy(false); }
  }
  return <div className={styles.versionForm} role="group" aria-label={copy.title} data-testid="copy-preview">
    <strong>{copy.title}</strong>
    {copy.fromVersionId !== null && <div className={styles.buttons}>
      {(["maker", "note"] as const).map(field => <label key={field} className={styles.select}>
        <input type="checkbox" checked={fields.includes(field)} onChange={event => setFields(current => event.target.checked
          ? [...current, field] : current.filter(item => item !== field))} />{text.fields[field]}</label>)}
    </div>}
    {changes.length === 0 ? <p className={styles.help}>{text.nothing}</p> : <>
      <p className={styles.help}>{text.preview}</p>
      <ul className={styles.preview}>{changes.map(change => <li key={`${change.version.versionId}-${change.field}`}>
        {text.previewLine(change.version.fileName, text.fields[change.field], change.before, change.after)}</li>)}</ul>
    </>}
    <div className={styles.buttons}>
      <Button onClick={() => void run()} disabled={busy || changes.length === 0}>{text.confirm}</Button>
      <Button variant="secondary" onClick={onClose} disabled={busy}>{text.cancel}</Button>
    </div>
  </div>;
}

/** Året och varifrån det kommer, kartritaren, och (för administratörer) ändra och kopiera. */
export function VersionDetails({ clubId, map, version, admin, onChanged, onMessage }: { clubId: string; map: ClubMapView; version: ClubMapVersionView;
  admin: boolean; onChanged: () => Promise<void>; onMessage: (message: Message) => void }) {
  const failure = useClubFailure();
  const text = useTexts(clubMapDuplicatesSv.versions, clubMapDuplicatesEn.versions);
  const [editing, setEditing] = useState(false);
  const [copy, setCopy] = useState<Copy>();
  const [year, setYear] = useState("");
  const [maker, setMaker] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const others = map.versions.filter(other => other.versionId !== version.versionId).map(other => other.versionId);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const value = year.trim() === "" ? null : Number(year);
      const result = await clubRequest(`${clubBase(clubId)}/map-versions/${version.versionId}`, "PUT", { formatVersion: 1, versionDate: version.versionDate,
        note: note.trim(), versionYear: value, maker: maker.trim() });
      if (result.status !== 200) { onMessage({ tone: "error", text: failure(result.status) }); return; }
      onMessage({ tone: "ok", text: text.saved });
      setEditing(false);
      await onChanged();
    } finally { setBusy(false); }
  }

  return <div>
    <span className={styles.versionYear} data-testid="version-year">{version.year}</span>{" "}
    <span className={styles.yearSource}>({text.yearSource[version.yearSource]})</span>
    {version.maker && <span className={styles.yearSource}> · {text.makerLabel(version.maker)}</span>}
    {admin && !editing && !copy && <div className={styles.buttons}>
      <Button variant="quiet" aria-label={text.editTitle(version.fileName)} onClick={() => {
        setYear(version.yearSource === "MANUAL" ? String(version.year) : ""); setMaker(version.maker ?? ""); setNote(version.note ?? ""); setEditing(true);
      }}>{text.edit}</Button>
      {others.length > 0 && <Button variant="quiet" aria-label={text.copyAllTitle(version.fileName)} onClick={() => setCopy({ fromVersionId: version.versionId,
        fields: version.maker ? ["maker"] : ["note"], versionIds: others, title: text.copyAllTitle(version.fileName) })}>{text.copyAll}</Button>}
      {map.maker && <Button variant="quiet" aria-label={text.fromMapTitle(version.fileName)} onClick={() => setCopy({ fromVersionId: null, fields: ["maker"],
        versionIds: [version.versionId], title: text.fromMapTitle(version.fileName) })}>{text.fromMap}</Button>}
    </div>}
    {/* ADR-0219 (rättelsen 2026-11-07): alla som ser kartbanken kan starta ett kartprojekt från en version. */}
    {!editing && !copy && <div className={styles.buttons}>
      <StartMapProject clubId={clubId} versionId={version.versionId} mapName={map.name} fileName={version.fileName} />
    </div>}
    {editing && <form className={styles.versionForm} onSubmit={event => void save(event)} aria-label={text.editTitle(version.fileName)}>
      <div className={styles.row}>
        <Field label={text.year} help={text.yearHelp}><input inputMode="numeric" pattern="\d{4}" value={year} placeholder={String(version.year)}
          onChange={event => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))} /></Field>
        <Field label={text.maker}><input value={maker} maxLength={200} onChange={event => setMaker(event.target.value)} /></Field>
      </div>
      <Field label={text.note}><input value={note} maxLength={500} onChange={event => setNote(event.target.value)} /></Field>
      <div className={styles.buttons}>
        <Button type="submit" disabled={busy || (year !== "" && !/^(19[5-9]\d|20\d{2}|2100)$/.test(year))}>{text.save}</Button>
        <Button variant="secondary" onClick={() => setEditing(false)} disabled={busy}>{text.cancel}</Button>
      </div>
    </form>}
    {copy && <CopyPreview clubId={clubId} map={map} copy={copy} onClose={() => setCopy(undefined)} onChanged={onChanged} onMessage={onMessage} />}
  </div>;
}

/** Kartritaren från kartan till alla versioner (med förhandsvisning). */
export function MapMakerToVersions({ clubId, map, onChanged, onMessage }: { clubId: string; map: ClubMapView; onChanged: () => Promise<void>;
  onMessage: (message: Message) => void }) {
  const clubMapDuplicatesText = useTexts(clubMapDuplicatesSv, clubMapDuplicatesEn);
  const text = useTexts(clubMapDuplicatesSv.versions, clubMapDuplicatesEn.versions);
  const [open, setOpen] = useState(false);
  if (!map.maker || map.versions.length === 0) return null;
  const title = `${text.copyAll}: ${clubMapDuplicatesText.mapInfo.maker.toLowerCase()} ${map.maker}`;
  return open ? <CopyPreview clubId={clubId} map={map} copy={{ fromVersionId: null, fields: ["maker"], versionIds: map.versions.map(version => version.versionId),
    title }} onClose={() => setOpen(false)} onChanged={onChanged} onMessage={onMessage} />
    : <div className={styles.buttons}><Button variant="secondary" aria-label={title} onClick={() => setOpen(true)}>{text.copyAll}</Button></div>;
}

const day = (iso: string) => iso.slice(0, 10);

/** Sammanslagningarna in i kartan; den senaste går att ångra tills kartan har ändrats. */
export function MergeHistory({ clubId, map, admin, onChanged, onMessage }: { clubId: string; map: ClubMapView; admin: boolean; onChanged: () => Promise<void>;
  onMessage: (message: Message) => void }) {
  const failure = useClubFailure();
  const clubMapDuplicatesText = useTexts(clubMapDuplicatesSv, clubMapDuplicatesEn);
  const [busy, setBusy] = useState(false);
  const history = clubMapDuplicatesText.history;
  if (map.merges.length === 0) return null;
  async function undo(mergeId: string) {
    setBusy(true);
    try {
      const result = await clubRequest(`${clubBase(clubId)}/map-merges/${mergeId}/undo`, "POST");
      if (result.status === 409) { onMessage({ tone: "error", text: history.conflict }); return; }
      if (result.status !== 200) { onMessage({ tone: "error", text: failure(result.status) }); return; }
      onMessage({ tone: "ok", text: history.undoDone });
      await onChanged();
    } finally { setBusy(false); }
  }
  return <details className={styles.versionForm} data-testid="map-history">
    <summary>{history.title}</summary>
    <ul className={styles.history}>{map.merges.map(merge => <li key={merge.mergeId}>
      <span>{history.merged(day(merge.createdAt), merge.absorbedNames, merge.versions)}</span>
      {merge.undoneAt ? <span className={styles.help}>{history.undone(day(merge.undoneAt))}</span>
        : merge.undoable && admin ? <Button variant="secondary" disabled={busy} onClick={() => void undo(merge.mergeId)}>{history.undo}</Button>
          : <span className={styles.help}>{history.locked}</span>}
    </li>)}</ul>
  </details>;
}
