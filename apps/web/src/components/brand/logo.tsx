import { LOGO_TEXT_PATH } from "./logo-glyphs";

/**
 * O-Tid-loggan: en ring med "tid" i mitten. Ringen är O:et i O-Tid och en kontrollring. Texten är kontur
 * (`scripts/logo/generate.py`), så loggan laddar inget typsnitt. Färgen är `currentColor`; sidhuvudena sätter
 * `--logo` (tokens.css). Dekorativ: namnet "O-Tid" står alltid bredvid som text.
 */
export function Logo({ size, className }: { size: number; className?: string | undefined }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="10" />
    <path fill="currentColor" d={LOGO_TEXT_PATH} />
  </svg>;
}
