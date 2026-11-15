import { AdminShortcut } from "../../../components/public-race/admin-shortcut";

/**
 * Ägaren 2026-11-15: tävlingssidan och dess undersidor (Live, bingon, QR) har snabblänken till adminläget för den som är
 * administratör. Länken hämtas i webbläsaren; sidan är densamma för alla.
 */
export default async function Layout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ code: string }> }>) {
  return <><AdminShortcut code={(await params).code} />{children}</>;
}
