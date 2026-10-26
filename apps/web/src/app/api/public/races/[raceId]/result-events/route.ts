import { createPublicResultEventStream, publicResultEventStreamStatus } from "../../../../../../lib/public-result-event-stream";
import { publicBusyResponse, publicLoad } from "../../../../../../lib/public-load";
import { accountSessionToken, publicRaceResponse } from "../../../../../../lib/public-race-gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceResponse(raceId, async () => {
    const lastEventId = request.headers.get("last-event-id");
    const status = await publicResultEventStreamStatus(raceId, lastEventId);
    if (status.status === "not-found") return new Response(null, { status: 404 });
    // Steg 54: högst OTID_PUBLIC_STREAMS_MAX öppna strömmar för publiken per instans; sidan hämtar själv tills den
    // ansluter igen (efter 10–30 s). Inloggade (speakern, arbetsytan) räknas inte.
    const signedIn = await accountSessionToken() !== null;
    const close = signedIn ? () => undefined : publicLoad().openStream();
    if (!close) return publicBusyResponse(10 + Math.floor(Math.random() * 20));
    return new Response(createPublicResultEventStream(request, raceId, lastEventId, close), {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        "connection": "keep-alive",
        "x-accel-buffering": "no"
      }
    });
  });
}
