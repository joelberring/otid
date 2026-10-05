import { publicRaceSv } from "../../../../../i18n/public-race-sv";
import { RaceNotPublished } from "../../../../../components/public-race/race-not-published";

/** Resultatet finns inte, eller så är tävlingen inte publicerad (ADR-0172 beslut 4); aldrig tävlingens namn. */
export default function NotFound() {
  return <RaceNotPublished title={publicRaceSv.resultNotFound.title} help={publicRaceSv.resultNotFound.help} />;
}
