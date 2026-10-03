import {
  authenticateStationBearer,
  buildSignedStationPackage,
  hasStationCredentialScope
} from "@o-tid/application";
import { signedStationPackageEnvelopeSchema } from "@o-tid/contracts";
import { db } from "../../../../../lib/db";
import {
  privateStationHeaders,
  stationForbidden,
  stationUnauthorized
} from "../../../../../lib/station-auth-response";

function serverConfiguration(): { privateKeyPem: string } | undefined {
  const privateKeyPem = process.env.O_TID_PACKAGE_SIGNING_PRIVATE_KEY_PEM;
  if (!privateKeyPem) return undefined;
  return { privateKeyPem };
}

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const authentication = await authenticateStationBearer(db, request.headers.get("authorization"));
  if (authentication.status === "unauthorized") return stationUnauthorized();
  if (!hasStationCredentialScope(authentication.principal, { raceId, scope: "READOUT" })) {
    return stationForbidden();
  }

  const configuration = serverConfiguration();
  if (!configuration) {
    return Response.json({ error: "Tävlingspaket är inte konfigurerade" }, {
      status: 503,
      headers: privateStationHeaders
    });
  }
  try {
    const envelope = await buildSignedStationPackage(db, raceId, configuration.privateKeyPem);
    return Response.json(signedStationPackageEnvelopeSchema.parse(envelope), { headers: privateStationHeaders });
  } catch (error) {
    if (error instanceof Error && error.message === "Loppet finns inte") {
      return Response.json({ error: "Loppet finns inte" }, { status: 404, headers: privateStationHeaders });
    }
    return Response.json({ error: "Tävlingspaketet kunde inte skapas" }, {
      status: 500,
      headers: privateStationHeaders
    });
  }
}
