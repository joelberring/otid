import { readPublicRaceMapImage, readPublicRaceMapImageHead, streamMapContentParts, type PublicRaceMapImageHead } from "@o-tid/application";
import type { Database } from "@o-tid/database";
import { bufferView, matchesIfNoneMatch } from "./http-etag";
import { logServerError } from "./server-error-log";

type PublicRaceMapRouteDeps = {
  readonly readHead: (db: Database, raceId: string) => Promise<PublicRaceMapImageHead | undefined>;
  readonly readInline: (db: Database, raceId: string) => Promise<{ mediaType: string; image: Buffer; sha256: string } | undefined>;
  readonly streamParts: (db: Database, contentId: string) => AsyncGenerator<Uint8Array>;
};

const defaultDeps: PublicRaceMapRouteDeps = {
  readHead: readPublicRaceMapImageHead,
  readInline: readPublicRaceMapImage,
  streamParts: streamMapContentParts
};

/**
 * Kartbilden för vägvalen (PLAN.md steg 16):
 * - Kontrollerar weak-normaliserad `If-None-Match` på metadata före byte-läsning (304 utan 30 MB läsning).
 * - Strömmar via `streamMapContentParts` (1 MiB-delar) när `contentId` finns, annars zero-copy `bufferView`.
 */
export async function publicRaceMapResponse(
  db: Database,
  request: Request,
  raceId: string,
  deps: PublicRaceMapRouteDeps = defaultDeps
): Promise<Response> {
  const head = await deps.readHead(db, raceId);
  if (!head) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  const etag = `"${head.sha256}"`;
  const version = new URL(request.url).searchParams.get("v");
  const baseHeaders: Record<string, string> = {
    "content-type": head.mediaType,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'",
    etag,
    "cache-control": version === head.sha256.slice(0, 16) ? "public, max-age=31536000, immutable" : "public, max-age=60"
  };
  if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers: baseHeaders });
  }
  if (head.contentId !== null) {
    const parts = deps.streamParts(db, head.contentId);
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await parts.next();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) {
          logServerError("public-race-map", "stream", error);
          controller.error(error);
        }
      },
      async cancel() {
        await parts.return(undefined);
      }
    });
    return new Response(stream, { headers: { ...baseHeaders, "content-length": String(head.byteLength) } });
  }
  const map = await deps.readInline(db, raceId);
  if (!map) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(bufferView(map.image), { headers: { ...baseHeaders, "content-length": String(map.image.byteLength) } });
}
