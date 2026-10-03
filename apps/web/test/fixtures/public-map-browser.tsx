import React from "react";
import { createRoot } from "react-dom/client";
import { PublicMapViewer } from "../../src/components/public-map-viewer";

const mount = document.getElementById("public-map-test-root");
if (!mount) throw new Error("Missing public map test root");

createRoot(mount).render(<PublicMapViewer
  raceId="10000000-0000-4000-8000-000000000001"
  title="Syntetisk orienteringskarta"
/>);
