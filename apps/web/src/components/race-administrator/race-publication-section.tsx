"use client";

import { useEffect, useState } from "react";
import { racePublicationResponseSchema } from "@o-tid/contracts";
import { publicRaceSv } from "../../i18n/public-race-sv";
import { displayAddress, formatRaceInstant, raceHubPath, raceQrPath } from "../../lib/public-race-format";
import { PublicLinkShare } from "../public-link-share";
import { Button, Notice, Section } from "../ui";
import styles from "../race-administrator-workspace.module.css";
import type { Workspace } from "./workspace-state";

const text = publicRaceSv.publish;

/**
 * Publicera tävlingen (ADR-0172 beslut 4): läget i en mening, en åtgärd, tävlingssidans korta adress och QR-koden.
 * Visas som eget steg i sidopanelen och under Inställningar. Sparas direkt; inget resultat ändras.
 */
export function RacePublicationSection({ ws, id }: { ws: Workspace; id: string }) {
  const { begin, busy, busyRef, csrf, current, data, finish, load, pending, profile, raceId, request, json, requireSession,
    workflowLocked } = ws;
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  if (!data) return null;
  const { publication } = data;
  const published = publication.publishedAt !== null;
  const hub = raceHubPath(publication.shortCode);

  async function change(publish: boolean) {
    if (busyRef.current || pending.current || !requireSession()) return;
    setMessage(undefined);
    const op = begin();
    try {
      const response = await request("/race-publication", op, { method: publish ? "PUT" : "DELETE", headers: { "x-otid-csrf": csrf() } });
      if (!response.ok) throw new Error("Publication failed");
      const receipt = racePublicationResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId) throw new Error("Publication receipt mismatch");
      await load(op);
      setMessage({ tone: "ok", text: publish ? text.publishedNow : text.unpublishedNow });
    } catch { if (current(op)) setMessage({ tone: "error", text: text.failed }); }
    finally { finish(op); }
  }

  return <Section id={id} title={text.title} help={text.help}>
    {publication.hiddenBySuperadmin && <Notice tone="attention">{text.hidden}</Notice>}
    <Notice tone={published ? "ok" : "info"}>
      {published ? text.published(formatRaceInstant(publication.publishedAt!, data.timeZone)) : text.unpublished}
    </Notice>
    {profile.course.some(section => section.id === "START") && <p className={styles.muted}>{text.startListRelation}</p>}
    <div className={styles.actions}>
      {published
        ? <Button variant="secondary" disabled={busy || workflowLocked} onClick={() => void change(false)}>{text.unpublish}</Button>
        : <Button disabled={busy || workflowLocked} onClick={() => void change(true)}>{text.publish}</Button>}
    </div>
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
    <div className={styles.publicationAddress}>
      <p><span className={styles.muted}>{text.page}: </span>
        <a href={hub} target="_blank" rel="noopener">{origin ? displayAddress(origin, hub) : hub}
          <span className="visually-hidden"> ({text.newTab})</span></a></p>
      <div className={styles.actions}>
        <a href={hub} target="_blank" rel="noopener">{published ? text.openPage : text.previewPage}</a>
        <a href={raceQrPath(publication.shortCode)} target="_blank" rel="noopener">{text.printQr}
          <span className="visually-hidden"> ({text.newTab})</span></a>
        <PublicLinkShare path={hub} title={data.eventName} />
      </div>
    </div>
  </Section>;
}

/** Steget Publicera i sidopanelen. */
export function PublishPanel({ ws }: { ws: Workspace }) {
  if (!ws.shows("PUBLISH") || !ws.data) return null;
  return <div className={styles.workflowGroup}><RacePublicationSection ws={ws} id={`publish-${ws.raceId}`} /></div>;
}
