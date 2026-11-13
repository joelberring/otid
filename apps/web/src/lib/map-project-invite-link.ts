import {
  mapProjectClubMembersResponseSchema, mapProjectJoinLinkCreatedSchema, mapProjectJoinRoleSchema, passwordResetTokenSchema,
  type MapProjectClubMembersResponse
} from "@o-tid/contracts";

/** Rollerna en länk kan ge (aldrig Ägare). */
export const mapProjectJoinLinkRoles = mapProjectJoinRoleSchema.options;

/** Länken som skickas: sidan /kartlank med nyckeln efter # (så att den inte hamnar i serverloggar eller Referer). */
export const mapProjectJoinUrl = (origin: string, token: string): string => `${origin}/kartlank#token=${token}`;

export const parseClubMembers = (json: unknown): MapProjectClubMembersResponse | undefined => {
  const parsed = mapProjectClubMembersResponseSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
};
export const parseJoinLinkCreated = (json: unknown): { token: string } | undefined => {
  const parsed = mapProjectJoinLinkCreatedSchema.safeParse(json);
  return parsed.success ? { token: parsed.data.token } : undefined;
};

/** Nyckeln ur adressens #token=… (undefined om den saknas eller har fel form). */
export function tokenFromHash(hash: string): string | undefined {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token && passwordResetTokenSchema.safeParse(token).success ? token : undefined;
}
