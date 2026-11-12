import { and, eq, sql } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { consumeInvitationMailAllowance } from "./invitation-links";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0221 beslut 4 och användartestet 2026-11-12 (D): mejlet till den som får en uppgift eller blir ansvarig i
 * terminsplaneringen. Både en medlem (kontots adress) och en e-postadress får det, men inte den som ger sig själv
 * uppgiften. Samma spärr som inbjudningarna (`consumeInvitationMailAllowance`, ADR-0221 tillägg 2026-11-10): över gränsen
 * sparas ändringen utan mejl. En åtgärd ger högst ett mejl per person (veckorna till terminens slut blir ett mejl).
 */
export interface PlanTaskMail {
  readonly to: string; readonly inviterName: string; readonly clubName: string;
  /** TASK: en uppgift (`taskTitle`); RESPONSIBLE: ansvarig för träningen. */
  readonly kind: "TASK" | "RESPONSIBLE";
  readonly taskTitle: string;
  readonly sessionTitle: string; readonly sessionDate: string; readonly startTime: string | null; readonly place: string;
  /** Samma träning varje vecka: antalet tillfällen och det sista datumet. */
  readonly repeats: { readonly count: number; readonly lastDate: string } | null;
  /**
   * MEMBER: en medlem i klubben (kontot finns och är bekräftat); ACCOUNT: adressen hör till ett konto (logga in); NONE: inget
   * konto har adressen (skapa ett). Bara mottagaren ser skillnaden; svaret till den som gav uppgiften är detsamma.
   */
  readonly account: "MEMBER" | "ACCOUNT" | "NONE";
}
export type PlanTaskMailer = (mail: PlanTaskMail) => Promise<void>;

type Recipient = { readonly accountId: string } | { readonly email: string };

/** Mejlet att skicka efter att ändringen sparats, eller undefined (ingen e-post, sig själv, spärrat eller inget konto). */
export async function preparePlanMail(tx: DbExecutor, input: { actorId: string; clubId: string; recipient: Recipient; mailer: PlanTaskMailer | undefined;
  kind: PlanTaskMail["kind"]; taskTitle: string; session: { title: string; sessionDate: string; startTime: string | null; place: string };
  repeats?: PlanTaskMail["repeats"]; now: Date }): Promise<PlanTaskMail | undefined> {
  if (!input.mailer) return undefined;
  let to: string, account: PlanTaskMail["account"];
  if ("accountId" in input.recipient) {
    if (input.recipient.accountId === input.actorId) return undefined;
    const [row] = await tx.select({ email: schema.userAccounts.email }).from(schema.userAccounts)
      .where(and(eq(schema.userAccounts.id, input.recipient.accountId), sql`${schema.userAccounts.blockedAt} is null`,
        sql`${schema.userAccounts.emailVerifiedAt} is not null`));
    if (!row) return undefined;
    to = row.email; account = "MEMBER";
  } else {
    to = input.recipient.email;
    const [row] = await tx.select({ id: schema.userAccounts.id }).from(schema.userAccounts).where(eq(schema.userAccounts.email, to));
    account = row ? "ACCOUNT" : "NONE";
  }
  if (!await consumeInvitationMailAllowance(tx, { issuedBy: input.actorId, email: to, now: input.now })) return undefined;
  const [facts] = await tx.select({ inviterName: schema.userAccounts.displayName, clubName: schema.clubs.name }).from(schema.userAccounts)
    .innerJoin(schema.clubs, eq(schema.clubs.id, input.clubId)).where(eq(schema.userAccounts.id, input.actorId));
  return { to, inviterName: facts?.inviterName ?? "", clubName: facts?.clubName ?? "", kind: input.kind, taskTitle: input.taskTitle,
    sessionTitle: input.session.title, sessionDate: input.session.sessionDate, startTime: input.session.startTime, place: input.session.place,
    repeats: input.repeats ?? null, account };
}

/** Skickar mejlet (efter transaktionen). Mejlet är en avisering: ändringen gäller ändå. Felet loggas av mejlaren. */
export async function deliverPlanMail(mailer: PlanTaskMailer | undefined, mail: PlanTaskMail | undefined): Promise<boolean> {
  if (!mail || !mailer) return false;
  try { await mailer(mail); return true; } catch { return false; }
}
