-- ADR-0169 beslut 4: klasser som tabell med redigering i raden. En ändring av
-- klassnamn, bana och/eller startsätt sparas i en transaktion och avlästa
-- löpare i klassen räknas om. Journalen binder aktör, klass, banversioner,
-- begäran och kvitto så att ett omförsök med samma request-id ger samma svar.
CREATE TABLE class_edit_request (
  request_id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  class_id uuid NOT NULL,
  previous_course_version_id uuid NOT NULL REFERENCES course_version(id),
  course_version_id uuid NOT NULL REFERENCES course_version(id),
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  edited_at timestamptz NOT NULL,
  CONSTRAINT class_edit_request_scope_uidx UNIQUE(request_id, race_id),
  CONSTRAINT class_edit_request_class_race_fk FOREIGN KEY(class_id, race_id) REFERENCES class(id, race_id),
  CONSTRAINT class_edit_request_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT class_edit_request_role_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT class_edit_request_json_check CHECK(jsonb_typeof(request) = 'object' AND jsonb_typeof(response) = 'object')
);

CREATE TRIGGER class_edit_request_immutable
BEFORE UPDATE OR DELETE ON class_edit_request
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
