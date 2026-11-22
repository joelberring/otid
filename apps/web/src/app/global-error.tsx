"use client";

import { ErrorPage, useBrowserLanguage } from "../components/error-page";

/** Fel i själva rotlayouten: ersätter hela dokumentet, så `html` och `body` ritas här. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const language = useBrowserLanguage();
  return <html lang={language}><body><ErrorPage error={error} reset={reset} language={language} /></body></html>;
}
