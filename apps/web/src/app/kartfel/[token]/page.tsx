import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { readMapLinkView } from "@o-tid/application";
import { mapLinkSv } from "../../../i18n/map-link-sv";
import { mapLinkEn } from "../../../i18n/course-setting-link-en";
import { currentLanguage } from "../../../lib/language-server";
import { db } from "../../../lib/db";
import { clientAddressFrom } from "../../../lib/security-policy";
import { MapLinkPage } from "../../../components/map-link/map-link-page";
import styles from "../../../components/map-link/map-link-page.module.css";

export const dynamic = "force-dynamic";

/**
 * ADR-0214: sidan som kartritaren öppnar med länken. Nyckeln i adressen är behörigheten (ingen inloggning). Ogiltig,
 * avstängd, utgången eller okänd länk ger samma sida ("Länken gäller inte längre", 404) utan att säga om den funnits.
 */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const text = await currentLanguage() === "en" ? mapLinkEn : mapLinkSv;
  const read = await readMapLinkView(db, { token, clientKey: clientAddressFrom(await headers()) });
  if (read.status === "invalid") notFound();
  if (read.status === "rate-limited") return <main className={styles.page}><section className={styles.invalid}>
    <h1>{text.page.title}</h1><p role="alert">{text.page.rateLimited}</p></section></main>;
  return <MapLinkPage token={token} initial={read.response} />;
}
