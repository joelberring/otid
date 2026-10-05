import Link from "next/link";
import { listEvents } from "@o-tid/application";
import { db } from "../lib/db";
import { startListPublicationSv } from "../i18n/start-list-publication-sv";
import { raceAdministratorSv } from "../i18n/race-administrator-sv";

export const dynamic = "force-dynamic";

export default async function Home() {
  const events = await listEvents(db);
  return <main>
    <nav className="nav">
      <Link href="/organizer">Mina tävlingar · Skapa tävling</Link>
    </nav>
    <div className="grid" style={{ marginTop: "1rem" }}>
      <section className="panel"><h2>Tävlingar</h2><div className="stack">
        {events.map((event) => <article key={event.raceId}>
          <strong>{event.eventName}</strong><br />
          <span>{event.raceName}, {event.raceDate}</span><br />
          <Link href={`/admin/${event.raceId}`}>Arrangör</Link> · <Link href={`/results/${event.raceId}`}>Publik</Link>
          {" · "}<Link href={`/admin/${event.raceId}/manage`}>{raceAdministratorSv.title}</Link>
          {" · "}<Link href={`/starts/${event.raceId}`}>{startListPublicationSv.publicTitle}</Link>
        </article>)}
        {events.length === 0 && <p className="muted">Skapa den första tävlingen.</p>}
      </div></section>
    </div>
  </main>;
}
