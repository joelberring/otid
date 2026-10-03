import Link from "next/link";
import { EventorImportAdmin } from "../../../../components/eventor-import-admin";
import { eventorSv } from "../../../../i18n/eventor-sv";
export const dynamic = "force-dynamic";
export default function EventorImportPage() {
  return <main className="stack"><nav className="nav"><Link href="/">{eventorSv.events}</Link></nav><EventorImportAdmin /></main>;
}
