/**
 * Förslag B (ägaren 2026-11-18): linjeikonerna i flikraden och i Mitt O-Tids fyra val i telefonbredd. Dekorativa (namnet står
 * alltid som text bredvid); färgen är `currentColor`.
 */
export type AppIconName = "home" | "map" | "course" | "event" | "club";

const PATHS: Record<AppIconName, React.ReactNode> = {
  home: <><path d="M4 11 12 4l8 7" /><path d="M6 10v9h12v-9" /></>,
  map: <><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" /><path d="M9 4v13.5" /><path d="M15 6.5V20" /></>,
  course: <><path d="M3 20 6.5 13.5 10 20z" /><circle cx="18" cy="6" r="3" /><path d="m9 15 7-7" /></>,
  event: <><circle cx="12" cy="13.5" r="7" /><path d="M12 10v3.5l2.2 1.6" /><path d="M10 3h4" /><path d="M12 3v3.5" /></>,
  club: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5c.5-3.4 2.8-5.2 6-5.2s5.5 1.8 6 5.2" /><path d="M16 5.6a3.2 3.2 0 0 1 0 5.8" />
    <path d="M18 14.8c1.7.7 2.7 2.3 3 4.7" /></>
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
