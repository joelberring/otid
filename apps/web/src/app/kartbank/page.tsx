import type { Metadata } from "next";
import { PublicMapBank } from "../../components/map-bank/public-map-bank";
import { mapBankEn } from "../../i18n/map-bank-en";
import { mapBankSv } from "../../i18n/map-bank-sv";
import { currentLanguage } from "../../lib/language-server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const text = (await currentLanguage()) === "en" ? mapBankEn : mapBankSv;
  return {
    title: text.metaTitle,
    description: text.metaDescription
  };
}

/** Publik sökbar kartbank (`/kartbank`), fungerar utan inloggning. */
export default function KartbankPage() {
  return <PublicMapBank />;
}
