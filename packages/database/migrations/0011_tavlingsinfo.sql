-- Steg 33 (tävlingsinfo och bricka i startlistan): kort info om tävlingen och första start (bara information,
-- påverkar inte tävlingsklocka, lottning eller starttider) visas på tävlingssidan och i arbetsytan. Bricknummer i den
-- publika startlistan är påslaget som standard, även för befintliga tävlingar.
ALTER TABLE race ADD COLUMN IF NOT EXISTS public_start_list_card_numbers boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE race ADD COLUMN IF NOT EXISTS info text;
--> statement-breakpoint
ALTER TABLE race ADD COLUMN IF NOT EXISTS first_start_time text;
--> statement-breakpoint
ALTER TABLE race ADD CONSTRAINT race_info_check CHECK (info IS NULL OR char_length(info) BETWEEN 1 AND 1000);
--> statement-breakpoint
ALTER TABLE race ADD CONSTRAINT race_first_start_time_check CHECK (
  first_start_time IS NULL OR first_start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
