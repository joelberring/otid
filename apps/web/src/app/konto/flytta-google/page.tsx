import type { Metadata } from "next";
import { GoogleMovePage } from "../../../components/google-move-page";
import { googleMoveEn } from "../../../i18n/account-en";
import { accountSv } from "../../../i18n/account-sv";
import { currentLanguage } from "../../../lib/language-server";

export async function generateMetadata(): Promise<Metadata> {
  const text = await currentLanguage() === "en" ? googleMoveEn : accountSv.googleMove;
  return { title: `${text.title} – O-Tid`, robots: { index: false } };
}

/** ADR-0205 tillägg: bekräftelsen när Google-kontot är kopplat till ett annat, tomt konto (dubbletten). */
export default function MoveGooglePage() {
  return <GoogleMovePage />;
}
