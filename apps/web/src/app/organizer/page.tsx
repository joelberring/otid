import type { Metadata } from "next";
import { OrganizerWorkspace } from "../../components/organizer-workspace";
import { googleLoginEnabled } from "../../lib/google-login-enabled";
import { currentLanguage } from "../../lib/language-server";
import { organizerEn } from "../../i18n/organizer-en";
import { organizerSv } from "../../i18n/organizer-sv";

/** Översynen 2026-11-17: navet heter Mitt O-Tid (sidtiteln också). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await currentLanguage() === "en" ? organizerEn.yourEvents : organizerSv.yourEvents} – O-Tid` };
}

// ADR-0205: knappen "Logga in med Google" följer serverns miljö när sidan visas, inte när avbildningen byggs.
export const dynamic = "force-dynamic";

export default function OrganizerPage() {
  return <OrganizerWorkspace googleEnabled={googleLoginEnabled()} />;
}
