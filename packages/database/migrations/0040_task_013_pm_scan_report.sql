-- Immutable observations, not production publication authority.
ALTER TABLE pm_scan_attempt ADD CONSTRAINT pm_scan_attempt_owner_uidx
  UNIQUE (upload_id, generation, lease_owner);

CREATE TABLE pm_scan_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES pm_object_manifest(upload_id),
  generation bigint NOT NULL,
  lease_owner uuid NOT NULL,
  outcome text NOT NULL,
  publishable boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL,
  content_hash text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pm_scan_report_attempt_uidx UNIQUE (upload_id, generation),
  CONSTRAINT pm_scan_report_attempt_owner_fk FOREIGN KEY (upload_id, generation, lease_owner)
    REFERENCES pm_scan_attempt(upload_id, generation, lease_owner),
  CONSTRAINT pm_scan_report_outcome_check CHECK (outcome IN ('PASSED','REJECTED','FAILED')),
  CONSTRAINT pm_scan_report_native_only_check CHECK (NOT publishable),
  CONSTRAINT pm_scan_report_evidence_check CHECK (jsonb_typeof(evidence) = 'object'),
  CONSTRAINT pm_scan_report_hash_check CHECK (content_hash ~ '^[a-f0-9]{64}$')
);

CREATE TRIGGER pm_scan_report_immutable
BEFORE UPDATE OR DELETE ON pm_scan_report
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
