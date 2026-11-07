import { db } from "../../../../../../../lib/db";
import { mapProjectProposalRoute } from "../../../../../../../lib/map-project-proposal-route-handlers";

type Context = { params: Promise<{ projectId: string; proposalId: string }> };

/** ADR-0219 (K1): godkänn, avvisa eller dra tillbaka ett förslag (PUT). */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const { projectId, proposalId } = await context.params;
  return mapProjectProposalRoute(db, request, projectId, proposalId);
}
