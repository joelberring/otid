import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { sv } from "../i18n/sv";
import { SiteFooter } from "../components/about/site-footer";
import { LanguageSwitch } from "../components/language-switch";
import { siteEn } from "../i18n/public-en";
import { currentLanguage } from "../lib/language-server";
import { Logo } from "../components/brand/logo";
import { introFilmUrl } from "../lib/intro-film";
import "../components/ui/tokens.css";
import "./globals.css";

/** Ikonerna ligger bredvid (`favicon.ico`, `icon.svg`, `apple-icon.png`) och manifestet i `manifest.ts`. */
export const metadata: Metadata = { title: sv.appName, applicationName: sv.appName, description: `${sv.appName} – ${sv.tagline}` };

/**
 * PLAN.md steg 46: sidornas CSP har en nonce per förfrågan (`src/proxy.ts`), som Next sätter på sina skript när sidan
 * renderas. En förrenderad sida skulle sakna noncen och inte få köra sina skript, så alla sidor renderas vid förfrågan.
 */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const language = await currentLanguage();
  // Hjälppanelen (en klientkomponent) visar "Se filmen (1 min)" när adressen finns; den läses här vid förfrågan.
  return <html lang={language}><body data-intro-film={introFilmUrl()}>
    <header className="site-header">
      <Link href="/"><Logo size={28} className="site-header-logo" />{sv.appName}</Link>
      <span className="site-header-tagline"><span aria-hidden="true">·</span> {language === "en" ? siteEn.tagline : sv.tagline}</span>
      <LanguageSwitch language={language} className="site-header-language" />
    </header>
    {children}
    <SiteFooter language={language} />
  </body></html>;
}
