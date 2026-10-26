"use client";

import { useEffect, useState } from "react";
import { courseSecrecyResponseSchema, racePublicationResponseSchema } from "@o-tid/contracts";
import { publicRaceSv } from "../../i18n/public-race-sv";
import { courseSecrecySv as secrecyText } from "../../i18n/course-secrecy-sv";
import { displayAddress, formatRaceInstant, raceHubPath, raceQrPath } from "../../lib/public-race-format";
import { PublicLinkShare } from "../public-link-share";
import { Button, Notice, Section } from "../ui";
import styles from "../race-administrator-workspace.module.css";
import type { Workspace } from "./workspace-state";

const text = publicRaceSv.publish;

/**
 * Publicera tävlingen (ADR-0172 beslut 4): läget i en mening, en åtgärd, tävlingssidans korta adress och QR-koden.
 * Finns bara som eget steg i sidopanelen; Inställningar länkar hit (PLAN.md steg 24). Sparas direkt; inget resultat ändras.
 */
function RacePublicationSection({ ws, id }: { ws: Workspace; id: string }) {
  const { begin, busy, writingRef, csrf, current, data, finish, load, pending, profile, raceId, request, json, requireSession,
    workflowLocked } = ws;
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  if (!data) return null;
  const { publication } = data;
  const published = publication.publishedAt !== null;
  const hub = raceHubPath(publication.shortCode);

  async function change(publish: boolean) {
    if (writingRef.current || pending.current || !requireSession()) return;
    setMessage(undefined);
    const op = begin(true);
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

/**
 * Steg 52 (ADR-0176): banorna publikt. Läget i en mening och "Visa banorna publikt nu" (eller ångra valet). Sparas direkt;
 * inget resultat ändras.
 */
function CourseSecrecySection({ ws, id }: { ws: Workspace; id: string }) {
  const { begin, busy, writingRef, csrf, current, data, finish, load, pending, raceId, request, json, requireSession, workflowLocked } = ws;
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const secrecy = data?.courseSecrecy;
  if (!secrecy) return null;

  async function change(reveal: boolean) {
    if (writingRef.current || pending.current || !requireSession()) return;
    setMessage(undefined);
    const op = begin(true);
    try {
      const response = await request("/course-secrecy", op, { method: reveal ? "PUT" : "DELETE", headers: { "x-otid-csrf": csrf() } });
      if (!response.ok) throw new Error("Course secrecy failed");
      const receipt = courseSecrecyResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId) throw new Error("Course secrecy receipt mismatch");
      await load(op);
      setMessage({ tone: "ok", text: reveal ? secrecyText.revealedNow : secrecyText.withdrawnNow });
    } catch { if (current(op)) setMessage({ tone: "error", text: secrecyText.failed }); }
    finally { finish(op); }
  }

  return <Section id={id} title={secrecyText.title} help={secrecyText.help}>
    <Notice tone={secrecy.public ? "ok" : "info"}>{secrecy.reason ? secrecyText.reason[secrecy.reason]
      : data.entries.length === 0 ? secrecyText.secretEmpty : secrecyText.secret(secrecy.remaining)}</Notice>
    <div className={styles.actions}>
      {secrecy.revealedAt
        ? <Button variant="secondary" disabled={busy || workflowLocked} onClick={() => void change(false)}>{secrecyText.withdraw}</Button>
        : !secrecy.public && <Button variant="secondary" disabled={busy || workflowLocked} onClick={() => void change(true)}>{secrecyText.reveal}</Button>}
    </div>
    {secrecy.revealedAt && <p className={styles.muted}>{secrecyText.withdrawNote}</p>}
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
  </Section>;
}

/** Steget Publicera i sidopanelen. */
export function PublishPanel({ ws }: { ws: Workspace }) {
  if (!ws.shows("PUBLISH") || !ws.data) return null;
  return <div className={styles.workflowGroup}><RacePublicationSection ws={ws} id={`publish-${ws.raceId}`} />
    <CourseSecrecySection ws={ws} id={`course-secrecy-${ws.raceId}`} /></div>;
}
