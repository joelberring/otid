/** Okänd bricka (PLAN.md steg 25, 29): direktanmälan eller koppling till en anmäld deltagare, köat som avläsningarna. */
import { useMemo, type MutableRefObject } from "react";
import type { ReadoutPackage } from "@o-tid/contracts";
import { searchRunnerDatabase } from "./api";
import type { ReadoutStore } from "./store";
import type { RegistrationFields } from "./registration-form";
import type { EntrySuggestion } from "./runner-lookup";
import type { Current } from "./verdict-panel";

export function useReadoutRegistration({ raceId, current, storeRef, reload, sync, online, pkg }: { raceId: string | undefined;
  current: Current | undefined; storeRef: MutableRefObject<ReadoutStore>; reload: () => Promise<void>; sync: () => Promise<void>;
  online: boolean; pkg: ReadoutPackage | undefined }) {
  async function register(fields: RegistrationFields, borrowedCard = false) {
    if (!raceId || current?.phase !== "done") return;
    const requestId = crypto.randomUUID();
    await storeRef.current.addRegistration({ raceId, requestId, localSequence: current.localSequence, createdAt: new Date().toISOString(),
      status: "pending", request: { formatVersion: 1, requestId, cardNumber: current.cardNumber, classId: fields.classId,
        givenName: fields.givenName.trim(), familyName: fields.familyName.trim(), organisationName: fields.club.trim() || null,
        ...(fields.eventorPersonId ? { eventorPersonId: fields.eventorPersonId } : {}),
        ...(fields.eventorOrganisationId ? { eventorOrganisationId: fields.eventorOrganisationId } : {}),
        ...(borrowedCard ? { borrowedCard: true as const } : {}) } });
    await reload();
    void sync();
  }

  /** PLAN.md steg 29: koppla den okända brickan till en anmäld deltagare, köat som en anmälan (även offline). */
  async function linkEntry(entry: Pick<EntrySuggestion, "entryId" | "classId" | "name" | "className">, borrowedCard = false) {
    if (!raceId || current?.phase !== "done") return;
    const requestId = crypto.randomUUID();
    await storeRef.current.addRegistration({ raceId, requestId, localSequence: current.localSequence, createdAt: new Date().toISOString(),
      status: "pending", display: { entryName: entry.name, className: entry.className },
      request: { formatVersion: 1, requestId, cardNumber: current.cardNumber, target: "EXISTING_ENTRY", entryId: entry.entryId,
        expectedClassId: entry.classId, ...(borrowedCard ? { borrowedCard: true as const } : {}) } });
    await reload();
    void sync();
  }
  // Hela landets löpare söks på servern när nätet finns; annars räcker paketets klubbar.
  const searchServer = useMemo(() => raceId && online && pkg?.runnerLookup?.wholeCountryOnServer
    ? (request: Parameters<typeof searchRunnerDatabase>[1]) => searchRunnerDatabase(raceId, request) : undefined,
  [raceId, online, pkg?.runnerLookup?.wholeCountryOnServer]);
  return { register, linkEntry, searchServer };
}
