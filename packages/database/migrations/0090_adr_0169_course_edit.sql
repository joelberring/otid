-- ADR-0169 beslut 4: "Redigera bana". En ändring skapar en ny banversion, flyttar
-- alla klasser som använde banans gällande version och räknar om berörda resultat
-- i samma transaktion. Journalen binder aktör, bana, versioner, begäran och kvitto
-- så att ett omförsök med samma request-id ger samma svar.
CREATE TABLE course_edit_request (
  request_id uuid PRIMARY KEY,
  race_id uuid NOT NULL REFERENCES race(id),
  course_id uuid NOT NULL,
  previous_course_version_id uuid NOT NULL,
  course_version_id uuid NOT NULL,
  actor_credential_id uuid NOT NULL,
  capability pairing_admin_capability NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  edited_at timestamptz NOT NULL,
  CONSTRAINT course_edit_request_scope_uidx UNIQUE(request_id, race_id),
  CONSTRAINT course_edit_request_course_race_fk FOREIGN KEY(course_id, race_id) REFERENCES course(id, race_id),
  CONSTRAINT course_edit_request_previous_version_fk FOREIGN KEY(previous_course_version_id, course_id)
    REFERENCES course_version(id, course_id),
  CONSTRAINT course_edit_request_version_fk FOREIGN KEY(course_version_id, course_id) REFERENCES course_version(id, course_id),
  CONSTRAINT course_edit_request_actor_scope_fk FOREIGN KEY(actor_credential_id, race_id, capability)
    REFERENCES pairing_admin_access_credential(id, race_id, capability),
  CONSTRAINT course_edit_request_role_check CHECK(capability = 'MANAGE_RACE'),
  CONSTRAINT course_edit_request_versions_check CHECK(previous_course_version_id <> course_version_id),
  CONSTRAINT course_edit_request_json_check CHECK(jsonb_typeof(request) = 'object' AND jsonb_typeof(response) = 'object')
);

CREATE TRIGGER course_edit_request_immutable
BEFORE UPDATE OR DELETE ON course_edit_request
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
