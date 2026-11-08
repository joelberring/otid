"use client";

import { useEffect, useState } from "react";
import type { ClubDeviceRecord, ClubSummary } from "@o-tid/contracts";
import type { StationSystemData } from "@o-tid/sportident";
import { clubRequest } from "../lib/club-archive-client";

const KEY = "otid.stations.club.v1";

/**
 * Ägaren 2026-11-08: klubben vars enhetsregister utläsningarna och inställningarna sparas i (klubbar där kontot är ledare
 * eller mer). Valet sparas i webbläsaren.
 */
export function useClubDeviceRegister() {
  const [clubs, setClubs] = useState<ClubSummary[]>([]);
  const [clubId, setClubId] = useState("");
  useEffect(() => {
    let saved = "";
    try { saved = localStorage.getItem(KEY) ?? ""; } catch { saved = ""; }
    void clubRequest("/api/organizer/clubs").then(result => {
      if (result.status !== 200) return;
      const list = ((result.json as { clubs?: ClubSummary[] }).clubs ?? []).filter(club => club.role !== "READER");
      setClubs(list);
      if (list.some(club => club.clubId === saved)) setClubId(saved);
    }, () => undefined);
  }, []);
  const choose = (id: string) => { setClubId(id); try { localStorage.setItem(KEY, id); } catch { /* bara en bekvämlighet */ } };
  const club = clubs.find(row => row.clubId === clubId);

  /** Sparar enheten; ger klubbens namn eller undefined (inget valt) eller false (gick inte). */
  async function record(system: StationSystemData, extra: { backupCount: number | null; clockOffsetMs: number | null }): Promise<string | false | undefined> {
    if (!club) return undefined;
    const body: ClubDeviceRecord & { formatVersion: 1 } = { formatVersion: 1, serialNumber: system.serialNumber, model: system.model,
      firmware: system.firmware.slice(0, 20), code: system.code, mode: system.mode, batteryDate: system.batteryDate,
      batteryCapacityRaw: system.batteryCapacityRaw, memoryKb: system.memoryKb, backupCount: extra.backupCount,
      clockOffsetMs: extra.clockOffsetMs === null ? null : Math.max(-2e9, Math.min(2e9, Math.round(extra.clockOffsetMs))) };
    const result = await clubRequest(`/api/organizer/clubs/${encodeURIComponent(club.clubId)}/devices`, "POST", body).catch(() => ({ status: 0 }));
    return result.status === 200 ? club.name : false;
  }
  return { clubs, clubId, choose, record };
}
