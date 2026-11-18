import { loadRaceNavigationContext } from "@o-tid/application";
import { SignedInTabBar } from "../../../components/app-tabs/signed-in-tab-bar";
import { RaceNavProvider } from "../../../components/app-tabs/race-nav";
import { RaceTabBar, RaceTopBar } from "../../../components/app-tabs/race-tab-bar";
import { db } from "../../../lib/db";
import { accountSessionToken } from "../../../lib/public-race-gate";
import { autoRaceMode, type RaceNavContext } from "../../../lib/race-tabs";

const RACE_ID = /^[0-9a-f-]{36}$/;

/**
 * Tävlingsraden (ägaren 2026-11-18, ADR-0227 tillägg): inne i ett arrangemang, för den som har en roll i det (administratör eller
 * funktionär), byts flikraden i telefonbredd mot arrangemangets egen rad. Rollen avgörs med samma serverkontroll som arbetsytans
 * anrop. Utan roll (t.ex. den som bara har banläggningen) gäller den vanliga flikraden som förut.
 */
export default async function Layout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ raceId: string }> }>) {
  const { raceId } = await params;
  const loaded = RACE_ID.test(raceId)
    ? await loadRaceNavigationContext(db, { raceId, sessionToken: await accountSessionToken() }) : undefined;
  if (!loaded) return <>{children}<SignedInTabBar /></>;
  const context: RaceNavContext = { raceId, raceType: loaded.raceType, role: loaded.role, courseSetting: loaded.courseSetting,
    bingo: loaded.bingo, eventName: loaded.eventName, raceName: loaded.raceName, raceDate: loaded.raceDate, timeZone: loaded.timeZone };
  return <RaceNavProvider context={context} autoMode={autoRaceMode(loaded.raceDate, loaded.timeZone, new Date())}>
    <RaceTopBar />{children}<RaceTabBar />
  </RaceNavProvider>;
}
