import { GROUP_CODE_PATTERN } from "./training-group";

/**
 * Översynen av startsidan 2026-11-17: fältet "Har du en kod?". Koden är en tävlings eller fests korta adress (/t/<kod>,
 * /fest/<kod>) eller en träningsgrupps (/g/<kod>). Här tolkas det som skrevs eller klistrades in, utan I/O.
 */

/** Tävlingens korta kod: sex tecken a–z och 2–9 utan de lätt förväxlade i, l, o, 0 och 1 (databasens `race_short_code_check`). */
export const RACE_SHORT_CODE_PATTERN = /^[2-9a-hjkmnp-z]{6}$/;

export type JoinCode = { readonly kind: "race" | "group"; readonly code: string };

/** Längre än så är det inte en kod eller en adress till en (gruppens kod är högst 40 tecken). */
const MAX_INPUT = 300;
const PREFIXES: Readonly<Record<string, JoinCode["kind"]>> = { t: "race", fest: "race", g: "group" };

/**
 * Koden ur det som skrevs: versaler blir gemener och blanksteg tas bort (koderna är skiftlägesokänsliga och har inga blanksteg),
 * telefonens tankstreck blir bindestreck, och en hel adress (`https://otid.berring.se/t/abc234`, `otid.berring.se/g/…`,
 * `/fest/…/qr`) ger koden efter /t/, /fest/ eller /g/. Värden spelar ingen roll: bara koden används, aldrig adressen.
 * Undefined när det inte kan vara en kod.
 */
export function normalizeJoinCode(input: string): JoinCode | undefined {
  const value = input.slice(0, MAX_INPUT).normalize("NFKC").toLowerCase().replace(/\s+/g, "")
    .replace(/[‐-―−]/g, "-").replace(/^[<"'([]+|[>"')\].,;:!?]+$/g, "");
  if (!value) return undefined;
  if (value.includes("/")) {
    const segments = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[?#].*$/, "").split("/").filter(Boolean);
    const at = segments.findIndex((segment, index) => Object.hasOwn(PREFIXES, segment) && index + 1 < segments.length);
    if (at < 0) return undefined;
    return classify(segments[at + 1]!, PREFIXES[segments[at]!]);
  }
  return classify(value);
}

function classify(code: string, kind?: JoinCode["kind"]): JoinCode | undefined {
  if (kind !== "group" && RACE_SHORT_CODE_PATTERN.test(code)) return { kind: "race", code };
  if (kind !== "race" && GROUP_CODE_PATTERN.test(code)) return { kind: "group", code };
  return undefined;
}
