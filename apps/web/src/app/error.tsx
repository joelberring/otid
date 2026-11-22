"use client";

import { ErrorPage, useBrowserLanguage } from "../components/error-page";

/** Ofångade fel i en vy under rotlayouten: felsida med «Försök igen» i stället för Next.js egen. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPage error={error} reset={reset} language={useBrowserLanguage()} />;
}
