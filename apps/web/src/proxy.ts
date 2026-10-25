import { NextResponse, type NextRequest } from "next/server";
import { pageContentSecurityPolicy } from "./lib/content-security-policy";

/**
 * PLAN.md steg 46: strikt CSP med nonce för Next-sidorna (publika sidor, adminsidor och kontosidorna). Next läser
 * noncen ur förfrågans Content-Security-Policy och sätter den på sina egna skript; därför renderas alla sidor dynamiskt
 * (rotlayouten väntar på förfrågan). API-rutterna, Nexts statiska filer och avläsningsskalet under /readout/ går inte hit;
 * deras huvuden står i next.config.ts och security-policy.ts.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const policy = pageContentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  matcher: [{
    source: "/((?!api/|_next/static|_next/image|readout/|favicon.ico|robots.txt).*)",
    missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }]
  }]
};
