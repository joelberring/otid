import { useState } from "react";
import { raceSettingsResponseSchema, type RaceSettingsRequest, type RaceType } from "@o-tid/contracts";
import { raceTypeSv } from "../../i18n/race-type-sv";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

export type SettingsForm = { eventName: string; raceName: string; raceDate: string; raceType: RaceType };

/** Inställningar (ADR-0170 beslut 1): namn, datum och tävlingstyp. Formuläret fylls från tävlingen när delen öppnas. */
export function useSettingsState() {
  const [settingsForm, setSettingsForm] = useState<SettingsForm>();
  const [settingsAttempt, setSettingsAttempt] = useState<RaceSettingsRequest>();
  const [settingsMessage, setSettingsMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  return { settingsForm, setSettingsForm, settingsAttempt, setSettingsAttempt, settingsMessage, setSettingsMessage };
}

export function createSettingsActions(ws: Base & RaceDataActions) {
  const { raceId, data, busyRef, pending, settingsForm, settingsAttempt, requireSession, begin, finish, current, request, json, csrf, load,
    setSettingsForm, setSettingsAttempt, setSettingsMessage } = ws;
  const text = raceTypeSv.settings;

  function changeSettings(change: Partial<SettingsForm>) {
    if (!data) return;
    setSettingsMessage(undefined);
    setSettingsForm({ ...(settingsForm ?? { eventName: data.eventName, raceName: data.raceName, raceDate: data.raceDate,
      raceType: data.raceType }), ...change });
  }

  /**
   * Sparas direkt (inget resultat ändras). Ett försök som inte fick svar skickas om med samma request-id;
   * 400/404/409 betyder att något ändrats under tiden och försöket släpps.
   */
  async function saveSettings() {
    if (busyRef.current || pending.current || !requireSession() || !data) return;
    const form = settingsForm ?? { eventName: data.eventName, raceName: data.raceName, raceDate: data.raceDate, raceType: data.raceType };
    const attempt: RaceSettingsRequest = settingsAttempt ?? { formatVersion: 1, requestId: crypto.randomUUID(),
      expectedSnapshotVersion: data.snapshotVersion, eventName: form.eventName.trim(), raceName: form.raceName.trim(),
      raceDate: form.raceDate, raceType: form.raceType };
    setSettingsAttempt(attempt); setSettingsMessage(undefined);
    const op = begin();
    try {
      const response = await request("/settings", op, { method: "POST", headers: { "content-type": "application/json",
        "x-otid-csrf": csrf(), "idempotency-key": `race-settings:${attempt.requestId}` }, body: JSON.stringify(attempt) });
      if (response.status === 400 || response.status === 404 || response.status === 409) {
        setSettingsAttempt(undefined); setSettingsMessage({ tone: "error", text: text.conflict });
        setSettingsForm(undefined); await load(op);
        return;
      }
      if (!response.ok) throw new Error("Unknown settings outcome");
      const receipt = raceSettingsResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== attempt.requestId) throw new Error("Settings receipt mismatch");
      setSettingsAttempt(undefined); setSettingsForm(undefined);
      setSettingsMessage({ tone: "ok", text: text.saved });
      await load(op);
    } catch { if (current(op)) setSettingsMessage({ tone: "error", text: text.failed }); }
    finally { finish(op); }
  }
  return { changeSettings, saveSettings };
}
export type SettingsActions = ReturnType<typeof createSettingsActions>;
