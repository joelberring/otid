import { clubRequest } from "./club-archive-client";

/** ADR-0209: som `clubRequest`, men ett nätfel blir status 0 i stället för ett undantag (knapparna låses aldrig upp annars). */
export async function affiliationRequest(path: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: unknown)
  : Promise<{ status: number; json: unknown }> {
  try { return await clubRequest(path, method, body); } catch { return { status: 0, json: undefined }; }
}
