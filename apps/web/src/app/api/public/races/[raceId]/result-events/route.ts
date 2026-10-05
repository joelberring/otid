import { createPublicResultEventStream, publicResultEventStreamStatus } from "../../../../../../lib/public-result-event-stream";
import { hiddenRaceResponse } from "../../../../../../lib/public-race-gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const hidden = await hiddenRaceResponse(raceId);
  if (hidden) return hidden;
  const lastEventId = request.headers.get("last-event-id");
  const status = await publicResultEventStreamStatus(raceId, lastEventId);
  if (status.status === "not-found") return new Response(null, { status: 404 });
  return new Response(createPublicResultEventStream(request, raceId, lastEventId), {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no"
    }
  });
}
