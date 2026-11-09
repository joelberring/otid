"use client";

import { useClubFailure } from "./use-club-failure";
import { useState, type FormEvent } from "react";
import { clubArchiveChecksEn } from "../../i18n/club-archive-more-en";
import { useTexts } from "../language-provider";
import type { MapAgreement } from "@o-tid/contracts";
import { clubArchiveChecksSv } from "../../i18n/club-archive-checks-sv";
import { clubBase, clubRequest } from "../../lib/club-archive-client";
import { Button, Notice } from "../ui";
import { MapAgreementFields } from "../training-group/map-agreement";
import styles from "./archive-checks.module.css";


/**
 * ADR-0196 (ADR-0182 beslut 4, ADR-0194 beslut 2): kartans rättigheter ändras direkt där de visas, i Kartor-fliken och på
 * träningens sida. Samma anrop som "Namn och rättigheter" (PUT /maps/{id}, journalförs, följer med till grupperna).
 */
export function MapRightsEditor({ clubId, map, onSaved }: { clubId: string; map: MapAgreement & { mapId: string; name: string };
  onSaved: () => Promise<void> | void }) {
  const failure = useClubFailure();
  const text = useTexts(clubArchiveChecksSv.rights, clubArchiveChecksEn.rights);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState<MapAgreement>(() => agreementOf(map));
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await clubRequest(`${clubBase(clubId)}/maps/${map.mapId}`, "PUT", { formatVersion: 1, name: map.name, agreement: value });
      if (result.status !== 200) { setMessage({ tone: "error", text: failure(result.status) }); return; }
      setMessage({ tone: "ok", text: text.saved });
      setOpen(false);
      await onSaved();
    } finally { setBusy(false); }
  }
  return <div className={styles.rights}>
    {!open && <Button variant="secondary" onClick={() => { setValue(agreementOf(map)); setMessage(undefined); setOpen(true); }}
      aria-label={`${text.edit}: ${map.name}`}>{text.edit}</Button>}
    {open && <form className={styles.rights} onSubmit={event => void save(event)} aria-label={text.title(map.name)}>
      <p className={styles.why}>{text.help}</p>
      <MapAgreementFields value={value} onChange={setValue} disabled={busy} />
      <div className={styles.buttons}>
        <Button type="submit" disabled={busy}>{text.save}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>{text.cancel}</Button>
      </div>
    </form>}
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
  </div>;
}

function agreementOf(map: MapAgreement): MapAgreement {
  return { ownership: map.ownership, ownerKind: map.ownerKind, ownerName: map.ownerName, agreement: map.agreement, validUntil: map.validUntil,
    contact: map.contact, trainingOnly: map.trainingOnly, feePerPrint: map.feePerPrint, noPublicDisplay: map.noPublicDisplay };
}
