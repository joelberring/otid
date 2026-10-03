-- Additive attempt history; no scan outcome or publication is inferred.
CREATE TABLE pm_scan_attempt (
  upload_id uuid NOT NULL REFERENCES pm_scan_job(upload_id),
  generation bigint NOT NULL,
  lease_owner uuid NOT NULL,
  leased_at timestamptz NOT NULL,
  lease_until timestamptz NOT NULL,
  CONSTRAINT pm_scan_attempt_pk PRIMARY KEY (upload_id, generation),
  CONSTRAINT pm_scan_attempt_generation_check CHECK (generation > 0),
  CONSTRAINT pm_scan_attempt_lease_check CHECK (lease_until = leased_at + interval '5 minutes')
);

CREATE TRIGGER pm_scan_attempt_immutable
BEFORE UPDATE OR DELETE ON pm_scan_attempt
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
