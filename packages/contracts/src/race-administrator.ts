import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const raceAdministratorLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(/^otid_org_race_admin_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/)
}).strict();

/** Funktionärens credential delas bara ut dolt till ett konto (ADR-0172 beslut 3); schemat finns för tester och kontroll. */
export const raceFunctionaryLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(/^otid_org_race_functionary_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/)
}).strict();

export const raceAdministratorLoginResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid,
  /** MANAGE_RACE: administratör. RACE_FUNCTIONARY: funktionär (ADR-0172 beslut 3). */
  capability: z.enum(["MANAGE_RACE", "RACE_FUNCTIONARY"]),
  expiresAt: z.iso.datetime({ offset: true })
}).strict();

export type RaceAdministratorLoginRequest = z.infer<typeof raceAdministratorLoginRequestSchema>;
export type RaceAdministratorLoginResponse = z.infer<typeof raceAdministratorLoginResponseSchema>;
