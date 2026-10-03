import { ParticipantPrivateRouteDetail } from "../../../../components/participant-private-route-detail";

export const dynamic = "force-dynamic";

export default async function ParticipantPrivateRoutePage({ params }: { params: Promise<{ routeUploadId: string }> }) {
  const { routeUploadId } = await params;
  return <ParticipantPrivateRouteDetail routeUploadId={routeUploadId} />;
}
