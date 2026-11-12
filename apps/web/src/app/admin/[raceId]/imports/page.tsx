import { workspacePath } from "../../../../lib/race-sections";
import Link from "next/link";
import { ImportAdmin } from "../../../../components/import-admin";
import { importEn } from "../../../../i18n/import-admin-en";
import { importSv } from "../../../../i18n/import-admin-sv";
import { pickTexts } from "../../../../lib/language";
import { currentLanguage } from "../../../../lib/language-server";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function ImportAdminPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const language = await currentLanguage(), text = pickTexts(language, importSv, importEn);
  return <main className={`${styles.page} stack`}>
    <nav className="nav"><Link href={workspacePath(raceId, "ENTRIES")}>{text.backToRace}</Link><Link href="/organizer">{language === "en" ? "My races" : "Mina tävlingar"}</Link></nav>
    <section><h1>{text.pageHeading}</h1>
      <p>{text.pageLead}</p></section>
    <ImportAdmin raceId={raceId} />
  </main>;
}
