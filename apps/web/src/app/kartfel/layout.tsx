import type { Metadata } from "next";
import { mapLinkSv } from "../../i18n/map-link-sv";
import { sv } from "../../i18n/sv";
import { NO_INDEX_ROBOTS } from "../../lib/no-index";

/** ADR-0214: kartritarens länk indexeras aldrig (robots-meta; robots.txt och X-Robots-Tag står i `lib/no-index.ts`). */
export const metadata: Metadata = { title: `${mapLinkSv.page.title} – ${sv.appName}`, robots: NO_INDEX_ROBOTS, referrer: "no-referrer" };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
