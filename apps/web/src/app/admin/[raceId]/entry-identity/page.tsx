import Link from "next/link";
import { EntryIdentityAdmin } from "../../../../components/entry-identity-admin";
import { identitySv as text } from "../../../../i18n/entry-identity-sv";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className={`stack ${styles.page}`}><nav><Link href={`/admin/${raceId}`}>{text.back}</Link></nav>
    <h1>{text.title}</h1><EntryIdentityAdmin key={raceId} raceId={raceId} /></main>;
}
