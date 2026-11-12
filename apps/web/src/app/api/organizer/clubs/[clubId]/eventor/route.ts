import { db } from "../../../../../../lib/db";
import { clubEventorRoute } from "../../../../../../lib/club-affiliation-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** ADR-0209: Koppla till Eventor / Byt nyckel (PUT), Ta bort kopplingen (DELETE), Hämta medlemmar nu (POST), Byt namn (PATCH). */
export async function PUT(request: Request, context: Context): Promise<Response> {
  return clubEventorRoute(db, request, (await context.params).clubId);
}
export async function DELETE(request: Request, context: Context): Promise<Response> {
  return clubEventorRoute(db, request, (await context.params).clubId);
}
export async function POST(request: Request, context: Context): Promise<Response> {
  return clubEventorRoute(db, request, (await context.params).clubId);
}
export async function PATCH(request: Request, context: Context): Promise<Response> {
  return clubEventorRoute(db, request, (await context.params).clubId);
}
