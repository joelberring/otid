"use client";

import { useState } from "react";
import type { PartyChangeRequest, PartyStateResponse } from "@o-tid/contracts";
import { contrastRatio } from "@o-tid/domain";
import local from "./party.module.css";
import styles from "../race-administrator-workspace.module.css";
import { partySv as text } from "../../i18n/party-sv";
import { CENTRUM_PRESET, NEUTRAL_PARTY_COLORS, partyThemeStyle } from "../../lib/party-theme-style";
import { Button } from "../ui";

/** Utseendet (PLAN.md steg 40): rubrik, två färger och loggan för bardisken och den publika sidan. Neutralt förval. */
const HEX = /^#[0-9a-f]{6}$/;
const LOGO_MAX_BYTES = 1_048_576;

export function PartyThemeForm({ state, busy, onChange, onLogo }: { state: PartyStateResponse; busy: boolean;
  onChange: (change: Extract<PartyChangeRequest["change"], { kind: "theme" }>) => Promise<boolean>;
  onLogo: (file: File | null) => Promise<boolean> }) {
  const theme = state.theme;
  const [title, setTitle] = useState(theme?.title ?? "");
  const [primary, setPrimary] = useState(theme?.primary ?? "");
  const [accent, setAccent] = useState(theme?.accent ?? "");
  const [error, setError] = useState<string>();
  const valid = (value: string) => value === "" || HEX.test(value.toLowerCase());
  const shown = { primary: HEX.test(primary.toLowerCase()) ? primary.toLowerCase() : null, accent: HEX.test(accent.toLowerCase()) ? accent.toLowerCase() : null };
  return <form noValidate className={local.form} aria-label={text.themeTitle} onSubmit={event => {
    event.preventDefault();
    if (!valid(primary) || !valid(accent)) { setError(text.invalidColor); return; }
    if (!state.startsAt) { setError(text.themeNeedsStart); return; }
    setError(undefined);
    void onChange({ kind: "theme", title: title.trim() || null, primary: primary ? primary.toLowerCase() : null, accent: accent ? accent.toLowerCase() : null });
  }}>
    <h3>{text.themeTitle}</h3>
    <p className={styles.workflowHelp}>{text.themeHelp}</p>
    <div className={local.fields}>
      <label>{text.themeHeading}<input type="text" maxLength={60} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>{text.themePrimary}<input type="text" value={primary} placeholder={NEUTRAL_PARTY_COLORS.primary} aria-invalid={valid(primary) ? undefined : true}
        onChange={event => setPrimary(event.target.value.trim())} /></label>
      <label>{text.themeAccent}<input type="text" value={accent} placeholder={NEUTRAL_PARTY_COLORS.accent} aria-invalid={valid(accent) ? undefined : true}
        onChange={event => setAccent(event.target.value.trim())} /></label>
    </div>
    <div className={local.themePreview} style={partyThemeStyle(shown)} aria-hidden="true">
      <span className={local.themeBand}>{title.trim() || text.themeTitle}</span>
      <span className={local.themeAccentText}>✓ {text.themeAccent} {shown.accent ? `(${contrastRatio(shown.accent, "#ffffff").toFixed(1)}:1 på vitt)` : ""}</span>
    </div>
    <div className={styles.actions}>
      <Button variant="secondary" onClick={() => { setTitle(CENTRUM_PRESET.title); setPrimary(CENTRUM_PRESET.primary); setAccent(CENTRUM_PRESET.accent); }}>
        {text.themeCentrum}</Button>
      <Button variant="secondary" onClick={() => { setTitle(""); setPrimary(""); setAccent(""); }}>{text.themeNeutral}</Button>
      <Button type="submit" disabled={busy}>{text.saveTheme}</Button>
    </div>
    {error && <p role="alert" className={local.error}>{error}</p>}
    <label className={local.logo}>{text.logo}
      <input type="file" accept="image/png,image/jpeg" disabled={busy} onChange={event => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!["image/png", "image/jpeg"].includes(file.type) || file.size > LOGO_MAX_BYTES) { setError(text.logoInvalid); return; }
        setError(undefined); void onLogo(file); event.target.value = "";
      }} /></label>
    {theme?.logo && <div className={styles.actions}>
      <img className={local.logoPreview} src={theme.logo} alt="" />
      <Button variant="secondary" disabled={busy} onClick={() => void onLogo(null)}>{text.logoRemove}</Button>
    </div>}
  </form>;
}
