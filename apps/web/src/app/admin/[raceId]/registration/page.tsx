import Link from "next/link";
import { EntryRegistrationAdmin } from "../../../../components/entry-registration-admin";
import { registrationSv } from "../../../../i18n/entry-registration-sv";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className={`stack ${styles.page}`}><nav><Link href={`/admin/${raceId}`}>{registrationSv.back}</Link></nav>
    <h1>{registrationSv.title}</h1><EntryRegistrationAdmin raceId={raceId} /></main>;
}
