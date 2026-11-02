-- ADR-0194 beslut 5 och 8: klubbarkivet i kartinnehållets referenser (ADR-0189) och kartfiler upp till 100 MB.
-- Bara tillägg och ett vidgat villkor; inga rader ändras.

CREATE INDEX CONCURRENTLY IF NOT EXISTS training_group_map_club_map_idx ON training_group_map (club_map_id) WHERE club_map_id IS NOT NULL;

-- Mapper-filer blir stora (ägarens största är 72 MB). Delarna (högst 101 st om 1 MiB) räcker redan. Tävlingens kartfil har kvar
-- sin gräns på 60 MB i koden.
ALTER TABLE map_content DROP CONSTRAINT IF EXISTS map_content_size_check;
ALTER TABLE map_content ADD CONSTRAINT map_content_size_check CHECK (byte_length BETWEEN 1 AND 104857600);

-- Innehållet som arkivet pekar på tas inte bort när den sista tävlingen eller biblioteksbilden som använder det försvinner.
CREATE OR REPLACE FUNCTION otid_map_content_release(p_sha text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_sha IS NULL THEN RETURN; END IF;
  SELECT content_id INTO v_id FROM map_content WHERE sha256 = p_sha FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM race_map WHERE content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM race_map_source WHERE content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM training_group_map WHERE content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM training_group_map_source WHERE content_sha256 = p_sha)
    OR EXISTS (SELECT 1 FROM club_map_version WHERE content_sha256 = p_sha) THEN
    RETURN;
  END IF;
  DELETE FROM map_content WHERE sha256 = p_sha;
  DELETE FROM map_content_part WHERE content_id = v_id;
END;
$$;

DROP TRIGGER IF EXISTS club_map_version_content_release ON club_map_version;
CREATE TRIGGER club_map_version_content_release AFTER DELETE OR UPDATE OF content_sha256 ON club_map_version
  FOR EACH ROW EXECUTE FUNCTION otid_map_content_reference_changed();
