import type { Metadata } from "next";
import { NO_INDEX_ROBOTS } from "../../lib/no-index";

/** ADR-0185: startlistan indexeras inte (robots-meta; robots.txt och X-Robots-Tag står i `lib/no-index.ts`). */
export const metadata: Metadata = { robots: NO_INDEX_ROBOTS };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
