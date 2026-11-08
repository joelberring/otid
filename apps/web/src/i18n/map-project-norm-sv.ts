import { plural } from "./plural";

/** Normkontrollen i kartprojektets editor (ISOM 2017-2:s minimimått). */
export const mapProjectNormSv = {
  heading: "Normkontroll",
  toggle: "Visa normfel på kartan",
  help: "Kartans objekt mot ISOM 2017-2:s grafiska minimimått (avsnitt 2.11.3 och symbolernas mått). Kontrollen visar var något bör ses över och ändrar inget.",
  standard: (standard: "ISOM" | "ISSPROM", factor: number) => standard === "ISSPROM"
    ? "Sprintkarta: bara de allmänna avstånden kontrolleras (ISSprOM 2019-2:s symbolmått kommer senare)."
    : factor === 1 ? "ISOM 2017-2, grundskalan 1:15 000." : `ISOM 2017-2, förstorad karta: måtten × ${factor.toLocaleString("sv-SE")}.`,
  computing: "Kontrollerar …",
  none: "Inga normfel hittades.",
  count: (count: number, truncated: boolean) => `${plural(count, "ställe", "ställen")}${truncated ? " (fler finns)" : ""} att se över.`,
  rules: {
    CONTOUR_GAP: "Kurvor för nära varandra",
    SHORT_LINE: "För kort fristående linje",
    SMALL_AREA: "För liten yta",
    THIN_AREA: "Mycket smal yta",
    SMALL_CLOSED: "För liten kulle eller sänka"
  },
  detail: (rule: string, code: string, value: number, limit: number) => {
    const n = (x: number) => x.toLocaleString("sv-SE", { maximumFractionDigits: 2 });
    return rule === "SMALL_AREA" ? `${code}: ${n(value)} mm², minst ${n(limit)} mm²` : rule === "CONTOUR_GAP"
      ? `${code}: ${n(value)} mm mitt till mitt, minst ${n(limit)} mm` : `${code}: ${n(value)} mm, minst ${n(limit)} mm`;
  },
  show: "Visa",
  more: (count: number) => `och ${plural(count, "till", "till")}`
} as const;
