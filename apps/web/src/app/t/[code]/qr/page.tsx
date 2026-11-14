import { notPublishedEn } from "../../../../i18n/workspace-last-en";
import type { Metadata } from "next";
import { NO_INDEX_ROBOTS } from "../../../../lib/no-index";
import QRCode from "qrcode";
import { sv } from "../../../../i18n/sv";
import { publicRaceSv } from "../../../../i18n/public-race-sv";
import { raceTypeSv } from "../../../../i18n/race-type-sv";
import { loadRaceHub, requireRaceHub } from "../../../../lib/public-race-hub";
import { publicOrigin } from "../../../../lib/public-origin";
import { displayAddress, formatRaceDate, raceHubPath } from "../../../../lib/public-race-format";
import { PreviewBanner } from "../../../../components/public-race/preview-banner";
import { QrSheet } from "../../../../components/public-race/qr-sheet";
import { raceDetails } from "@o-tid/domain";
import { qrEn, raceTypeNamesEn } from "../../../../i18n/public-en";
import { currentLanguage } from "../../../../lib/language-server";
import { LOCALE } from "../../../../lib/language";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const hub = await loadRaceHub((await params).code);
  const qrTitle = await currentLanguage() === "en" ? qrEn.title : publicRaceSv.qr.title;
  return { title: hub ? `${qrTitle}: ${hub.eventName} – ${sv.appName}` : `${(await currentLanguage() === "en" ? notPublishedEn : publicRaceSv.notPublished).title} – ${sv.appName}`,
    robots: NO_INDEX_ROBOTS };
}

/**
 * QR-kod att skriva ut (ADR-0172 beslut 4): tävlingens namn, en stor QR-kod till den korta adressen och adressen
 * i text. Koden skapas på servern med biblioteket `qrcode` (felkorrigering M) som SVG.
 */
export default async function RaceQrPage({ params }: Params) {
  const hub = await requireRaceHub((await params).code);
  const path = raceHubPath(hub.shortCode);
  const origin = await publicOrigin();
  const url = new URL(path, origin).toString();
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#000000", light: "#ffffff" } });
  const language = await currentLanguage();
  const details = raceDetails(hub.eventName, hub.raceName, [formatRaceDate(hub.raceDate, undefined, LOCALE[language]),
    language === "en" ? raceTypeNamesEn[hub.raceType] : raceTypeSv.types[hub.raceType].name]);
  return <main className="stack">
    <PreviewBanner access={hub.access} language={language} />
    <QrSheet hubPath={path} eventName={hub.eventName} details={details} address={displayAddress(origin, path)}
      qrImage={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />
  </main>;
}
