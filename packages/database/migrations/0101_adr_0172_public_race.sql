-- ADR-0172 beslut 4 / PLAN.md steg 19: publicerad tävling och kort adress till tävlingssidan.
-- En tävling syns publikt när den är publicerad (published_at) och inte dold av superadmin.
-- Ingen produktionsdata finns (ADR-0168 beslut 6): befintliga tävlingar blir opublicerade.

-- Kort adress (/t/{kod}): sex tecken ur ett alfabet utan förväxlingsbara tecken (0/o, 1/i/l).
CREATE OR REPLACE FUNCTION generate_race_short_code() RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet constant text := '23456789abcdefghjkmnpqrstuvwxyz';
  candidate text;
BEGIN
  LOOP
    candidate := '';
    FOR position IN 1..6 LOOP
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM race WHERE short_code = candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE race ADD COLUMN published_at timestamptz;
ALTER TABLE race ADD COLUMN short_code text;
UPDATE race SET short_code = generate_race_short_code();
ALTER TABLE race ALTER COLUMN short_code SET DEFAULT generate_race_short_code();
ALTER TABLE race ALTER COLUMN short_code SET NOT NULL;
ALTER TABLE race ADD CONSTRAINT race_short_code_check CHECK (short_code ~ '^[2-9a-hjkmnp-z]{6}$');
CREATE UNIQUE INDEX race_short_code_uidx ON race (short_code);
