-- Demoläget del 2 (ägaren 2026-11-09): ett tillfälligt gästkonto provar arbetsytan på en egen övningstävling med påhittade
-- löpare. `guest_expires_at` satt = gästkonto. Gästen släpps bara in på sin egen tävling (inte på kontots sidor), kan inte
-- publicera, dela kartlänkar eller mejla inbjudningar, och kontot tas bort med tävlingen av underhållet när tiden gått ut.
ALTER TABLE "user_account" ADD COLUMN IF NOT EXISTS "guest_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_account_guest_expires_idx" ON "user_account" ("guest_expires_at") WHERE "guest_expires_at" IS NOT NULL;
