import { useEffect, useRef, useState } from "react";
import { raceNavigationResponseSchema, type RaceNavigationResponse } from "@o-tid/contracts";
import { RaceNarrowBar } from "../components/app-tabs/race-sheet";
import { autoRaceMode, parseRaceMode, raceModeStorageKey, raceNavigation, type RaceMode, type RaceNavItem } from "../lib/race-tabs";

/**
 * Tävlingsraden (ADR-0227 tillägg 2026-11-18): avläsningens smala rad i telefonbredd – funktionens namn och Byt funktion med samma
 * val som arrangemangets rad. Rollen hämtas från servern (`administrator/navigation`); utan svar (inget nät, ingen roll) visar listan bara vägen
 * till Mitt O-Tid. Med ansluten station öppnas valen i en ny flik (steg 35), så att stationen inte kopplas från.
 * Beskedet, statusraden och knapparna i avläsningen rörs inte.
 */
export function ReadoutRaceSwitch({ raceId, party, connected }: { raceId: string; party: boolean; connected: boolean }) {
  return <RaceSwitch raceId={raceId} connected={connected}
    current={{ key: "readout", label: party ? "PARTY_DESK" : "READOUT_STATION", href: `/admin/${raceId}/readout` }} />;
}

/**
 * Den smala raden för ett statiskt skal i arrangemanget (avläsningen, Mastermind med kontroller). `current` är skalets egen rad
 * när servern inte svarar; `onContext` får arrangemangets namn när svaret kommer.
 */
export function RaceSwitch({ raceId, current: fallback, connected, onContext }: {
  raceId: string; current: RaceNavItem; connected: boolean; onContext?: ((context: RaceNavigationResponse) => void) | undefined;
}) {
  const [items, setItems] = useState<readonly RaceNavItem[]>([]);
  const onContextRef = useRef(onContext);
  useEffect(() => { onContextRef.current = onContext; }, [onContext]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/admin/races/${encodeURIComponent(raceId)}/administrator/navigation`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const value = raceNavigationResponseSchema.parse(await response.json());
        if (value.raceId !== raceId) return;
        onContextRef.current?.(value);
        // Läget som valts i arrangemanget i den här fliken, annars det automatiska; lägets flikar först, som i raden.
        const nav = raceNavigation(value, storedMode(raceId) ?? autoRaceMode(value.raceDate, value.timeZone, new Date()));
        setItems([...nav.tabs, ...nav.more]);
      })
      // Utan nät finns bara Mitt O-Tid i listan; skalet fungerar som förut.
      .catch((error: unknown) => { if (!controller.signal.aborted) console.warn("Tävlingens meny kunde inte hämtas", error); });
    return () => controller.abort();
  }, [raceId]);
  const current: RaceNavItem = items.find(item => item.key === fallback.key) ?? fallback;
  return <RaceNarrowBar current={current} items={items} newTab={connected} />;
}

function storedMode(raceId: string): RaceMode | undefined {
  try { return parseRaceMode(window.sessionStorage.getItem(raceModeStorageKey(raceId))); }
  catch { return undefined; }
}
