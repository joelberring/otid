import Link from "next/link";
import type { PublicRadioPassage } from "@o-tid/contracts";
import { radioControlName, radioSv } from "../../i18n/radio-sv";
import { formatClockTime, formatDuration } from "../../lib/clock-time";
import type { RadioClass } from "../../lib/lists/result-list-model";
import lists from "../lists/lists.module.css";
import styles from "./radio-live.module.css";

const text = radioSv.live;

/** Tid sedan start, eller klockslaget när starttiden saknas. */
export function passageTime(passage: PublicRadioPassage, timeZone: string): string {
  if (passage.elapsedMs !== null) return formatDuration(passage.elapsedMs);
  return passage.passedAt ? text.clock(formatClockTime(passage.passedAt, timeZone)) : text.noTime;
}

function Runner({ passage, raceId, links }: { passage: PublicRadioPassage; raceId: string; links: boolean }) {
  const name = `${passage.givenName} ${passage.familyName}`;
  // Resultatsidan finns först när löparen läst av.
  return links && passage.finished ? <Link href={`/results/${raceId}/participants/${passage.publicResultId}`}>{name}</Link> : <>{name}</>;
}

function Place({ place }: { place: number | null }) {
  return place === null ? null : <span aria-label={text.placeLabel(place)}>{text.place(place)}</span>;
}

/**
 * Radiokontrollerna i en klass (ADR-0172 beslut 5): löpare som är ute i skogen och passerat en radiokontroll
 * ("passerat Radio 1 7:20 (2)"), och tiderna vid varje radiokontroll med placering. Placeringen är preliminär
 * tills löparen läst av; avläsningen avgör resultatet. Samma del på resultatlistan och i sträcktidsanalysen.
 */
export function RadioLive({ radio, timeZone, raceId, links, className }: {
  radio: RadioClass; timeZone: string; raceId: string; links: boolean; className: string;
}) {
  const id = `radio-${className.replace(/\W+/g, "-")}`;
  return <div className={styles.radio}>
    {radio.onTheWay.length > 0 && <section aria-labelledby={`${id}-out`}>
      <div className={styles.head}><h4 id={`${id}-out`}>{text.onTheWayTitle}</h4><p>{text.onTheWayHelp}</p></div>
      <table className={lists.table} aria-labelledby={`${id}-out`}>
        <thead><tr><th scope="col" className={lists.place}>{text.placeColumn}</th><th scope="col">{text.name}</th>
          <th scope="col" className={`${lists.num} ${lists.narrow}`}>{text.time}</th></tr></thead>
        <tbody>{radio.onTheWay.map(passage => {
          const control = radioControlName(passage.controlCode, passage.label);
          return <tr key={passage.publicResultId} data-radio="out">
            <td className={lists.place}>{passage.place === null ? "" : <span className={styles.provisional}>{text.place(passage.place)}</span>}</td>
            <th scope="row"><Runner passage={passage} raceId={raceId} links={links} />
              <span className={lists.sub}>{[text.passed(control), passage.organisationName].filter(Boolean).join(" · ")}</span></th>
            <td className={lists.num}>{passageTime(passage, timeZone)}</td>
          </tr>;
        })}</tbody>
      </table>
    </section>}
    <section aria-labelledby={`${id}-controls`} className={styles.controls}>
      <h4 id={`${id}-controls`}>{text.title}</h4>
      {radio.controls.filter(control => control.passages.length > 0).map(control => {
        const name = radioControlName(control.controlCode, control.label, true);
        const leader = control.passages[0]!;
        return <details key={control.controlCode} className={styles.control}>
          <summary><strong>{text.controlHeading(name, control.passages.length)}</strong>
            {leader.place === 1 && <span className={styles.leader}>
              {text.leader(`${leader.givenName} ${leader.familyName}`, passageTime(leader, timeZone))}</span>}</summary>
          <table className={lists.table} aria-label={name}>
            <thead><tr><th scope="col" className={lists.place}>{text.placeColumn}</th><th scope="col">{text.name}</th>
              <th scope="col" className={`${lists.num} ${lists.narrow}`}>{text.time}</th></tr></thead>
            <tbody>{control.passages.map(passage => <tr key={passage.publicResultId}>
              <td className={lists.place}><Place place={passage.place} /></td>
              <th scope="row"><Runner passage={passage} raceId={raceId} links={links} />
                <span className={lists.sub}>{[passage.finished ? text.finished : null, passage.organisationName].filter(Boolean).join(" · ")}</span></th>
              <td className={lists.num}>{passageTime(passage, timeZone)}</td>
            </tr>)}</tbody>
          </table>
        </details>;
      })}
    </section>
  </div>;
}
