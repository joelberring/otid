/**
 * Hur loppets namn visas bredvid evenemangets. Ett evenemang med ett enda lopp har oftast inget eget loppnamn (""),
 * och då visas bara evenemangets namn: "Natt-KM", inte "Natt-KM · Lopp 1". Ett loppnamn som är detsamma som
 * evenemangets visas inte heller två gånger. Alla rubriker, listor, utskrifter och kvitton använder samma regel.
 */

/** Loppets namn när det ska visas, annars undefined (tomt eller samma som evenemangets). */
export function shownRaceName(eventName: string, raceName: string): string | undefined {
  const name = raceName.trim();
  return name && name !== eventName.trim() ? name : undefined;
}

/** Delarna i ordning utan tomma, ihopfogade med avgränsaren. */
export function joinRaceParts(parts: readonly (string | null | undefined)[], separator = " · "): string {
  return parts.filter((part): part is string => !!part && part.trim() !== "").join(separator);
}

/** Evenemangets namn och, när det finns, loppets: "Natt-KM · Etapp 1" eller bara "Natt-KM". */
export function raceTitle(eventName: string, raceName: string, separator = " · "): string {
  return joinRaceParts([eventName, shownRaceName(eventName, raceName)], separator);
}

/** Raden under evenemangets rubrik: loppets namn (när det visas) följt av övriga delar, t.ex. datum och typ. */
export function raceDetails(eventName: string, raceName: string, rest: readonly (string | null | undefined)[],
  separator = " · "): string {
  return joinRaceParts([shownRaceName(eventName, raceName), ...rest], separator);
}
