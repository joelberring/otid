import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { readGroupPublicView } from "@o-tid/application";
import { sv } from "../../../../i18n/sv";
import { trainingGroupSv } from "../../../../i18n/training-group-sv";
import { publicDb } from "../../../../lib/db";
import { accountSessionToken } from "../../../../lib/public-race-gate";
import { clientAddressFrom } from "../../../../lib/security-policy";
import { publicOrigin } from "../../../../lib/public-origin";
import { displayAddress } from "../../../../lib/public-race-format";
import { QrSheet } from "../../../../components/public-race/qr-sheet";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ code: string }> };

export const metadata: Metadata = { title: `${trainingGroupSv.public.qr} – ${sv.appName}`, robots: { index: false, follow: false } };

/** Steg 68: QR-kod till gruppens fasta länk att skriva ut (som tävlingens QR-sida); samma synlighet som gruppsidan. */
export default async function GroupQrPage({ params }: Params) {
  const read = await readGroupPublicView(publicDb, { code: (await params).code, sessionToken: await accountSessionToken(),
    clientKey: clientAddressFrom(await headers()) });
  if (read.status !== "ok") notFound();
  const path = `/g/${read.view.code}`;
  const origin = await publicOrigin();
  const svg = await QRCode.toString(new URL(path, origin).toString(), { type: "svg", errorCorrectionLevel: "M", margin: 2,
    color: { dark: "#000000", light: "#ffffff" } });
  return <main className="stack">
    <QrSheet hubPath={path} eventName={read.view.name} details={trainingGroupSv.public.kicker} address={displayAddress(origin, path)}
      qrImage={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />
  </main>;
}
