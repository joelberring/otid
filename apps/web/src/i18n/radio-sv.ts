import type { RadioErrorCode, RadioSource } from "@o-tid/contracts";

/** Namnet på en radiokontroll: det valda namnet, annars "kontroll 31". */
export function radioControlName(code: number, label: string | null, capital = false): string {
  return label ?? `${capital ? "K" : "k"}ontroll ${code}`;
}

/** ADR-0172 beslut 5: radiokontroller via ROC eller OResults. */
export const radioSv = {
  settings: {
    title: "Radiokontroller",
    help: "Mellantider från radiokontroller i skogen via ROC eller OResults. Avläsningen i mål avgör fortfarande resultatet.",
    loading: "Hämtar radioinställningarna …",
    loadError: "Radioinställningarna kunde inte hämtas.",
    retry: "Försök igen",
    failed: "Det gick inte. Kontrollera anslutningen och försök igen.",
    sessionExpired: "Sessionen har gått ut. Ladda om sidan och logga in igen.",
    invalid: "Kontrollera enhetens id: bara bokstäver, siffror, - och _.",
    enabled: "Hämta radiostämplingar",
    enabledHelp: "Servern hämtar nya stämplingar var tionde sekund under tävlingsdagen.",
    source: "Källa",
    sources: { ROC: "ROC (roc.olresultat.se)", ORESULTS: "OResults" } satisfies Record<RadioSource, string>,
    sourceShort: { ROC: "ROC", ORESULTS: "OResults" } satisfies Record<RadioSource, string>,
    unit: "Enhetens id",
    unitHelp: "Id:t som ROC eller OResults visar för er enhet eller tävling (unitId).",
    controls: "Radiokontroller",
    controlsHelp: "Bocka för kontrollerna som skickar stämplingar. Namnet visas i listorna och hos speakern (valfritt).",
    controlLabel: (code: number) => `Kontroll ${code}`,
    controlCourses: (courses: string[]) => courses.join(", "),
    labelFor: (code: number) => `Namn på kontroll ${code}`,
    labelPlaceholder: "t.ex. Radio 1",
    noCandidates: "Lägg in banor först. Radiokontrollerna väljs bland banornas kontroller.",
    relay: "Stafettlagens löpare får inga mellantider än. Stämplingarna sparas ändå.",
    save: "Spara",
    saved: "Radioinställningarna är sparade.",
    fetchNow: "Hämta nu",
    fetched: (count: number) => count === 0 ? "Hämtat. Inga nya stämplingar." : count === 1 ? "Hämtat: 1 ny stämpling." : `Hämtat: ${count} nya stämplingar.`,
    notConfigured: "Spara inställningarna först.",
    polling: {
      OFF: "Avstängd. Inga stämplingar hämtas.",
      TODAY: "Hämtar automatiskt var tionde sekund i dag.",
      NOT_TODAY: (date: string) => `Hämtar automatiskt på tävlingsdagen (${date}). Använd Hämta nu för att prova anslutningen.`
    },
    lastFetch: (time: string) => `Senaste lyckade hämtning ${time}`,
    neverFetched: "Inget hämtat än.",
    counts: (punches: number, unknown: number, other: number) =>
      [`${punches} ${punches === 1 ? "stämpling" : "stämplingar"}`, `${unknown} med okänd bricka`,
        ...(other > 0 ? [`${other} på andra kontroller`] : [])].join(" · "),
    malformed: (count: number) => `${count} ${count === 1 ? "rad" : "rader"} från tjänsten gick inte att läsa och hoppades över.`,
    lastError: (time: string, text: string) => `Fel ${time}: ${text}`,
    retrying: (failures: number) => failures > 1 ? `${failures} försök i rad har misslyckats. Servern försöker igen med längre mellanrum.` : "",
    errors: {
      INVALID_INPUT: () => "Enhetens id eller serverns inställning för radio är fel.",
      INVALID_RESPONSE: (source: string) => `Svaret från ${source} var inte stämplingar. Kontrollera enhetens id.`,
      UPSTREAM_UNAVAILABLE: (source: string) => `${source} svarar inte just nu. Servern försöker igen.`,
      REJECTED: (source: string) => `${source} nekade anropet.`,
      NOT_FOUND: (source: string) => `${source} hittade inte enheten. Kontrollera enhetens id och källan.`,
      RESPONSE_TOO_LARGE: (source: string) => `Svaret från ${source} var för stort.`,
      TIMEOUT: (source: string) => `${source} svarade inte i tid. Servern försöker igen.`
    } satisfies Record<RadioErrorCode, (source: string) => string>,
    latestTitle: "Senaste radiostämplingar",
    unknownCard: (card: string) => `Okänd bricka ${card}`,
    latestRow: (time: string, control: string) => `${time} · ${control}`
  },
  live: {
    title: "Vid radiokontroll",
    onTheWayTitle: "Ute i skogen",
    onTheWayHelp: "Passerat en radiokontroll men inte läst av. Placeringen är preliminär.",
    passed: (control: string) => `passerat ${control}`,
    passedAt: (control: string, time: string) => `passerat ${control} ${time}`,
    clock: (time: string) => `kl. ${time}`,
    place: (place: number) => `(${place})`,
    placeLabel: (place: number) => `plats ${place} vid kontrollen`,
    finished: "i mål",
    noneFinished: "Ingen har läst av än",
    leader: (name: string, time: string) => `Ledare: ${name} ${time}`,
    controlHeading: (control: string, count: number) => `${control} · ${count} ${count === 1 ? "passerad" : "passerade"}`,
    noTime: "–",
    name: "Namn",
    time: "Tid",
    placeColumn: "Pl."
  },
  speaker: {
    latestTitle: "Senaste radiostämplingar",
    latestEmpty: "Inga radiostämplingar än.",
    leadersTitle: (control: string) => `Ledare vid ${control}`,
    onTheWay: "på väg in"
  },
  hub: {
    title: "Radiokontroller live",
    help: "Mellantider från skogen i resultatlistan."
  }
} as const;
