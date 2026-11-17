import { redirect } from "next/navigation";

/**
 * Mastermind med kontroller är ett statiskt appskal under /mastermind/ (som avläsningen), så att det kan starta utan nät.
 * Next visar inte index.html för en mapp i public/, så den här adressen leder dit.
 */
export default function MastermindRedirect() {
  redirect("/mastermind/index.html");
}
