import type { CardPunchList } from "@o-tid/domain";
import { cardPunchesSv as text, cardPunchSummary, punchTimeText } from "../i18n/card-punches-sv";

/**
 * Brickans stämplingar i beskedet för en felstämplad eller okänd bricka (PLAN.md steg 27), kompakt: förklaringen och
 * stämplingarna i ordning med kod och klockslag. Det som inte hör till banan märks med symbol och ord i förklaringen.
 */
export function PunchListView({ list, timeZone }: { list: CardPunchList; timeZone: string }) {
  const summary = cardPunchSummary(list, { missing: false });
  const marked = list.punches.some((row) => text.mark[row.placement] !== "");
  return <div className="punch-list" data-testid="verdict-punches">
    {summary.map((line) => <p key={line} className="punch-note">! {line}</p>)}
    {list.punches.length === 0 ? <p>{text.noPunches}</p> : <>
      <ol className="punches" aria-label={text.table}>
        {list.punches.map((row) => <li key={row.order} data-placement={row.placement}>
          <span>{text.mark[row.placement]}{row.code}</span> <span>{punchTimeText(row, list.raceDate, timeZone)}</span>
        </li>)}
      </ol>
      {marked ? <p className="punch-legend">{text.legend}</p> : null}
    </>}
  </div>;
}
