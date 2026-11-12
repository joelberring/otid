import { db } from "../../../../../../lib/db";
import { raceClubArchiveRoute } from "../../../../../../lib/club-affiliation-route-handlers";

type Context = { params: Promise<{ raceId: string }> };

/**
 * ADR-0209 beslut 4: arrangörsklubben (PUT), "Lägg i klubbarkivet" (POST), "Ta ur klubbarkivet" (DELETE) och (ägaren 2026-11-12)
 * rutan "Lägg i klubbarkivet när träningen är klar" (PATCH).
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  return raceClubArchiveRoute(db, request, (await context.params).raceId);
}
export async function PUT(request: Request, context: Context): Promise<Response> {
  return raceClubArchiveRoute(db, request, (await context.params).raceId);
}
export async function POST(request: Request, context: Context): Promise<Response> {
  return raceClubArchiveRoute(db, request, (await context.params).raceId);
}
export async function DELETE(request: Request, context: Context): Promise<Response> {
  return raceClubArchiveRoute(db, request, (await context.params).raceId);
}
export async function PATCH(request: Request, context: Context): Promise<Response> {
  return raceClubArchiveRoute(db, request, (await context.params).raceId);
}
