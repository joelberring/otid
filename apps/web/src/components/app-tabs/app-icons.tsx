/**
 * Förslag B (ägaren 2026-11-18): linjeikonerna i flikraden och i Mitt O-Tids fyra val i telefonbredd. Dekorativa (namnet står
 * alltid som text bredvid); färgen är `currentColor`.
 */
export type AppIconName = "home" | "map" | "course" | "event" | "club" | "classes" | "entries" | "publish" | "readout" | "secretariat" |
  "results" | "speaker" | "party" | "exercise" | "more";

const PATHS: Record<AppIconName, React.ReactNode> = {
  home: <><path d="M4 11 12 4l8 7" /><path d="M6 10v9h12v-9" /></>,
  map: <><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" /><path d="M9 4v13.5" /><path d="M15 6.5V20" /></>,
  course: <><path d="M3 20 6.5 13.5 10 20z" /><circle cx="18" cy="6" r="3" /><path d="m9 15 7-7" /></>,
  event: <><circle cx="12" cy="13.5" r="7" /><path d="M12 10v3.5l2.2 1.6" /><path d="M10 3h4" /><path d="M12 3v3.5" /></>,
  club: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5c.5-3.4 2.8-5.2 6-5.2s5.5 1.8 6 5.2" /><path d="M16 5.6a3.2 3.2 0 0 1 0 5.8" />
    <path d="M18 14.8c1.7.7 2.7 2.3 3 4.7" /></>,
  // Tävlingsraden (ADR-0227 tillägg 2026-11-18).
  classes: <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h10" /></>,
  entries: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5c.5-3.4 2.8-5.2 6-5.2s5.5 1.8 6 5.2" /><path d="M17 8v6" /><path d="M14 11h6" /></>,
  publish: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /><path d="M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5" />
    <path d="M12 3.5C9.7 5.9 8.6 8.7 8.6 12s1.1 6.1 3.4 8.5" /></>,
  readout: <><rect x="5" y="3" width="14" height="18" rx="2.5" /><circle cx="12" cy="9" r="2.5" /><path d="M9 16h6" /></>,
  secretariat: <><path d="M5 4h14v16H5z" /><path d="M9 9h6" /><path d="M9 13h6" /><path d="M9 17h3" /></>,
  results: <><path d="M5 20V11" /><path d="M12 20V4" /><path d="M19 20v-6" /></>,
  speaker: <><path d="M4 10v4h3l5 4V6l-5 4z" /><path d="M16 9a4 4 0 0 1 0 6" /><path d="M18.5 6.5a8 8 0 0 1 0 11" /></>,
  party: <><path d="M6 4h12l-6 8z" /><path d="M12 12v7" /><path d="M8.5 20h7" /></>,
  exercise: <><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></>,
  more: <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>
};

export function AppIcon({ name, size = 24, className }: { name: AppIconName; size?: number; className?: string | undefined }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{PATHS[name]}</svg>;
}

/** Pilen i Mitt O-Tids listrader i telefonbredd. */
export function ChevronIcon({ className }: { className?: string | undefined }) {
  return <svg className={className} width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m9 6 6 6-6 6" /></svg>;
}

/** Pilen bakåt i tävlingens överrad («‹ Mitt O-Tid»). */
export function BackIcon({ className }: { className?: string | undefined }) {
  return <svg className={className} width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m15 6-6 6 6 6" /></svg>;
}
