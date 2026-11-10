import type { Metadata } from "next";
import { currentLanguage } from "../../../lib/language-server";
import { OauthAuthorizePage } from "../../../components/oauth-authorize-page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await currentLanguage() === "en" ? "Connect an AI" : "Koppla AI"} – O-Tid`, robots: { index: false, follow: false } };
}

/** ADR-0219 (K2): godkännandet av en AI-koppling (OAuth 2.1, `authorization_endpoint`). */
export default function OauthAuthorizeRoute() {
  return <OauthAuthorizePage />;
}
