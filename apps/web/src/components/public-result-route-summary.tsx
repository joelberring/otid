import Link from "next/link";
import type { PublicParticipantRouteViewResponse } from "@o-tid/contracts";
import React from "react";
import { publicParticipantRouteSv as text } from "../i18n/public-participant-route-sv";
import { routeDistance, routeTimingText } from "../lib/route-display";
import { PublicLinkShare } from "./public-link-share";

/** Small server-rendered signpost; route authorization remains application-owned. */
export function PublicResultRouteSummary({ route, href }: { route: PublicParticipantRouteViewResponse; href: string }) {
  return <section className="public-result-route-summary" aria-labelledby="public-route-summary-title"><div><h2 id="public-route-summary-title">{text.summaryTitle}</h2><p>{text.summaryAvailable}</p></div><dl><div><dt>{text.distance}</dt><dd>{routeDistance(route.metadata.distanceMeters)}</dd></div><div><dt>{text.points}</dt><dd>{route.metadata.pointCount}</dd></div><div><dt>{text.segments}</dt><dd>{route.metadata.segmentCount}</dd></div><div><dt>{text.recordedTime}</dt><dd>{routeTimingText(route.metadata.timing, text.timeless)}</dd></div></dl><div className="public-result-route-summary-actions"><Link className="public-result-route-summary-link" href={href}>{text.viewRoute}</Link><PublicLinkShare path={href} title={text.title} /></div></section>;
}
