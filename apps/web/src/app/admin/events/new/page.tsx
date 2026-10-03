import Link from "next/link";
import { EventCreationAdmin } from "../../../../components/event-creation-admin";
import { eventorSv } from "../../../../i18n/eventor-sv";

export const dynamic = "force-dynamic";

export default function NewEventPage() {
  return <main className="stack event-creation-page">
    <nav className="nav"><Link href="/">Tävlingar</Link><Link href="/admin/events/eventor">{eventorSv.heading}</Link></nav>
    <EventCreationAdmin />
  </main>;
}
