import type { Metadata } from "next";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { readPublicParty } from "@o-tid/application";
import { sv } from "../../../../i18n/sv";
import { partyPublicSv as text } from "../../../../i18n/party-public-sv";
import { publicRaceSv } from "../../../../i18n/public-race-sv";
import { db } from "../../../../lib/db";
import { loadRaceHub, requireRaceHub } from "../../../../lib/public-race-hub";
import { publicOrigin } from "../../../../lib/public-origin";
import { displayAddress } from "../../../../lib/public-race-format";
import { PreviewBanner } from "../../../../components/public-race/preview-banner";
import { PartyQrSheet } from "../../../../components/public-party/party-qr-sheet";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ code: string }> };

/** Samma skydd mot robotar som fest-sidan: meta-taggen här, X-Robots-Tag i next.config och robots.txt (`/fest/`). */
const robots = { index: false, follow: false, noarchive: true, nosnippet: true, noimageindex: true } as const;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const hub = await loadRaceHub((await params).code);
  if (!hub) return { title: `${publicRaceSv.notPublished.title} – ${sv.appName}`, robots };
  return { title: `${text.qr.title}: ${hub.eventName} – ${sv.appName}`, robots };
}

/**
 * QR-skylten för festen (PLAN.md steg 42): A4 stående med festens rubrik och logga, en stor QR-kod till `/fest/{kod}`,
 * adressen i klartext och hur man betalar. Bakom samma publiceringsgrind som fest-sidan. Inga namn: bara utseendet
 * hämtas. Koden skapas på servern med `qrcode` (felkorrigering M) som SVG.
 */
export default async function PartyQrPage({ params }: Params) {
  const hub = await requireRaceHub((await params).code);
  if (hub.raceType !== "PARTY") redirect(`/t/${hub.shortCode}/qr`);
  const party = await readPublicParty(db, hub.raceId);
  const path = `/fest/${hub.shortCode}`;
  const origin = await publicOrigin();
  const url = new URL(path, origin).toString();
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#000000", light: "#ffffff" } });
  const theme = party?.theme ?? { title: null, primary: null, accent: null, logo: null };
  return <main className="stack">
    <PreviewBanner access={hub.access} />
    <PartyQrSheet partyPath={path} title={theme.title ?? hub.eventName} eventName={hub.eventName} theme={theme} url={url}
      address={displayAddress(origin, path)} qrImage={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />
  </main>;
}
