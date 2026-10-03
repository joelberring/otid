import { db } from "../../../../../lib/db";
import {
  participantPublicResultFollowListRoute,
  participantPublicResultFollowSetRoute
} from "../../../../../lib/participant-public-result-follow-route-handlers";

export async function GET(request: Request): Promise<Response> {
  return participantPublicResultFollowListRoute(db, request);
}

export async function POST(request: Request): Promise<Response> {
  return participantPublicResultFollowSetRoute(db, request);
}
