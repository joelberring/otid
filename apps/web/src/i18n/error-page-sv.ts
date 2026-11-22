/** Felsidorna (`app/error.tsx`, `app/global-error.tsx`): något oväntat gick fel i webbläsaren. */
export const errorPageSv = {
  title: "Något gick fel",
  body: "Sidan kunde inte visas. Det du redan sparat finns kvar. Försök igen, eller gå tillbaka till startsidan.",
  retry: "Försök igen",
  home: "Till startsidan",
  code: (digest: string) => `Felkod: ${digest}`
} as const;
