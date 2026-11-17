import type { MapSourceCredentialView } from "@o-tid/contracts";

/**
 * Översynen av första kartan 2026-11-17 (ägaren: beskrivningen av Lantmäteriet «kommer upp för de som försöker göra en karta
 * utan fungerande api-koppling»). Den rena logiken för vilket besked som visas, ur det som redan finns: kontots uppgifter
 * (`GET /api/account/map-sources/lantmateriet`, aldrig uppgifterna själva) och serverns felkod vid en hämtning.
 *
 * Kontots läge:
 * - `unknown`: inte läst än (eller gick inte att läsa); inget besked.
 * - `connected`: uppgifter sparade och läsbara. Om Lantmäteriet godtar dem syns först vid en hämtning.
 * - `missing`: inga uppgifter sparade.
 * - `unreadable`: sparade, men serverns nyckel har bytts sedan dess (spara igen).
 * - `server`: installationen kan inte spara eller öppna uppgifter (masternyckeln saknas i driften).
 */
export type LantmaterietLink = "unknown" | "connected" | "missing" | "unreadable" | "server";

export function lantmaterietLink(view: MapSourceCredentialView | undefined): LantmaterietLink {
  if (!view) return "unknown";
  if (!view.available) return "server";
  if (!view.saved) return "missing";
  return view.saved.readable ? "connected" : "unreadable";
}

/**
 * Varför en hämtning från Lantmäteriet inte gick, som ett lugnt besked:
 * - `missing`, `unreadable`, `server`: uppgifterna gick inte att använda (felkoden `SOURCE_NO_CREDENTIAL`, eller kontots läge
 *   innan man tryckt); kontots läge säger vilket.
 * - `rejected`: Lantmäteriet svarade nej (`SOURCE_REJECTED` vid sökningen, `REJECTED` när en ortofotobild hämtas). Det är antingen
 *   fel uppgifter eller en produkt som inte är beställd: Lantmäteriet svarar 401/403 i båda fallen och O-Tid kan inte skilja dem.
 * Andra fel (för stort område, strypning, Lantmäteriet svarar inte) är inget kopplingsfel; då `undefined`.
 */
export type LantmaterietProblem = Exclude<LantmaterietLink, "unknown" | "connected"> | "rejected";

export function lantmaterietProblem(code: string | undefined, view: MapSourceCredentialView | undefined): LantmaterietProblem | undefined {
  if (code === "SOURCE_REJECTED" || code === "REJECTED") return "rejected";
  if (code !== "SOURCE_NO_CREDENTIAL") return undefined;
  const link = lantmaterietLink(view);
  return link === "unreadable" || link === "server" ? link : "missing";
}

/** Kontots läge innan man tryckt: ett besked bara när det redan syns att hämtningen inte kan gå. */
export function lantmaterietGap(view: MapSourceCredentialView | undefined): LantmaterietProblem | undefined {
  const link = lantmaterietLink(view);
  return link === "unknown" || link === "connected" ? undefined : link;
}

/** Vilken produkt som hämtades, så att beskedet om en nekad hämtning nämner rätt produkt. */
export type LantmaterietProduct = "laser" | "ortho";

/** Var uppgifterna läggs in (Mitt konto, delen Lantmäteriet). */
export const LANTMATERIET_ACCOUNT_HREF = "/konto#konto-lantmateriet";
/** Hjälpartikeln «Så kopplar du Lantmäteriet». */
export const LANTMATERIET_HELP_ARTICLE = "lantmateriet-koppla";
