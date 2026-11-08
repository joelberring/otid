import { db } from "../../../../../../lib/db";
import { clubDevicesRoute } from "../../../../../../lib/club-device-route-handlers";

type Context = { params: Promise<{ clubId: string }> };

/** Ägaren 2026-11-08: klubbens enhetsregister (GET listan, POST spara efter utläsning, PUT anteckning, DELETE ta bort). */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubDevicesRoute(db, request, clubId);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubDevicesRoute(db, request, clubId);
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubDevicesRoute(db, request, clubId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { clubId } = await context.params;
  return clubDevicesRoute(db, request, clubId);
}
