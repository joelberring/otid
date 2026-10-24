import { useState } from "react";
import { raceSettingsResponseSchema, type RaceSettingsRequest, type RaceType } from "@o-tid/contracts";
import { raceTypeSv } from "../../i18n/race-type-sv";
import { raceInfoSv } from "../../i18n/race-info-sv";
import { startListPublicationSv } from "../../i18n/start-list-publication-sv";
import { formErrorsSv } from "../../i18n/form-errors-sv";
import { selfRegistrationSv } from "../../i18n/self-registration-sv";
import { isIsoDate, type FieldErrors } from "../../lib/form-validation";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

export type SettingsForm = { eventName: string; raceName: string; raceDate: string; raceType: RaceType;
  /** Steg 33: bricka i den publika startlistan, kort info och första start (bara information). */
  publicStartListCardNumbers: boolean; info: string; firstStartTime: string };
export const RACE_INFO_MAX = 1000;

/** Formuläret som det ser ut när delen öppnas: tävlingens sparade värden. */
export function settingsFormFrom(data: { eventName: string; raceName: string; raceDate: string; raceType: RaceType;
  publicStartListCardNumbers?: boolean | undefined; info?: string | null | undefined; firstStartTime?: string | null | undefined }): SettingsForm {
  return { eventName: data.eventName, raceName: data.raceName, raceDate: data.raceDate, raceType: data.raceType,
    publicStartListCardNumbers: data.publicStartListCardNumbers ?? true, info: data.info ?? "", firstStartTime: data.firstStartTime ?? "" };
}

/** Info som ren text: Windows-radbrytningar blir vanliga, andra styrtecken tas bort, blanksteg i början och slutet tas bort. Tom = null. */
export function normalizeRaceInfo(value: string): string | null {
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
  return text.length === 0 ? null : text;
}

/** Klockslag som TT:MM. Godtar 1830, 18.30 och 8:30. Tomt = null, ogiltigt = undefined. */
export function normalizeFirstStart(value: string): string | null | undefined {
  const text = value.trim();
  if (text.length === 0) return null;
  const match = /^([01]?[0-9]|2[0-3])[:.]?([0-5][0-9])$/.exec(text);
  return match ? `${match[1]!.padStart(2, "0")}:${match[2]}` : undefined;
}

/** Inställningar (ADR-0170 beslut 1): namn, datum och tävlingstyp, och (steg 33) bricka i publik startlista, info och första start. Formuläret fylls från tävlingen när delen öppnas. */
export function useSettingsState() {
  const [settingsForm, setSettingsForm] = useState<SettingsForm>();
  const [settingsAttempt, setSettingsAttempt] = useState<RaceSettingsRequest>();
  const [settingsMessage, setSettingsMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [settingsErrors, setSettingsErrors] = useState<FieldErrors<"eventName" | "raceName" | "raceDate" | "info" | "firstStartTime">>({});
  const [startListLiveMessage, setStartListLiveMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [selfRegistrationMessage, setSelfRegistrationMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  return { selfRegistrationMessage, setSelfRegistrationMessage, startListLiveMessage, setStartListLiveMessage, settingsErrors, setSettingsErrors, settingsForm, setSettingsForm, settingsAttempt, setSettingsAttempt, settingsMessage, setSettingsMessage };
}

export function createSettingsActions(ws: Base & RaceDataActions) {
  const { raceId, data, writingRef, pending, settingsForm, settingsAttempt, requireSession, begin, finish, current, request, json, csrf, load,
    setSettingsForm, setSettingsAttempt, setSettingsMessage, setSettingsErrors, setStartListLiveMessage, setSelfRegistrationMessage } = ws;
  const text = raceTypeSv.settings;

  function changeSettings(change: Partial<SettingsForm>) {
    if (!data) return;
    setSettingsMessage(undefined); setSettingsErrors({});
    setSettingsForm({ ...(settingsForm ?? settingsFormFrom(data)), ...change });
  }

  /**
   * Sparas direkt (inget resultat ändras). Ett försök som inte fick svar skickas om med samma request-id;
   * 400/404/409 betyder att något ändrats under tiden och försöket släpps.
   */
  async function saveSettings() {
    if (writingRef.current || pending.current || !requireSession() || !data) return;
    const form = settingsForm ?? settingsFormFrom(data);
    const info = normalizeRaceInfo(form.info), firstStartTime = normalizeFirstStart(form.firstStartTime);
    // Svenska fältfel i stället för webbläsarens (PLAN.md steg 24).
    const errors = { eventName: form.eventName.trim().length >= 2 ? undefined : formErrorsSv.eventName,
      raceName: form.raceName.trim().length >= 2 ? undefined : formErrorsSv.stageName,
      raceDate: isIsoDate(form.raceDate) ? undefined : formErrorsSv.raceDate,
      info: info === null || info.length <= RACE_INFO_MAX ? undefined : raceInfoSv.settings.infoTooLong(RACE_INFO_MAX),
      firstStartTime: firstStartTime === undefined ? raceInfoSv.settings.firstStartInvalid : undefined };
    setSettingsErrors(errors);
    if (!settingsAttempt && Object.values(errors).some(Boolean)) return;
    const attempt: RaceSettingsRequest = settingsAttempt ?? { formatVersion: 1, requestId: crypto.randomUUID(),
      eventName: form.eventName.trim(), raceName: form.raceName.trim(),
      raceDate: form.raceDate, raceType: form.raceType, publicStartListCardNumbers: form.publicStartListCardNumbers,
      info, firstStartTime: firstStartTime ?? null };
    setSettingsAttempt(attempt); setSettingsMessage(undefined);
    const op = begin(true);
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
  /**
   * "Uppdatera startlistan löpande" (Start → Publicera startlistan): sparas direkt med tävlingens sparade inställningar.
   * Av = besökare ser den senast publicerade listan igen.
   */
  async function saveStartListLive(live: boolean) {
    if (writingRef.current || pending.current || !requireSession() || !data) return;
    const attempt: RaceSettingsRequest = { formatVersion: 1, requestId: crypto.randomUUID(), eventName: data.eventName, raceName: data.raceName,
      raceDate: data.raceDate, raceType: data.raceType, startListLive: live };
    setStartListLiveMessage(undefined);
    const op = begin(true);
    try {
      const response = await request("/settings", op, { method: "POST", headers: { "content-type": "application/json",
        "x-otid-csrf": csrf(), "idempotency-key": `race-settings:${attempt.requestId}` }, body: JSON.stringify(attempt) });
      if (!response.ok) throw new Error("Live start list not saved");
      const receipt = raceSettingsResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== attempt.requestId) throw new Error("Settings receipt mismatch");
      setStartListLiveMessage({ tone: "ok", text: live ? startListPublicationSv.liveOn : startListPublicationSv.liveOff });
      await load(op);
    } catch { if (current(op)) setStartListLiveMessage({ tone: "error", text: startListPublicationSv.liveFailed }); }
    finally { finish(op); }
  }
  /**
   * Steg 41: "Tillåt självregistrering på tävlingsdagen" (fest-arbetsytan och Inställningar). Sparas direkt med tävlingens
   * sparade inställningar och auditpost, som "Uppdatera startlistan löpande".
   */
  async function saveSelfRegistration(enabled: boolean) {
    if (writingRef.current || pending.current || !requireSession() || !data) return;
    const attempt: RaceSettingsRequest = { formatVersion: 1, requestId: crypto.randomUUID(), eventName: data.eventName, raceName: data.raceName,
      raceDate: data.raceDate, raceType: data.raceType, selfRegistration: enabled };
    setSelfRegistrationMessage(undefined);
    const op = begin(true);
    try {
      const response = await request("/settings", op, { method: "POST", headers: { "content-type": "application/json",
        "x-otid-csrf": csrf(), "idempotency-key": `race-settings:${attempt.requestId}` }, body: JSON.stringify(attempt) });
      if (!response.ok) throw new Error("Self registration not saved");
      const receipt = raceSettingsResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== attempt.requestId) throw new Error("Settings receipt mismatch");
      setSelfRegistrationMessage({ tone: "ok", text: enabled ? selfRegistrationSv.setting.on : selfRegistrationSv.setting.off });
      await load(op);
    } catch { if (current(op)) setSelfRegistrationMessage({ tone: "error", text: selfRegistrationSv.setting.failed }); }
    finally { finish(op); }
  }
  return { changeSettings, saveSettings, saveStartListLive, saveSelfRegistration };
}
export type SettingsActions = ReturnType<typeof createSettingsActions>;
