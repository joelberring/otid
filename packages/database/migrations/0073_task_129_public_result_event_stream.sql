-- TASK129 / ADR-0135. Technical, bounded, no-PII wake-up markers for already published results.
CREATE TABLE public_result_update_event (
  event_sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX public_result_update_event_race_sequence_idx
  ON public_result_update_event(race_id, event_sequence);
CREATE TRIGGER public_result_update_event_immutable
  BEFORE UPDATE ON public_result_update_event
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE FUNCTION record_public_result_update_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  recorded_sequence bigint;
BEGIN
  IF NEW.published IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Sequence allocation is global, but a browser reconnects per race. Hold a
  -- transaction-scoped per-race advisory lock so a later commit cannot emit a
  -- larger marker before an earlier marker from the same race commits.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.race_id::text, 0));

  INSERT INTO public_result_update_event(race_id)
  VALUES (NEW.race_id)
  RETURNING event_sequence INTO recorded_sequence;

  -- Keep a bounded technical replay window per race. This never changes a
  -- result revision, raw message, audit row or finalization.
  DELETE FROM public_result_update_event
  WHERE race_id = NEW.race_id
    AND event_sequence < (
      SELECT event_sequence
      FROM public_result_update_event
      WHERE race_id = NEW.race_id
      ORDER BY event_sequence DESC
      OFFSET 999
      LIMIT 1
    );

  PERFORM pg_notify(
    'otid_public_result_update',
    NEW.race_id::text || ':' || recorded_sequence::text
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER result_revision_public_result_update_event
  AFTER INSERT ON result_revision
  FOR EACH ROW EXECUTE FUNCTION record_public_result_update_event();

-- Expand-only. At incident, disable the public SSE route and let clients fall
-- back to polling; do not rewrite result history. Restore a verified full
-- PostgreSQL backup or make a later explicit contract migration.
