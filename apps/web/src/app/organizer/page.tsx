import { OrganizerWorkspace } from "../../components/organizer-workspace";
import { googleLoginEnabled } from "../../lib/google-login-enabled";

// ADR-0205: knappen "Logga in med Google" följer serverns miljö när sidan visas, inte när avbildningen byggs.
export const dynamic = "force-dynamic";

export default function OrganizerPage() {
  return <OrganizerWorkspace googleEnabled={googleLoginEnabled()} />;
}
