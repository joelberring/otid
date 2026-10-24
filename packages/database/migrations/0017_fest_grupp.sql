-- Steg 40 (tillägg): en vara kan ha en valfri grupp, t.ex. "Drink", som statistiken summerar ("Drinkar totalt").
ALTER TABLE party_item ADD COLUMN item_group text;
--> statement-breakpoint
ALTER TABLE party_item ADD CONSTRAINT party_item_group_check CHECK (item_group IS NULL OR char_length(item_group) BETWEEN 1 AND 40);
