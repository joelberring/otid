export const SPEAKER_BOARD_PRODUCTION_COOKIE_NAMES = {
  session: "__Host-otid-speaker-board-session",
  csrf: "__Host-otid-speaker-board-csrf"
} as const;
export const SPEAKER_BOARD_LOOPBACK_COOKIE_NAMES = {
  session: "otid_speaker_board_session",
  csrf: "otid_speaker_board_csrf"
} as const;
export type SpeakerBoardCookieNames = typeof SPEAKER_BOARD_PRODUCTION_COOKIE_NAMES | typeof SPEAKER_BOARD_LOOPBACK_COOKIE_NAMES;

export function isSpeakerBoardLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
export function speakerBoardCookieNamesForUrl(url: URL): SpeakerBoardCookieNames {
  return url.protocol === "http:" && isSpeakerBoardLoopbackHostname(url.hostname)
    ? SPEAKER_BOARD_LOOPBACK_COOKIE_NAMES : SPEAKER_BOARD_PRODUCTION_COOKIE_NAMES;
}
