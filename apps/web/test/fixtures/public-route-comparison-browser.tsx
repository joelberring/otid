import React from "react";
import { createRoot } from "react-dom/client";
import { PublicRouteComparison } from "../../src/components/public-route-comparison";

const mount = document.getElementById("public-comparison-test-root");
if (!mount) throw new Error("Missing public comparison test root");

createRoot(mount).render(<PublicRouteComparison
  raceId="10000000-0000-4000-8000-000000000001"
  firstPublicResultId="20000000-0000-4000-8000-000000000002"
  secondPublicResultId="30000000-0000-4000-8000-000000000003"
  {...(mount.dataset.third === "true" ? { thirdPublicResultId: "40000000-0000-4000-8000-000000000004" } : {})}
/>);
