import React from "react";
import { sv } from "../i18n/sv";

/** Public context only; route release remains verified by the route component. */
export function PublicParticipantRouteContext({ eventName, raceName, raceDate, givenName, familyName, className }: {
  eventName: string; raceName: string; raceDate: string; givenName: string; familyName: string; className: string;
}) {
  return <section className="public-participant-route-context"><p>{eventName}</p><h1>{givenName} {familyName}</h1><p>{raceName} · {raceDate}</p><p className="muted">{sv.publicResultsClass}: {className}</p></section>;
}
