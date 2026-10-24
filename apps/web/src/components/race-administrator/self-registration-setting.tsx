"use client";

import styles from "../race-administrator-workspace.module.css";
import { selfRegistrationSv as text } from "../../i18n/self-registration-sv";
import { Notice } from "../ui";
import type { Workspace } from "./workspace-state";

/**
 * "Tillåt självregistrering på tävlingsdagen" (PLAN.md steg 41): i fest-arbetsytan och under Inställningar för andra typer
 * (inte stafett). Sparas direkt, av som standard.
 */
export function SelfRegistrationSetting({ ws }: { ws: Workspace }) {
  const { data, raceId, saving, workflowLocked, functionary, saveSelfRegistration, selfRegistrationMessage } = ws;
  if (!data || functionary || data.raceType === "RELAY") return null;
  const id = `self-registration-${raceId}-help`;
  return <div className={styles.fieldWithHelpBlock}>
    <label className={styles.check}><input type="checkbox" checked={data.selfRegistration === true} disabled={saving || workflowLocked}
      aria-describedby={id} onChange={event => void saveSelfRegistration(event.target.checked)} />{text.setting.label}</label>
    <p className={styles.workflowHelp} id={id}>{data.raceType === "PARTY" ? text.setting.helpParty : text.setting.help}</p>
    {selfRegistrationMessage && <Notice tone={selfRegistrationMessage.tone} role={selfRegistrationMessage.tone === "ok" ? "status" : "alert"}>
      {selfRegistrationMessage.text}</Notice>}
  </div>;
}
