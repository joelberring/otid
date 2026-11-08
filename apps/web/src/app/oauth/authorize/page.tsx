import type { Metadata } from "next";
import { OauthAuthorizePage } from "../../../components/oauth-authorize-page";

export const metadata: Metadata = { title: "Koppla AI – O-Tid", robots: { index: false, follow: false } };

/** ADR-0219 (K2): godkännandet av en AI-koppling (OAuth 2.1, `authorization_endpoint`). */
export default function OauthAuthorizeRoute() {
  return <OauthAuthorizePage />;
}
