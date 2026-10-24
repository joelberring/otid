import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sv } from "../../../i18n/sv";
import { partyPublicSv as text } from "../../../i18n/party-public-sv";
import { publicRaceSv } from "../../../i18n/public-race-sv";
import { loadRaceHub, requireRaceHub } from "../../../lib/public-race-hub";
import { PreviewBanner } from "../../../components/public-race/preview-banner";
import { PartyPublic } from "../../../components/public-party/party-public";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ code: string }> };

/** Fest-sidan stängs för robotar: meta-taggen här, X-Robots-Tag i next.config och robots.txt (PLAN.md steg 40). */
const robots = { index: false, follow: false, noarchive: true, nosnippet: true, noimageindex: true } as const;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const hub = await loadRaceHub((await params).code);
  if (!hub) return { title: `${publicRaceSv.notPublished.title} – ${sv.appName}`, robots };
  return { title: `${text.metaTitle(hub.eventName)} – ${sv.appName}`, robots };
}

/**
 * Den publika fest-sidan (PLAN.md steg 40), bakom samma publiceringsgrind som tävlingarna. Servern skickar bara rubriken;
 * statistiken och namnen hämtas i webbläsaren, så att en robot utan JavaScript inte ser några namn.
 */
export default async function PartyPage({ params }: Params) {
  const hub = await requireRaceHub((await params).code);
  if (hub.raceType !== "PARTY") redirect(`/t/${hub.shortCode}`);
  return <>
    <PreviewBanner access={hub.access} />
    <PartyPublic code={hub.shortCode} eventName={hub.eventName} />
  </>;
}
