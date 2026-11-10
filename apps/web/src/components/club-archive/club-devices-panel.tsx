"use client";

import { useCallback, useEffect, useState } from "react";
import { clubDevicesEn } from "../../i18n/club-archive-more-en";
import { useTexts, useLocale } from "../language-provider";
import type { ClubDeviceList } from "@o-tid/contracts";
import { clubDevicesSv } from "../../i18n/club-devices-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { Button, Notice } from "../ui";
import styles from "./club-archive.module.css";

const YEAR_MS = 365.25 * 24 * 3600 * 1000;
/** Äldre batteri än så här markeras (BSF8 3–5 år). */
const OLD_BATTERY_YEARS = 5;

/** Ägaren 2026-11-08: klubbens enhetsregister (fliken Enheter): batteriets ålder, klockan, senaste läsningen och anteckningen. */
export function ClubDevicesPanel({ clubId }: { clubId: string }) {
  const locale = useLocale();
  const text = useTexts(clubDevicesSv, clubDevicesEn);
  const [list, setList] = useState<ClubDeviceList>();
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [failed, setFailed] = useState(false);
  const base = `/api/organizer/clubs/${encodeURIComponent(clubId)}/devices`;
  const load = useCallback(async () => {
    const result = await clubRequest(base).catch(() => ({ status: 0, json: undefined }));
    if (result.status === 200) { setList(result.json as ClubDeviceList); setFailed(false); } else setFailed(true);
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  async function change(method: "PUT" | "DELETE", body: object) {
    const result = await clubRequest(base, method, { formatVersion: 1, ...body }).catch(() => ({ status: 0 }));
    if (result.status !== 200) setFailed(true);
    await load();
  }

  if (!list) return failed ? <Notice tone="error" role="alert">{text.failed}</Notice> : <p role="status">{text.loading}</p>;
  const now = Date.now();
  return <section data-testid="club-devices">
    <p className={styles.muted}>{text.help}</p>
    {failed && <Notice tone="error" role="alert">{text.failed}</Notice>}
    {list.devices.length === 0 ? <p>{text.none}</p> : <>
      <p>{text.count(list.devices.length)}</p>
      <div className={styles.deviceWrap}><table className={styles.deviceTable}>
        <thead><tr>{Object.values(text.columns).map(name => <th key={name}>{name}</th>)}{list.canDelete && <th />}</tr></thead>
        <tbody>{list.devices.map(device => {
          const years = device.batteryDate ? (now - Date.parse(`${device.batteryDate}T00:00:00Z`)) / YEAR_MS : undefined;
          return <tr key={device.serialNumber} data-testid="club-device">
            <td>{device.code ?? "–"}</td>
            <td>{device.serialNumber}</td>
            <td>{[device.model, device.firmware].filter(Boolean).join(" ")}</td>
            <td>{device.mode !== null ? text.modes[device.mode] ?? device.mode : "–"}</td>
            <td>{device.batteryDate ? <>{device.batteryDate} ({years !== undefined ? text.batteryAge(years) : ""}){years !== undefined && years > OLD_BATTERY_YEARS
              && <strong> · {text.batteryOld}</strong>}</> : "–"}</td>
            <td>{text.clock(device.clockOffsetMs)}</td>
            <td>{text.read(new Date(device.lastReadAt).toLocaleDateString(locale), device.lastReadBy)}</td>
            <td>{list.canRecord ? <form className={styles.inline} onSubmit={event => { event.preventDefault(); void change("PUT", { serialNumber: device.serialNumber,
              note: notes[device.serialNumber] ?? device.note }); }}>
              <input aria-label={text.noteLabel(device.serialNumber)} maxLength={500} value={notes[device.serialNumber] ?? device.note}
                onChange={event => setNotes(current => ({ ...current, [device.serialNumber]: event.target.value }))} />
              <Button type="submit" variant="quiet">{text.save}</Button>
            </form> : device.note}</td>
            {list.canDelete && <td><Button variant="quiet" onClick={() => {
              if (window.confirm(text.removeConfirm(device.serialNumber))) void change("DELETE", { serialNumber: device.serialNumber });
            }}>{text.remove}</Button></td>}
          </tr>;
        })}</tbody>
      </table></div>
    </>}
  </section>;
}
