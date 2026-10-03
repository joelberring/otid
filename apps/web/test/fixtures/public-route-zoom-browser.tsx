import React from "react";
import { createRoot } from "react-dom/client";
import { PublicParticipantRoute } from "../../src/components/public-participant-route";

const mount = document.getElementById("public-route-test-root");
if (!mount) throw new Error("Missing public route test root");

createRoot(mount).render(<PublicParticipantRoute
  raceId="10000000-0000-4000-8000-000000000001"
  publicResultId="20000000-0000-4000-8000-000000000002"
/>);
