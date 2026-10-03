import { NextResponse } from "next/server";
import { writerStopSv as text } from "./i18n/writer-stop-sv";
import { writerAdmissionClosed } from "./lib/writer-stop-admission";

// No matcher: the first installation profile pauses every HTTP path, including
// GETs with potential session side effects and static assets.
export function proxy() {
  if (writerAdmissionClosed(process.env.OTID_WRITER_STOP_PROFILE, process.env.OTID_WRITER_STOP_FILE)) {
    return new NextResponse(text.paused, {
      status: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" }
    });
  }
  return NextResponse.next();
}
