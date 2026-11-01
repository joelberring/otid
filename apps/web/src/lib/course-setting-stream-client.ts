import {
  courseSettingStreamBySchema as by, courseSettingStreamPresenceSchema, courseSettingStreamVersionSchema as version, type CourseSettingPresence
} from "@o-tid/contracts";

/**
 * Steg 66: editorns lyssnare på banläggningens ström (`course-setting/events`, SSE). Ett besked om ny version, notiser,
 * förslag eller arbetssätt gör att editorn hämtar det nya; närvaron visas som den är. Efter ett avbrott ansluter
 * webbläsaren igen och editorn hämtar allt en gång (något kan ha missats). Stängd ström (t.ex. 503) försöker igen om en stund.
 */
export interface CourseSettingStreamHandlers {
  readonly version: (version: number, by: string) => void;
  readonly notes: (by: string) => void;
  readonly suggestions: (by: string) => void;
  readonly mode: (by: string) => void;
  readonly inspections: (by: string) => void;
  readonly presence: (people: CourseSettingPresence) => void;
  /** Ansluten igen efter ett avbrott. */
  readonly reconnected: () => void;
}


/** Ett besked ur strömmen; okänt eller trasigt ger false. */
export function handleStreamEvent(type: string, data: string, handlers: CourseSettingStreamHandlers): boolean {
  let value: unknown;
  try { value = JSON.parse(data); } catch { return false; }
  switch (type) {
    case "version": { const parsed = version.safeParse(value); if (!parsed.success) return false; handlers.version(parsed.data.version, parsed.data.by); return true; }
    case "notes": case "suggestions": case "mode": case "inspections": {
      const parsed = by.safeParse(value);
      if (!parsed.success) return false;
      handlers[type](parsed.data.by);
      return true;
    }
    case "presence": { const parsed = courseSettingStreamPresenceSchema.safeParse(value); if (!parsed.success) return false; handlers.presence(parsed.data); return true; }
    default: return false;
  }
}

type Source = Pick<EventSource, "addEventListener" | "close" | "readyState">;

export function openCourseSettingStream(url: string, handlers: CourseSettingStreamHandlers,
  create: (url: string) => Source = value => new EventSource(value, { withCredentials: true })): () => void {
  let source: Source | undefined, retry: ReturnType<typeof setTimeout> | undefined, closed = false, failed = false;
  const connect = () => {
    if (closed) return;
    const current = create(url);
    source = current;
    for (const type of ["version", "notes", "suggestions", "mode", "inspections", "presence"]) {
      current.addEventListener(type, event => handleStreamEvent(type, (event as MessageEvent<string>).data, handlers));
    }
    current.addEventListener("open", () => { if (failed) { failed = false; handlers.reconnected(); } });
    current.addEventListener("error", () => {
      failed = true;
      if (current.readyState === 2 /* CLOSED */ && !closed) {
        current.close();
        retry = setTimeout(connect, 10_000 + Math.floor(Math.random() * 10_000));
      }
    });
  };
  connect();
  return () => { closed = true; if (retry) clearTimeout(retry); source?.close(); };
}
