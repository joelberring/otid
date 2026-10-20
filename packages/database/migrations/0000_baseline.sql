-- Baslinje (PLAN.md steg 23, ADR-0173): hela schemat efter de 106 tidigare migrationerna (0000–0105) och
-- borttagningen av tolv döda tabeller, ihopslaget eftersom det inte finns någon produktionsdata (ADR-0168 beslut 6).
-- Genererad med pg_dump --schema-only.
-- En databas som skapats med de gamla migrationerna går inte att uppgradera: skapa den på nytt (docs/drift.md).
-- Steg 28: CREATE EXTENSION postgis är borttaget här (vanlig postgres:17 räcker). Migratorn kör aldrig om en fil som
-- redan körts (den jämför created_at, inte innehållet), så befintliga databaser påverkas inte; 0007 tar bort tillägget där.
DO $guard$ BEGIN
  IF to_regclass('public.race') IS NOT NULL THEN
    RAISE EXCEPTION 'Databasen skapades med migrationerna före steg 23. Skapa den på nytt (docker compose down -v), se docs/drift.md.';
  END IF;
END $guard$;

-- SQL-funktioner skapas före tabellerna de läser; kroppen kontrolleras när de anropas.
SET LOCAL check_function_bodies = false;

CREATE TYPE public.audit_actor_kind AS ENUM (
    'PAIRING_ADMIN_ACCESS_CREDENTIAL',
    'IOF_IMPORT_ACCESS_CREDENTIAL',
    'ENTRY_CLASS_ACCESS_CREDENTIAL',
    'RESULT_RECALCULATION_ACCESS_CREDENTIAL',
    'EVENT_CREATION_ACCESS_CREDENTIAL',
    'RESULT_FINALIZATION_ACCESS_CREDENTIAL',
    'DID_NOT_START_ACCESS_CREDENTIAL',
    'DID_NOT_START_WITHDRAWAL_ACCESS_CREDENTIAL',
    'RESULT_DISQUALIFICATION_ACCESS_CREDENTIAL',
    'RESULT_DISQUALIFICATION_WITHDRAWAL_ACCESS_CREDENTIAL',
    'RESULT_APPROVAL_ACCESS_CREDENTIAL',
    'RESULT_APPROVAL_WITHDRAWAL_ACCESS_CREDENTIAL',
    'DID_NOT_FINISH_ACCESS_CREDENTIAL',
    'DID_NOT_FINISH_WITHDRAWAL_ACCESS_CREDENTIAL',
    'OUT_OF_COMPETITION_ACCESS_CREDENTIAL',
    'OUT_OF_COMPETITION_WITHDRAWAL_ACCESS_CREDENTIAL',
    'WITHOUT_TIMING_ACCESS_CREDENTIAL',
    'WITHOUT_TIMING_WITHDRAWAL_ACCESS_CREDENTIAL',
    'ENTRY_START_TIME_ACCESS_CREDENTIAL',
    'ENTRY_CARD_ACCESS_CREDENTIAL',
    'ENTRY_REGISTRATION_ACCESS_CREDENTIAL',
    'START_LIST_PUBLICATION_ACCESS_CREDENTIAL',
    'CLASS_START_DRAW_ACCESS_CREDENTIAL',
    'START_CHECKIN_ACCESS_CREDENTIAL',
    'FINISH_FOREST_WATCH_ACCESS_CREDENTIAL',
    'ENTRY_IDENTITY_ACCESS_CREDENTIAL',
    'RACE_ADMIN_ACCESS_CREDENTIAL',
    'USER_ACCOUNT'
);

CREATE TYPE public.event_administration_role AS ENUM (
    'OWNER',
    'ADMIN',
    'FUNCTIONARY'
);

CREATE TYPE public.import_kind AS ENUM (
    'CourseData',
    'EntryList',
    'StartList'
);

CREATE TYPE public.pairing_admin_capability AS ENUM (
    'PAIR_STATION',
    'IMPORT_IOF',
    'CHANGE_ENTRY_CLASS',
    'RECALCULATE_RESULT',
    'VIEW_RACE_OVERVIEW',
    'VIEW_READOUT_RESULT_HISTORY',
    'EXPORT_IOF_RESULT_LIST',
    'FINALIZE_RESULTS',
    'DECIDE_DID_NOT_START',
    'WITHDRAW_DID_NOT_START',
    'DISQUALIFY_RESULT',
    'WITHDRAW_DISQUALIFICATION',
    'APPROVE_RESULT',
    'WITHDRAW_RESULT_APPROVAL',
    'DECIDE_DID_NOT_FINISH',
    'WITHDRAW_DID_NOT_FINISH',
    'DECIDE_OUT_OF_COMPETITION',
    'WITHDRAW_OUT_OF_COMPETITION',
    'DECIDE_WITHOUT_TIMING',
    'WITHDRAW_WITHOUT_TIMING',
    'CHANGE_ENTRY_START_TIME',
    'CHANGE_ENTRY_CARD',
    'REGISTER_ENTRY',
    'VIEW_START_LIST',
    'PUBLISH_START_LIST',
    'DRAW_CLASS_START_TIMES',
    'START_CHECKIN',
    'FINISH_FOREST_WATCH',
    'VIEW_SPEAKER_BOARD',
    'MANAGE_PM_DOCUMENT',
    'CHANGE_ENTRY_IDENTITY',
    'MANAGE_RACE',
    'RACE_FUNCTIONARY'
);

CREATE TYPE public.result_finalization_scope AS ENUM (
    'CLASS',
    'RACE'
);

CREATE TYPE public.revision_cause AS ENUM (
    'CARD_READOUT',
    'CLASS_CHANGE_RECALCULATION',
    'EXPLICIT_RECALCULATION',
    'MANUAL_DID_NOT_START',
    'MANUAL_DISQUALIFICATION',
    'MANUAL_DISQUALIFICATION_WITHDRAWAL',
    'MANUAL_RESULT_APPROVAL',
    'MANUAL_RESULT_APPROVAL_WITHDRAWAL',
    'MANUAL_DID_NOT_FINISH',
    'MANUAL_DID_NOT_FINISH_WITHDRAWAL',
    'MANUAL_OUT_OF_COMPETITION',
    'MANUAL_OUT_OF_COMPETITION_WITHDRAWAL',
    'MANUAL_WITHOUT_TIMING',
    'MANUAL_WITHOUT_TIMING_WITHDRAWAL',
    'START_CHECKIN_DID_NOT_START',
    'UNKNOWN_READOUT_RESOLUTION',
    'MANUAL_FINISH_TIME_CORRECTION',
    'MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL',
    'MANUAL_PUNCH_START_TIME_CORRECTION',
    'MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL',
    'SHORTENED_COURSE_CLASS_TRANSFER'
);

CREATE TYPE public.start_rule AS ENUM (
    'FIXED',
    'PUNCH'
);

CREATE FUNCTION public.advance_event_administration_grant_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE event_administration_grant_guard SET generation = generation + 1
    WHERE grant_id = NEW.grant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event administration grant guard missing'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.advance_pairing_admin_revocation_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE guarded_credential uuid;
BEGIN
  IF TG_TABLE_NAME = 'pairing_admin_access_credential_revocation' THEN
    guarded_credential := NEW.credential_id;
  ELSE
    SELECT access_credential_id INTO STRICT guarded_credential
    FROM pairing_admin_session WHERE id = NEW.session_id;
  END IF;
  UPDATE pairing_admin_revocation_guard SET generation = generation + 1
    WHERE credential_id = guarded_credential;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authentication revocation guard missing';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.advance_user_account_auth_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE guarded_account uuid;
BEGIN
  IF TG_TABLE_NAME = 'user_account_session_revocation' THEN
    SELECT account_id INTO STRICT guarded_account FROM user_account_session WHERE id = NEW.session_id;
  ELSE
    guarded_account := NEW.account_id;
  END IF;
  UPDATE user_account_auth_guard SET generation = generation + 1
    WHERE account_id = guarded_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account authentication guard missing'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.create_event_administration_grant_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO event_administration_grant_guard (grant_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.create_pairing_admin_revocation_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO pairing_admin_revocation_guard (credential_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.create_user_account_auth_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO user_account_auth_guard (account_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.generate_race_short_code() RETURNS text
    LANGUAGE plpgsql
    AS $$
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

CREATE FUNCTION public.otid_result_basis_hash(p_entry_id uuid) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT encode(sha256(convert_to(
    CASE WHEN c.rogaining_time_limit_seconds IS NOT NULL THEN 'v3' WHEN forked.has_variants THEN 'v2' ELSE 'v1' END
    || '|class=' || e.class_id::text
    || '|start=' || c.start_rule::text
    || '|course=' || c.course_version_id::text
    || '|controls=' || coalesce((
      SELECT string_agg(cc.sequence::text || ':' || ctl.code::text, ',' ORDER BY cc.sequence)
      FROM course_control cc
      JOIN control ctl ON ctl.id = cc.control_id
      WHERE cc.course_version_id = c.course_version_id
    ), '')
    || '|neutralized=' || coalesce((
      SELECT string_agg(n.course_control_id::text, ',' ORDER BY n.course_control_id::text)
      FROM class_control_neutralization n
      WHERE n.class_id = e.class_id AND n.course_version_id = c.course_version_id
    ), '')
    || '|fixedStart=' || coalesce(floor(extract(epoch FROM e.fixed_start_time) * 1000)::bigint::text, '')
    || CASE WHEN forked.has_variants THEN
      '|variant=' || coalesce(e.course_variant_code, '')
      || '|variants=' || coalesce((
        SELECT string_agg(v.code || ':' || coalesce((
          SELECT string_agg(vc.sequence::text || ':' || vctl.code::text, ',' ORDER BY vc.sequence)
          FROM course_variant_control vc
          JOIN control vctl ON vctl.id = vc.control_id
          WHERE vc.course_variant_id = v.id
        ), ''), ';' ORDER BY v.sequence)
        FROM course_variant v
        WHERE v.course_version_id = c.course_version_id
      ), '')
    ELSE '' END
    || CASE WHEN c.rogaining_time_limit_seconds IS NOT NULL THEN
      '|rogaining=' || c.rogaining_time_limit_seconds::text || ':' || c.rogaining_penalty_points_per_minute::text
      || '|points=' || coalesce((
        SELECT string_agg(ctl.code::text || ':' || coalesce(ctl.points::text, ''), ',' ORDER BY cc.sequence)
        FROM course_control cc
        JOIN control ctl ON ctl.id = cc.control_id
        WHERE cc.course_version_id = c.course_version_id
      ), '')
    ELSE '' END,
    'UTF8')), 'hex')
  FROM entry e
  JOIN class c ON c.id = e.class_id
  CROSS JOIN LATERAL (
    SELECT EXISTS (SELECT 1 FROM course_variant v WHERE v.course_version_id = c.course_version_id) AS has_variants
  ) forked
  WHERE e.id = p_entry_id
$$;

CREATE FUNCTION public.protect_card_assignment_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('otid.purge', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Card assignment identity is immutable';
  END IF;
  IF ROW(NEW.id, NEW.race_id, NEW.entry_id, NEW.card_number, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.race_id, OLD.entry_id, OLD.card_number, OLD.created_at) THEN
    RAISE EXCEPTION 'Card assignment identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.protect_pairing_admin_revocation_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('otid.purge', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Authentication revocation guard cannot be deleted';
  END IF;
  IF NEW.credential_id IS DISTINCT FROM OLD.credential_id OR NEW.generation <> OLD.generation + 1 THEN
    RAISE EXCEPTION 'Authentication revocation guard must advance exactly once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.protect_task150_auth_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('otid.purge', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Authentication guard cannot be deleted';
  END IF;
  IF NEW.generation <> OLD.generation + 1 THEN
    RAISE EXCEPTION 'Authentication guard must advance exactly once';
  END IF;
  IF TG_TABLE_NAME = 'user_account_auth_guard' THEN
    IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
      RAISE EXCEPTION 'Authentication guard identity cannot change';
    END IF;
  ELSE
    IF NEW.grant_id IS DISTINCT FROM OLD.grant_id THEN
      RAISE EXCEPTION 'Authentication guard identity cannot change';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.protect_user_account_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('otid.purge', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'user_account can only be removed by an explicit account deletion';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'user_account identity cannot change';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.record_public_result_update_event() RETURNS trigger
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

CREATE FUNCTION public.record_radio_punch_update_event() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  changed_race uuid;
  recorded_sequence bigint;
BEGIN
  FOR changed_race IN SELECT DISTINCT race_id FROM new_radio_punches LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(changed_race::text, 0));
    INSERT INTO public_result_update_event(race_id) VALUES (changed_race) RETURNING event_sequence INTO recorded_sequence;
    DELETE FROM public_result_update_event
    WHERE race_id = changed_race
      AND event_sequence < (
        SELECT event_sequence FROM public_result_update_event
        WHERE race_id = changed_race ORDER BY event_sequence DESC OFFSET 999 LIMIT 1
      );
    PERFORM pg_notify('otid_public_result_update', changed_race::text || ':' || recorded_sequence::text);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.reject_immutable_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('otid.purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE FUNCTION public.set_result_revision_basis_hash() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.basis_hash := otid_result_basis_hash(NEW.entry_id);
  IF NEW.basis_hash IS NULL THEN
    RAISE EXCEPTION 'result_revision saknar bedömningsunderlag för deltagaren %', NEW.entry_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.superadmin_action_reject_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'superadmin_action is append-only';
END;
$$;

CREATE TABLE public.account_request_throttle (
    scope text NOT NULL,
    key_hash text NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    attempts integer NOT NULL,
    CONSTRAINT account_request_throttle_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT account_request_throttle_key_check CHECK ((key_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT account_request_throttle_scope_check CHECK ((scope = ANY (ARRAY['REGISTER_IP'::text, 'RESET_IP'::text, 'RESET_EMAIL'::text])))
);

CREATE TABLE public.audit_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    race_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    action text NOT NULL,
    before jsonb,
    after jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_kind public.audit_actor_kind,
    actor_id uuid,
    request_id uuid,
    CONSTRAINT audit_event_actor_pair_check CHECK (((actor_kind IS NULL) = (actor_id IS NULL)))
);

CREATE TABLE public.card_assignment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    card_number text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_rental boolean DEFAULT false NOT NULL,
    rental_returned boolean DEFAULT false NOT NULL
);

CREATE TABLE public.card_readout (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    race_id uuid NOT NULL,
    raw_message_id uuid NOT NULL,
    card_number text NOT NULL,
    start_punched_at timestamp with time zone,
    finish_punched_at timestamp with time zone,
    punches jsonb NOT NULL,
    read_at timestamp with time zone NOT NULL,
    clock_source text,
    clock_offset_ms bigint,
    CONSTRAINT card_readout_clock_source_check CHECK (((clock_source IS NULL) OR (clock_source = ANY (ARRAY['station'::text, 'device'::text]))))
);

CREATE TABLE public.class (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    race_id uuid NOT NULL,
    name text NOT NULL,
    course_version_id uuid NOT NULL,
    start_rule public.start_rule DEFAULT 'FIXED'::public.start_rule NOT NULL,
    external_source text,
    external_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    max_entries integer,
    capacity_version integer DEFAULT 1 NOT NULL,
    start_draw_id uuid,
    rogaining_time_limit_seconds integer,
    rogaining_penalty_points_per_minute integer,
    CONSTRAINT class_capacity_version_check CHECK ((capacity_version > 0)),
    CONSTRAINT class_max_entries_check CHECK (((max_entries IS NULL) OR ((max_entries >= 0) AND (max_entries <= 10000)))),
    CONSTRAINT class_rogaining_check CHECK ((((rogaining_time_limit_seconds IS NULL) = (rogaining_penalty_points_per_minute IS NULL)) AND ((rogaining_time_limit_seconds IS NULL) OR ((rogaining_time_limit_seconds >= 60) AND (rogaining_time_limit_seconds <= 172800))) AND ((rogaining_penalty_points_per_minute IS NULL) OR ((rogaining_penalty_points_per_minute >= 0) AND (rogaining_penalty_points_per_minute <= 1000))))),
    CONSTRAINT class_start_draw_rule_check CHECK (((start_draw_id IS NULL) OR (start_rule = 'FIXED'::public.start_rule)))
);

CREATE TABLE public.class_capacity_change_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    class_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    previous_max_entries integer,
    max_entries integer,
    version_before integer NOT NULL,
    version_after integer NOT NULL,
    entry_count integer NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT class_capacity_change_check CHECK ((previous_max_entries IS DISTINCT FROM max_entries)),
    CONSTRAINT class_capacity_limits_check CHECK ((((previous_max_entries IS NULL) OR ((previous_max_entries >= 0) AND (previous_max_entries <= 10000))) AND ((max_entries IS NULL) OR ((max_entries >= 0) AND (max_entries <= 10000))) AND (entry_count >= 0) AND ((max_entries IS NULL) OR (entry_count <= max_entries)))),
    CONSTRAINT class_capacity_role_check CHECK (((capability)::text = 'MANAGE_RACE'::text)),
    CONSTRAINT class_capacity_versions_check CHECK (((version_before > 0) AND ((version_after)::bigint = ((version_before)::bigint + 1))))
);

CREATE TABLE public.class_control_neutralization (
    id uuid NOT NULL,
    race_id uuid NOT NULL,
    class_id uuid NOT NULL,
    course_version_id uuid NOT NULL,
    course_control_id uuid NOT NULL,
    sequence integer NOT NULL,
    control_code integer NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    expected_snapshot_version integer NOT NULL,
    basis_hash text NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT class_control_neutralization_basis_hash_check CHECK ((basis_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT class_control_neutralization_capability_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability)),
    CONSTRAINT class_control_neutralization_check CHECK (((jsonb_typeof(request) = 'object'::text) AND (jsonb_typeof(response) = 'object'::text))),
    CONSTRAINT class_control_neutralization_control_code_check CHECK ((control_code > 0)),
    CONSTRAINT class_control_neutralization_expected_snapshot_version_check CHECK ((expected_snapshot_version > 0)),
    CONSTRAINT class_control_neutralization_sequence_check CHECK ((sequence > 0))
);

CREATE TABLE public.class_edit_request (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    class_id uuid NOT NULL,
    previous_course_version_id uuid NOT NULL,
    course_version_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    edited_at timestamp with time zone NOT NULL,
    CONSTRAINT class_edit_request_json_check CHECK (((jsonb_typeof(request) = 'object'::text) AND (jsonb_typeof(response) = 'object'::text))),
    CONSTRAINT class_edit_request_role_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability))
);

CREATE TABLE public.class_result_recalculation (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    class_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    expected_snapshot_version integer NOT NULL,
    expected_engine_version text NOT NULL,
    manifest_hash text NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    recalculated_at timestamp with time zone NOT NULL,
    CONSTRAINT class_result_recalculation_capability_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability)),
    CONSTRAINT class_result_recalculation_check CHECK (((jsonb_typeof(request) = 'object'::text) AND (jsonb_typeof(response) = 'object'::text))),
    CONSTRAINT class_result_recalculation_expected_engine_version_check CHECK (((length(btrim(expected_engine_version)) >= 1) AND (length(btrim(expected_engine_version)) <= 64))),
    CONSTRAINT class_result_recalculation_expected_snapshot_version_check CHECK ((expected_snapshot_version > 0)),
    CONSTRAINT class_result_recalculation_manifest_hash_check CHECK ((manifest_hash ~ '^[a-f0-9]{64}$'::text))
);

CREATE TABLE public.class_result_recalculation_item (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    class_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    expected_entry_version integer NOT NULL,
    expected_assignment_id uuid NOT NULL,
    expected_readout_id uuid NOT NULL,
    expected_result_revision_id uuid NOT NULL,
    expected_result_revision integer NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    CONSTRAINT class_result_recalculation_item_check CHECK (((expected_entry_version > 0) AND (expected_result_revision > 0))),
    CONSTRAINT class_result_recalculation_item_check1 CHECK ((created_result_revision = (expected_result_revision + 1)))
);

CREATE TABLE public.control (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    race_id uuid NOT NULL,
    code integer NOT NULL,
    kind text DEFAULT 'CONTROL'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    points integer,
    CONSTRAINT control_points_check CHECK (((points IS NULL) OR ((points >= 0) AND (points <= 1000))))
);

CREATE TABLE public.course (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    race_id uuid NOT NULL,
    name text NOT NULL,
    external_source text,
    external_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.course_control (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_version_id uuid NOT NULL,
    control_id uuid NOT NULL,
    sequence integer NOT NULL
);

CREATE TABLE public.course_edit_request (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    course_id uuid NOT NULL,
    previous_course_version_id uuid NOT NULL,
    course_version_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    edited_at timestamp with time zone NOT NULL,
    CONSTRAINT course_edit_request_json_check CHECK (((jsonb_typeof(request) = 'object'::text) AND (jsonb_typeof(response) = 'object'::text))),
    CONSTRAINT course_edit_request_role_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability)),
    CONSTRAINT course_edit_request_versions_check CHECK ((previous_course_version_id <> course_version_id))
);

CREATE TABLE public.course_variant (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_version_id uuid NOT NULL,
    code text NOT NULL,
    sequence integer NOT NULL,
    CONSTRAINT course_variant_code_check CHECK (((char_length(code) BETWEEN 1 AND 32) AND (code = btrim(code)))),
    CONSTRAINT course_variant_sequence_check CHECK ((sequence > 0))
);

CREATE TABLE public.course_variant_assignment_request (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    kind text NOT NULL,
    class_id uuid NOT NULL,
    entry_id uuid,
    seed bigint,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    assigned_at timestamp with time zone NOT NULL,
    CONSTRAINT course_variant_assignment_request_json_check CHECK (((jsonb_typeof(request) = 'object'::text) AND (jsonb_typeof(response) = 'object'::text))),
    CONSTRAINT course_variant_assignment_request_kind_check CHECK ((((kind = 'ENTRY'::text) AND (entry_id IS NOT NULL) AND (seed IS NULL)) OR ((kind = 'CLASS'::text) AND (entry_id IS NULL) AND ((seed >= 1) AND (seed <= '4294967295'::bigint))))),
    CONSTRAINT course_variant_assignment_request_role_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability))
);

CREATE TABLE public.course_variant_control (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_variant_id uuid NOT NULL,
    control_id uuid NOT NULL,
    sequence integer NOT NULL,
    CONSTRAINT course_variant_control_sequence_check CHECK ((sequence > 0))
);

CREATE TABLE public.course_version (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    version integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.device_ingest_outcome (
    raw_message_id uuid NOT NULL,
    server_result jsonb NOT NULL,
    evaluation_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_ingest_outcome_evaluation_hash_check CHECK ((evaluation_hash ~ '^[a-f0-9]{64}$'::text))
);

CREATE TABLE public.did_not_finish_decision (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    expected_entry_version integer NOT NULL,
    expected_class_id uuid NOT NULL,
    expected_course_version_id uuid NOT NULL,
    expected_snapshot_version integer NOT NULL,
    target_result_revision_id uuid NOT NULL,
    target_result_revision integer NOT NULL,
    policy_version text NOT NULL,
    status text NOT NULL,
    reason text NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT did_not_finish_decision_created_revision_check CHECK ((created_result_revision = (target_result_revision + 1))),
    CONSTRAINT did_not_finish_decision_distinct_result_check CHECK ((target_result_revision_id <> created_result_revision_id)),
    CONSTRAINT did_not_finish_decision_expected_entry_version_check CHECK ((expected_entry_version > 0)),
    CONSTRAINT did_not_finish_decision_expected_snapshot_check CHECK ((expected_snapshot_version > 0)),
    CONSTRAINT did_not_finish_decision_policy_version_check CHECK (((length(btrim(policy_version)) >= 1) AND (length(btrim(policy_version)) <= 64))),
    CONSTRAINT did_not_finish_decision_status_check CHECK (((status = 'DNF'::text) AND (reason = 'DID_NOT_FINISH'::text))),
    CONSTRAINT did_not_finish_decision_target_revision_check CHECK ((target_result_revision > 0))
);

CREATE TABLE public.did_not_finish_withdrawal (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    expected_entry_version integer NOT NULL,
    expected_class_id uuid NOT NULL,
    expected_course_version_id uuid NOT NULL,
    expected_snapshot_version integer NOT NULL,
    did_not_finish_decision_id uuid NOT NULL,
    target_result_revision_id uuid NOT NULL,
    target_result_revision integer NOT NULL,
    withdrawn_result_revision_id uuid NOT NULL,
    withdrawn_result_revision integer NOT NULL,
    expected_latest_result_revision_id uuid NOT NULL,
    expected_latest_result_revision integer NOT NULL,
    restored_from_result_revision_id uuid NOT NULL,
    restored_from_result_revision integer NOT NULL,
    policy_version text NOT NULL,
    reason text NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    withdrawn_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT did_not_finish_withdrawal_distinct_results_check CHECK (((target_result_revision_id <> withdrawn_result_revision_id) AND (withdrawn_result_revision_id <> restored_from_result_revision_id) AND (withdrawn_result_revision_id <> created_result_revision_id) AND (restored_from_result_revision_id <> created_result_revision_id))),
    CONSTRAINT did_not_finish_withdrawal_expected_entry_version_check CHECK ((expected_entry_version > 0)),
    CONSTRAINT did_not_finish_withdrawal_expected_snapshot_check CHECK ((expected_snapshot_version > 0)),
    CONSTRAINT did_not_finish_withdrawal_policy_version_check CHECK ((policy_version = 'did-not-finish-withdrawal-v1'::text)),
    CONSTRAINT did_not_finish_withdrawal_reason_check CHECK ((reason = 'ERRONEOUS_MANUAL_DID_NOT_FINISH'::text)),
    CONSTRAINT did_not_finish_withdrawal_revision_chain_check CHECK (((target_result_revision > 0) AND (withdrawn_result_revision = (target_result_revision + 1)) AND (expected_latest_result_revision >= withdrawn_result_revision) AND ((restored_from_result_revision = target_result_revision) OR (restored_from_result_revision > withdrawn_result_revision)) AND (restored_from_result_revision <= expected_latest_result_revision) AND (created_result_revision = (expected_latest_result_revision + 1))))
);

CREATE TABLE public.did_not_start_decision (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    expected_entry_version integer NOT NULL,
    expected_class_id uuid NOT NULL,
    expected_course_version_id uuid NOT NULL,
    expected_snapshot_version integer NOT NULL,
    expected_latest_result_revision integer NOT NULL,
    policy_version text NOT NULL,
    status text NOT NULL,
    reason text NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT did_not_start_decision_created_revision_check CHECK ((created_result_revision = 1)),
    CONSTRAINT did_not_start_decision_expected_entry_version_check CHECK ((expected_entry_version > 0)),
    CONSTRAINT did_not_start_decision_expected_revision_check CHECK ((expected_latest_result_revision = 0)),
    CONSTRAINT did_not_start_decision_expected_snapshot_version_check CHECK ((expected_snapshot_version > 0)),
    CONSTRAINT did_not_start_decision_policy_version_check CHECK (((length(btrim(policy_version)) >= 1) AND (length(btrim(policy_version)) <= 64))),
    CONSTRAINT did_not_start_decision_status_check CHECK (((status = 'DNS'::text) AND (reason = 'DID_NOT_START'::text)))
);

CREATE TABLE public.did_not_start_withdrawal (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    did_not_start_decision_id uuid NOT NULL,
    withdrawn_result_revision_id uuid NOT NULL,
    expected_entry_version integer NOT NULL,
    expected_class_id uuid NOT NULL,
    expected_course_version_id uuid NOT NULL,
    expected_snapshot_version integer NOT NULL,
    expected_latest_result_revision integer NOT NULL,
    policy_version text NOT NULL,
    reason text NOT NULL,
    withdrawn_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT did_not_start_withdrawal_expected_entry_version_check CHECK ((expected_entry_version > 0)),
    CONSTRAINT did_not_start_withdrawal_expected_revision_check CHECK ((expected_latest_result_revision > 0)),
    CONSTRAINT did_not_start_withdrawal_expected_snapshot_version_check CHECK ((expected_snapshot_version > 0)),
    CONSTRAINT did_not_start_withdrawal_policy_version_check CHECK (((length(btrim(policy_version)) >= 1) AND (length(btrim(policy_version)) <= 64))),
    CONSTRAINT did_not_start_withdrawal_reason_check CHECK ((reason = 'ERRONEOUS_MANUAL_DNS'::text))
);

CREATE TABLE public.entry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    race_id uuid NOT NULL,
    class_id uuid NOT NULL,
    given_name text NOT NULL,
    family_name text NOT NULL,
    organisation_name text,
    fixed_start_time timestamp with time zone,
    external_source text,
    external_id text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    public_result_id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_variant_code text,
    team_id uuid,
    relay_leg integer,
    CONSTRAINT entry_course_variant_code_check CHECK (((course_variant_code IS NULL) OR ((char_length(course_variant_code) BETWEEN 1 AND 32) AND (course_variant_code = btrim(course_variant_code))))),
    CONSTRAINT entry_relay_leg_check CHECK ((((team_id IS NULL) = (relay_leg IS NULL)) AND ((relay_leg IS NULL) OR ((relay_leg >= 1) AND (relay_leg <= 20)))))
);

CREATE TABLE public.entry_card_change_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    class_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    previous_assignment_id uuid,
    previous_card_number text,
    active_assignment_id uuid NOT NULL,
    card_number text NOT NULL,
    entry_version_before integer NOT NULL,
    entry_version_after integer NOT NULL,
    snapshot_version_before integer NOT NULL,
    snapshot_version_after integer NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entry_card_change_request_change_check CHECK (((previous_assignment_id IS DISTINCT FROM active_assignment_id) AND (previous_card_number IS DISTINCT FROM card_number))),
    CONSTRAINT entry_card_change_request_previous_check CHECK (((previous_assignment_id IS NULL) = (previous_card_number IS NULL))),
    CONSTRAINT entry_card_change_request_versions_check CHECK (((entry_version_before > 0) AND (entry_version_after = (entry_version_before + 1)) AND (snapshot_version_before > 0) AND (snapshot_version_after = (snapshot_version_before + 1))))
);

CREATE TABLE public.entry_card_rental_change (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    class_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    card_number text NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    previous_is_rental boolean NOT NULL,
    is_rental boolean NOT NULL,
    entry_version_before integer NOT NULL,
    entry_version_after integer NOT NULL,
    snapshot_version_before integer NOT NULL,
    snapshot_version_after integer NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entry_card_rental_change_capability_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability)),
    CONSTRAINT entry_card_rental_change_value_check CHECK ((previous_is_rental IS DISTINCT FROM is_rental)),
    CONSTRAINT entry_card_rental_change_versions_check CHECK (((entry_version_before > 0) AND ((entry_version_after)::bigint = ((entry_version_before)::bigint + 1)) AND (snapshot_version_before > 0) AND ((snapshot_version_after)::bigint = ((snapshot_version_before)::bigint + 1))))
);

CREATE TABLE public.entry_card_rental_return_change (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    class_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    card_number text NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    previous_rental_returned boolean NOT NULL,
    rental_returned boolean NOT NULL,
    entry_version_before integer NOT NULL,
    entry_version_after integer NOT NULL,
    snapshot_version_before integer NOT NULL,
    snapshot_version_after integer NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entry_card_rental_return_change_capability_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability)),
    CONSTRAINT entry_card_rental_return_change_value_check CHECK ((previous_rental_returned IS DISTINCT FROM rental_returned)),
    CONSTRAINT entry_card_rental_return_change_versions_check CHECK (((entry_version_before > 0) AND ((entry_version_after)::bigint = ((entry_version_before)::bigint + 1)) AND (snapshot_version_before > 0) AND ((snapshot_version_after)::bigint = ((snapshot_version_before)::bigint + 1))))
);

CREATE TABLE public.entry_card_rental_reuse_request (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    source_entry_id uuid NOT NULL,
    source_class_id uuid NOT NULL,
    source_assignment_id uuid NOT NULL,
    card_number text NOT NULL,
    target_entry_id uuid NOT NULL,
    target_class_id uuid NOT NULL,
    target_assignment_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    source_entry_version_before integer NOT NULL,
    source_entry_version_after integer NOT NULL,
    target_entry_version_before integer NOT NULL,
    target_entry_version_after integer NOT NULL,
    snapshot_version_before integer NOT NULL,
    snapshot_version_after integer NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entry_card_rental_reuse_capability_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability)),
    CONSTRAINT entry_card_rental_reuse_distinct_assignments_check CHECK ((source_assignment_id <> target_assignment_id)),
    CONSTRAINT entry_card_rental_reuse_distinct_entries_check CHECK ((source_entry_id <> target_entry_id)),
    CONSTRAINT entry_card_rental_reuse_versions_check CHECK (((source_entry_version_before > 0) AND ((source_entry_version_after)::bigint = ((source_entry_version_before)::bigint + 1)) AND (target_entry_version_before > 0) AND ((target_entry_version_after)::bigint = ((target_entry_version_before)::bigint + 1)) AND (snapshot_version_before > 0) AND ((snapshot_version_after)::bigint = ((snapshot_version_before)::bigint + 1))))
);

CREATE TABLE public.entry_class_change_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    expected_entry_version integer NOT NULL,
    previous_class_id uuid NOT NULL,
    class_id uuid NOT NULL,
    entry_version_before integer NOT NULL,
    entry_version_after integer NOT NULL,
    snapshot_version_before integer NOT NULL,
    snapshot_version_after integer NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entry_class_change_request_class_change_check CHECK ((previous_class_id <> class_id)),
    CONSTRAINT entry_class_change_request_entry_increment_check CHECK ((entry_version_after = (entry_version_before + 1))),
    CONSTRAINT entry_class_change_request_expected_version_check CHECK (((expected_entry_version > 0) AND (entry_version_before = expected_entry_version))),
    CONSTRAINT entry_class_change_request_snapshot_increment_check CHECK (((snapshot_version_before > 0) AND (snapshot_version_after = (snapshot_version_before + 1))))
);

CREATE TABLE public.entry_identity_change_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    class_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    previous_identity jsonb NOT NULL,
    identity jsonb NOT NULL,
    entry_version_before integer NOT NULL,
    entry_version_after integer NOT NULL,
    snapshot_version_before integer NOT NULL,
    snapshot_version_after integer NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entry_identity_change_capability_check CHECK (((capability)::text = ANY (ARRAY['CHANGE_ENTRY_IDENTITY'::text, 'MANAGE_RACE'::text]))),
    CONSTRAINT entry_identity_change_values_check CHECK (((jsonb_typeof(previous_identity) = 'object'::text) AND (jsonb_typeof(identity) = 'object'::text) AND (previous_identity <> identity))),
    CONSTRAINT entry_identity_change_versions_check CHECK (((entry_version_before > 0) AND ((entry_version_after)::bigint = ((entry_version_before)::bigint + 1)) AND (snapshot_version_before > 0) AND ((snapshot_version_after)::bigint = ((snapshot_version_before)::bigint + 1))))
);

CREATE TABLE public.entry_registration_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    assignment_id uuid,
    request jsonb NOT NULL,
    snapshot_version_after integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_start_time timestamp with time zone,
    CONSTRAINT entry_registration_request_object_check CHECK ((jsonb_typeof(request) = 'object'::text)),
    CONSTRAINT entry_registration_request_version_check CHECK ((snapshot_version_after > 1))
);

CREATE TABLE public.entry_start_time_change_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    expected_entry_version integer NOT NULL,
    previous_fixed_start_time timestamp with time zone,
    fixed_start_time timestamp with time zone NOT NULL,
    class_id uuid NOT NULL,
    entry_version_before integer NOT NULL,
    entry_version_after integer NOT NULL,
    snapshot_version_before integer NOT NULL,
    snapshot_version_after integer NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entry_start_time_change_request_entry_increment_check CHECK ((entry_version_after = (entry_version_before + 1))),
    CONSTRAINT entry_start_time_change_request_expected_version_check CHECK (((expected_entry_version > 0) AND (entry_version_before = expected_entry_version))),
    CONSTRAINT entry_start_time_change_request_snapshot_increment_check CHECK (((snapshot_version_before > 0) AND (snapshot_version_after = (snapshot_version_before + 1)))),
    CONSTRAINT entry_start_time_change_request_time_change_check CHECK ((previous_fixed_start_time IS DISTINCT FROM fixed_start_time))
);

CREATE TABLE public.entry_transfer_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    previous_class_id uuid NOT NULL,
    target_class_id uuid NOT NULL,
    request jsonb NOT NULL,
    entry_version_before integer NOT NULL,
    entry_version_after integer NOT NULL,
    snapshot_version_before integer NOT NULL,
    snapshot_version_after integer NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entry_transfer_class_check CHECK ((previous_class_id <> target_class_id)),
    CONSTRAINT entry_transfer_entry_version_check CHECK (((entry_version_before > 0) AND ((entry_version_after)::bigint = ((entry_version_before)::bigint + 1)))),
    CONSTRAINT entry_transfer_request_check CHECK ((jsonb_typeof(request) = 'object'::text)),
    CONSTRAINT entry_transfer_role_check CHECK (((capability)::text = 'MANAGE_RACE'::text)),
    CONSTRAINT entry_transfer_snapshot_version_check CHECK (((snapshot_version_before > 0) AND ((snapshot_version_after)::bigint = ((snapshot_version_before)::bigint + 1))))
);

CREATE TABLE public.event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    starts_on date NOT NULL,
    time_zone text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.event_administration_access_request (
    request_id uuid NOT NULL,
    action text NOT NULL,
    actor_account_id uuid NOT NULL,
    event_id uuid NOT NULL,
    target_account_id uuid NOT NULL,
    grant_id uuid NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_administration_access_request_action_check CHECK ((action = ANY (ARRAY['GRANT_ADMIN'::text, 'REVOKE_ADMIN'::text, 'GRANT_FUNCTIONARY'::text, 'REVOKE_FUNCTIONARY'::text]))),
    CONSTRAINT event_administration_access_request_reason_check CHECK (((reason IS NULL) OR ((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 240)))),
    CONSTRAINT event_administration_access_request_target_check CHECK ((actor_account_id <> target_account_id))
);

CREATE TABLE public.event_administration_grant (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    account_id uuid NOT NULL,
    role public.event_administration_role NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.event_administration_grant_guard (
    grant_id uuid NOT NULL,
    generation bigint DEFAULT 0 NOT NULL,
    CONSTRAINT event_administration_grant_guard_generation_check CHECK ((generation >= 0))
);

CREATE TABLE public.event_administration_grant_revocation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    grant_id uuid NOT NULL,
    revoked_at timestamp with time zone NOT NULL,
    reason text NOT NULL,
    CONSTRAINT event_administration_grant_revocation_reason_check CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 240)))
);

CREATE TABLE public.import_file (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    race_id uuid NOT NULL,
    kind public.import_kind NOT NULL,
    content_hash text NOT NULL,
    original_xml text NOT NULL,
    report jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.iof_import_request (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    content_hash text NOT NULL,
    import_file_id uuid NOT NULL,
    outcome text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT iof_import_request_content_hash_check CHECK ((content_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT iof_import_request_outcome_check CHECK ((outcome = ANY (ARRAY['stored'::text, 'duplicate'::text])))
);

CREATE TABLE public.manual_class_create_request (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    course_id uuid NOT NULL,
    course_version_id uuid NOT NULL,
    class_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    CONSTRAINT manual_class_create_request_json_check CHECK (((jsonb_typeof(request) = 'object'::text) AND (jsonb_typeof(response) = 'object'::text))),
    CONSTRAINT manual_class_create_request_role_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability))
);

CREATE TABLE public.manual_course_class_create_request (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    course_id uuid NOT NULL,
    course_version_id uuid NOT NULL,
    class_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    CONSTRAINT manual_course_class_create_request_capability_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability)),
    CONSTRAINT manual_course_class_create_request_check CHECK (((jsonb_typeof(request) = 'object'::text) AND (jsonb_typeof(response) = 'object'::text)))
);

CREATE TABLE public.manual_finish_time_correction (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    expected_entry_version integer NOT NULL,
    class_id uuid NOT NULL,
    course_version_id uuid NOT NULL,
    expected_snapshot_version integer NOT NULL,
    basis_hash text NOT NULL,
    source_result_revision_id uuid NOT NULL,
    source_result_revision integer NOT NULL,
    source_readout_id uuid NOT NULL,
    source_finish_time timestamp with time zone NOT NULL,
    corrected_finish_time timestamp with time zone NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    corrected_at timestamp with time zone NOT NULL,
    CONSTRAINT manual_finish_time_correction_capability_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability)),
    CONSTRAINT manual_finish_time_correction_finish_check CHECK ((source_finish_time <> corrected_finish_time)),
    CONSTRAINT manual_finish_time_correction_hash_check CHECK ((basis_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT manual_finish_time_correction_json_check CHECK (((jsonb_typeof(request) = 'object'::text) AND (jsonb_typeof(response) = 'object'::text))),
    CONSTRAINT manual_finish_time_correction_positive_check CHECK (((expected_entry_version > 0) AND (expected_snapshot_version > 0) AND (source_result_revision > 0) AND (created_result_revision > 0))),
    CONSTRAINT manual_finish_time_correction_revision_chain_check CHECK (((created_result_revision)::bigint = ((source_result_revision)::bigint + 1)))
);

CREATE TABLE public.manual_finish_time_correction_withdrawal (
    request_id uuid NOT NULL,
    id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    expected_entry_version integer NOT NULL,
    class_id uuid NOT NULL,
    course_version_id uuid NOT NULL,
    expected_snapshot_version integer NOT NULL,
    basis_hash text NOT NULL,
    correction_id uuid NOT NULL,
    source_result_revision_id uuid NOT NULL,
    source_result_revision integer NOT NULL,
    corrected_result_revision_id uuid NOT NULL,
    corrected_result_revision integer NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    withdrawn_at timestamp with time zone NOT NULL,
    CONSTRAINT manual_finish_time_correction_withdrawal_capability_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability)),
    CONSTRAINT manual_finish_time_correction_withdrawal_chain_check CHECK ((((corrected_result_revision)::bigint = ((source_result_revision)::bigint + 1)) AND ((created_result_revision)::bigint = ((corrected_result_revision)::bigint + 1)))),
    CONSTRAINT manual_finish_time_correction_withdrawal_hash_check CHECK ((basis_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT manual_finish_time_correction_withdrawal_json_check CHECK (((jsonb_typeof(request) = 'object'::text) AND (jsonb_typeof(response) = 'object'::text))),
    CONSTRAINT manual_finish_time_correction_withdrawal_positive_check CHECK (((expected_entry_version > 0) AND (expected_snapshot_version > 0) AND (source_result_revision > 0) AND (corrected_result_revision > 0) AND (created_result_revision > 0)))
);

CREATE TABLE public.manual_punch_start_time_correction (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    expected_entry_version integer NOT NULL,
    class_id uuid NOT NULL,
    course_version_id uuid NOT NULL,
    expected_snapshot_version integer NOT NULL,
    basis_hash text NOT NULL,
    source_result_revision_id uuid NOT NULL,
    source_result_revision integer NOT NULL,
    source_readout_id uuid NOT NULL,
    source_start_time timestamp with time zone NOT NULL,
    corrected_start_time timestamp with time zone NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    corrected_at timestamp with time zone NOT NULL,
    CONSTRAINT manual_punch_start_time_correction_capability_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability)),
    CONSTRAINT manual_punch_start_time_correction_hash_check CHECK ((basis_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT manual_punch_start_time_correction_json_check CHECK (((jsonb_typeof(request) = 'object'::text) AND (jsonb_typeof(response) = 'object'::text))),
    CONSTRAINT manual_punch_start_time_correction_positive_check CHECK (((expected_entry_version > 0) AND (expected_snapshot_version > 0) AND (source_result_revision > 0) AND (created_result_revision > 0))),
    CONSTRAINT manual_punch_start_time_correction_revision_chain_check CHECK (((created_result_revision)::bigint = ((source_result_revision)::bigint + 1))),
    CONSTRAINT manual_punch_start_time_correction_start_check CHECK ((source_start_time <> corrected_start_time))
);

CREATE TABLE public.manual_punch_start_time_correction_withdrawal (
    request_id uuid NOT NULL,
    id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    expected_entry_version integer NOT NULL,
    class_id uuid NOT NULL,
    course_version_id uuid NOT NULL,
    expected_snapshot_version integer NOT NULL,
    basis_hash text NOT NULL,
    correction_id uuid NOT NULL,
    source_result_revision_id uuid NOT NULL,
    source_result_revision integer NOT NULL,
    corrected_result_revision_id uuid NOT NULL,
    corrected_result_revision integer NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    withdrawn_at timestamp with time zone NOT NULL,
    CONSTRAINT manual_punch_start_time_correction_withdrawal_capability_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability)),
    CONSTRAINT manual_punch_start_time_correction_withdrawal_chain_check CHECK ((((corrected_result_revision)::bigint = ((source_result_revision)::bigint + 1)) AND ((created_result_revision)::bigint = ((corrected_result_revision)::bigint + 1)))),
    CONSTRAINT manual_punch_start_time_correction_withdrawal_hash_check CHECK ((basis_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT manual_punch_start_time_correction_withdrawal_json_check CHECK (((jsonb_typeof(request) = 'object'::text) AND (jsonb_typeof(response) = 'object'::text))),
    CONSTRAINT manual_punch_start_time_correction_withdrawal_positive_check CHECK (((expected_entry_version > 0) AND (expected_snapshot_version > 0) AND (source_result_revision > 0) AND (corrected_result_revision > 0) AND (created_result_revision > 0)))
);

CREATE TABLE public.not_competing_decision (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    expected_entry_version integer NOT NULL,
    expected_class_id uuid NOT NULL,
    expected_course_version_id uuid NOT NULL,
    expected_snapshot_version integer NOT NULL,
    target_result_revision_id uuid NOT NULL,
    target_result_revision integer NOT NULL,
    policy_version text NOT NULL,
    status text NOT NULL,
    reason text NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT not_competing_decision_created_revision_check CHECK ((created_result_revision = (target_result_revision + 1))),
    CONSTRAINT not_competing_decision_distinct_result_check CHECK ((target_result_revision_id <> created_result_revision_id)),
    CONSTRAINT not_competing_decision_expected_entry_version_check CHECK ((expected_entry_version > 0)),
    CONSTRAINT not_competing_decision_expected_snapshot_check CHECK ((expected_snapshot_version > 0)),
    CONSTRAINT not_competing_decision_policy_version_check CHECK ((policy_version = 'out-of-competition-v1'::text)),
    CONSTRAINT not_competing_decision_status_check CHECK (((status = 'OOC'::text) AND (reason = 'OUT_OF_COMPETITION'::text))),
    CONSTRAINT not_competing_decision_target_revision_check CHECK ((target_result_revision > 0))
);

CREATE TABLE public.not_competing_withdrawal (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    expected_entry_version integer NOT NULL,
    expected_class_id uuid NOT NULL,
    expected_course_version_id uuid NOT NULL,
    expected_snapshot_version integer NOT NULL,
    not_competing_decision_id uuid NOT NULL,
    target_result_revision_id uuid NOT NULL,
    target_result_revision integer NOT NULL,
    withdrawn_result_revision_id uuid NOT NULL,
    withdrawn_result_revision integer NOT NULL,
    expected_latest_result_revision_id uuid NOT NULL,
    expected_latest_result_revision integer NOT NULL,
    restored_from_result_revision_id uuid NOT NULL,
    restored_from_result_revision integer NOT NULL,
    policy_version text NOT NULL,
    reason text NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    withdrawn_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT not_competing_withdrawal_distinct_results_check CHECK (((target_result_revision_id <> withdrawn_result_revision_id) AND (withdrawn_result_revision_id <> restored_from_result_revision_id) AND (withdrawn_result_revision_id <> created_result_revision_id) AND (restored_from_result_revision_id <> created_result_revision_id))),
    CONSTRAINT not_competing_withdrawal_expected_entry_version_check CHECK ((expected_entry_version > 0)),
    CONSTRAINT not_competing_withdrawal_expected_snapshot_check CHECK ((expected_snapshot_version > 0)),
    CONSTRAINT not_competing_withdrawal_policy_version_check CHECK ((policy_version = 'out-of-competition-withdrawal-v1'::text)),
    CONSTRAINT not_competing_withdrawal_reason_check CHECK ((reason = 'ERRONEOUS_MANUAL_OUT_OF_COMPETITION'::text)),
    CONSTRAINT not_competing_withdrawal_revision_chain_check CHECK (((target_result_revision > 0) AND (withdrawn_result_revision = (target_result_revision + 1)) AND (expected_latest_result_revision >= withdrawn_result_revision) AND ((restored_from_result_revision = target_result_revision) OR (restored_from_result_revision > withdrawn_result_revision)) AND (restored_from_result_revision <= expected_latest_result_revision) AND (created_result_revision = (expected_latest_result_revision + 1))))
);

CREATE TABLE public.pairing_admin_access_credential (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    race_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    label text NOT NULL,
    secret_hash text NOT NULL,
    issued_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT pairing_admin_access_credential_check CHECK ((expires_at > issued_at)),
    CONSTRAINT pairing_admin_access_credential_check1 CHECK ((expires_at <= (issued_at + '24:00:00'::interval))),
    CONSTRAINT pairing_admin_access_credential_label_check CHECK (((length(btrim(label)) >= 1) AND (length(btrim(label)) <= 120))),
    CONSTRAINT pairing_admin_access_credential_secret_hash_check CHECK ((secret_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT pairing_admin_class_start_draw_lifetime_check CHECK ((((capability)::text <> 'DRAW_CLASS_START_TIMES'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_did_not_finish_lifetime_check CHECK ((((capability)::text <> 'DECIDE_DID_NOT_FINISH'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_did_not_finish_withdrawal_lifetime_check CHECK ((((capability)::text <> 'WITHDRAW_DID_NOT_FINISH'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_did_not_start_lifetime_check CHECK ((((capability)::text <> 'DECIDE_DID_NOT_START'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_did_not_start_withdrawal_lifetime_check CHECK ((((capability)::text <> 'WITHDRAW_DID_NOT_START'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_entry_card_lifetime_check CHECK ((((capability)::text <> 'CHANGE_ENTRY_CARD'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_entry_class_lifetime_check CHECK ((((capability)::text <> 'CHANGE_ENTRY_CLASS'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_entry_identity_lifetime_check CHECK ((((capability)::text <> 'CHANGE_ENTRY_IDENTITY'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_entry_registration_lifetime_check CHECK ((((capability)::text <> 'REGISTER_ENTRY'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_entry_start_time_lifetime_check CHECK ((((capability)::text <> 'CHANGE_ENTRY_START_TIME'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_import_iof_lifetime_check CHECK ((((capability)::text <> 'IMPORT_IOF'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_iof_result_list_export_lifetime_check CHECK ((((capability)::text <> 'EXPORT_IOF_RESULT_LIST'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_out_of_competition_lifetime_check CHECK ((((capability)::text <> 'DECIDE_OUT_OF_COMPETITION'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_out_of_competition_withdrawal_lifetime_check CHECK ((((capability)::text <> 'WITHDRAW_OUT_OF_COMPETITION'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_pm_document_lifetime_check CHECK ((((capability)::text <> 'MANAGE_PM_DOCUMENT'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_race_administrator_lifetime_check CHECK ((((capability)::text <> 'MANAGE_RACE'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_race_functionary_lifetime_check CHECK ((((capability)::text <> 'RACE_FUNCTIONARY'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_race_overview_lifetime_check CHECK ((((capability)::text <> 'VIEW_RACE_OVERVIEW'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_readout_result_history_lifetime_check CHECK ((((capability)::text <> 'VIEW_READOUT_RESULT_HISTORY'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_result_approval_lifetime_check CHECK ((((capability)::text <> 'APPROVE_RESULT'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_result_approval_withdrawal_lifetime_check CHECK ((((capability)::text <> 'WITHDRAW_RESULT_APPROVAL'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_result_disqualification_lifetime_check CHECK ((((capability)::text <> 'DISQUALIFY_RESULT'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_result_disqualification_withdrawal_lifetime_check CHECK ((((capability)::text <> 'WITHDRAW_DISQUALIFICATION'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_result_finalization_lifetime_check CHECK ((((capability)::text <> 'FINALIZE_RESULTS'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_result_recalculation_lifetime_check CHECK ((((capability)::text <> 'RECALCULATE_RESULT'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_speaker_board_lifetime_check CHECK ((((capability)::text <> 'VIEW_SPEAKER_BOARD'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_start_checkin_lifetime_check CHECK ((((capability)::text <> ALL (ARRAY['START_CHECKIN'::text, 'FINISH_FOREST_WATCH'::text])) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_start_list_lifetime_check CHECK ((((capability)::text <> 'VIEW_START_LIST'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_start_list_publication_lifetime_check CHECK ((((capability)::text <> 'PUBLISH_START_LIST'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_without_timing_lifetime_check CHECK ((((capability)::text <> 'DECIDE_WITHOUT_TIMING'::text) OR (expires_at <= (issued_at + '08:00:00'::interval)))),
    CONSTRAINT pairing_admin_without_timing_withdrawal_lifetime_check CHECK ((((capability)::text <> 'WITHDRAW_WITHOUT_TIMING'::text) OR (expires_at <= (issued_at + '08:00:00'::interval))))
);

CREATE TABLE public.pairing_admin_access_credential_revocation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    credential_id uuid NOT NULL,
    revoked_at timestamp with time zone NOT NULL,
    reason text NOT NULL
);

CREATE TABLE public.pairing_admin_revocation_guard (
    credential_id uuid NOT NULL,
    generation bigint DEFAULT 0 NOT NULL,
    CONSTRAINT pairing_admin_revocation_guard_generation_check CHECK ((generation >= 0))
);

CREATE TABLE public.pairing_admin_session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    access_credential_id uuid NOT NULL,
    session_secret_hash text NOT NULL,
    csrf_secret_hash text NOT NULL,
    issued_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT pairing_admin_session_check CHECK ((expires_at > issued_at)),
    CONSTRAINT pairing_admin_session_check1 CHECK ((expires_at <= (issued_at + '08:00:00'::interval))),
    CONSTRAINT pairing_admin_session_csrf_secret_hash_check CHECK ((csrf_secret_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT pairing_admin_session_session_secret_hash_check CHECK ((session_secret_hash ~ '^[a-f0-9]{64}$'::text))
);

CREATE TABLE public.pairing_admin_session_revocation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    revoked_at timestamp with time zone NOT NULL,
    reason text NOT NULL
);

CREATE TABLE public.participant_route (
    entry_id uuid NOT NULL,
    race_id uuid NOT NULL,
    file_name text NOT NULL,
    gpx bytea NOT NULL,
    sha256 text NOT NULL,
    byte_length integer NOT NULL,
    points jsonb NOT NULL,
    point_count integer NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    uploaded_at timestamp with time zone NOT NULL,
    CONSTRAINT participant_route_hash_check CHECK ((sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT participant_route_points_check CHECK (((jsonb_typeof(points) = 'array'::text) AND (point_count >= 2) AND (starts_at < ends_at))),
    CONSTRAINT participant_route_size_check CHECK (((byte_length BETWEEN 1 AND 8388608) AND (byte_length = octet_length(gpx))))
);

CREATE TABLE public.password_reset_token (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_by_superadmin boolean DEFAULT false NOT NULL,
    CONSTRAINT password_reset_token_hash_check CHECK ((token_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT password_reset_token_lifetime_check CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '01:00:00'::interval))))
);

CREATE TABLE public.public_result_update_event (
    event_sequence bigint NOT NULL,
    race_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.public_result_update_event ALTER COLUMN event_sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.public_result_update_event_event_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.race (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    name text NOT NULL,
    race_date date NOT NULL,
    snapshot_version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    race_type text DEFAULT 'STANDARD'::text NOT NULL,
    hidden_by_superadmin boolean DEFAULT false NOT NULL,
    published_at timestamp with time zone,
    short_code text DEFAULT public.generate_race_short_code() NOT NULL,
    CONSTRAINT race_short_code_check CHECK ((short_code ~ '^[2-9a-hjkmnp-z]{6}$'::text)),
    CONSTRAINT race_type_check CHECK ((race_type = ANY (ARRAY['TRAINING'::text, 'SMALL'::text, 'STANDARD'::text, 'FORKED'::text, 'RELAY'::text, 'ROGAINING'::text])))
);

CREATE TABLE public.race_copy_request (
    request_id uuid NOT NULL,
    actor_account_id uuid NOT NULL,
    source_race_id uuid NOT NULL,
    event_id uuid NOT NULL,
    race_id uuid NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT race_copy_request_distinct_check CHECK ((source_race_id <> race_id))
);

CREATE TABLE public.race_eventor_link (
    race_id uuid NOT NULL,
    key_id text,
    iv text,
    tag text,
    ciphertext text,
    organisation_id text,
    organisation_name text,
    event_id text,
    event_name text,
    event_date date,
    event_form text,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT race_eventor_link_envelope_check CHECK ((((key_id IS NULL) AND (iv IS NULL) AND (tag IS NULL) AND (ciphertext IS NULL)) OR ((key_id ~ '^[a-z0-9-]{1,64}$'::text) AND (iv ~ '^[A-Za-z0-9_-]{16}$'::text) AND (tag ~ '^[A-Za-z0-9_-]{22}$'::text) AND (ciphertext ~ '^[A-Za-z0-9_-]{22,172}$'::text)))),
    CONSTRAINT race_eventor_link_event_check CHECK ((((event_id IS NULL) = (event_name IS NULL)) AND ((event_id IS NULL) = (event_date IS NULL)) AND ((event_id IS NULL) = (event_form IS NULL)) AND ((event_form IS NULL) OR (event_form = ANY (ARRAY['INDIVIDUAL'::text, 'RELAY'::text, 'OTHER'::text]))))),
    CONSTRAINT race_eventor_link_organisation_check CHECK (((organisation_id IS NULL) = (organisation_name IS NULL)))
);

CREATE TABLE public.race_map (
    race_id uuid NOT NULL,
    file_name text NOT NULL,
    media_type text NOT NULL,
    image bytea NOT NULL,
    sha256 text NOT NULL,
    byte_length integer NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    tie_points jsonb,
    transform jsonb,
    uploaded_at timestamp with time zone NOT NULL,
    georeferenced_at timestamp with time zone,
    CONSTRAINT race_map_dimensions_check CHECK (((width BETWEEN 1 AND 30000) AND (height BETWEEN 1 AND 30000))),
    CONSTRAINT race_map_georeference_check CHECK ((((tie_points IS NULL) = (transform IS NULL)) AND ((transform IS NULL) = (georeferenced_at IS NULL)) AND ((tie_points IS NULL) OR (jsonb_typeof(tie_points) = 'array'::text)) AND ((transform IS NULL) OR (jsonb_typeof(transform) = 'object'::text)))),
    CONSTRAINT race_map_hash_check CHECK ((sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT race_map_media_type_check CHECK ((media_type = ANY (ARRAY['image/png'::text, 'image/jpeg'::text]))),
    CONSTRAINT race_map_size_check CHECK (((byte_length BETWEEN 1 AND 31457280) AND (byte_length = octet_length(image))))
);

CREATE TABLE public.race_radio_control (
    race_id uuid NOT NULL,
    control_code integer NOT NULL,
    label text,
    CONSTRAINT race_radio_control_code_check CHECK (((control_code >= 1) AND (control_code <= 9999))),
    CONSTRAINT race_radio_control_label_check CHECK (((label IS NULL) OR ((char_length(label) >= 1) AND (char_length(label) <= 40))))
);

CREATE TABLE public.race_radio_link (
    race_id uuid NOT NULL,
    source text NOT NULL,
    unit_id text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_punch_id bigint DEFAULT 0 NOT NULL,
    last_attempt_at timestamp with time zone,
    last_success_at timestamp with time zone,
    last_error text,
    last_error_at timestamp with time zone,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    malformed_lines integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT race_radio_link_counts_check CHECK (((last_punch_id >= 0) AND (consecutive_failures >= 0) AND (malformed_lines >= 0))),
    CONSTRAINT race_radio_link_error_check CHECK ((((last_error IS NULL) = (last_error_at IS NULL)) AND ((last_error IS NULL) OR (last_error = ANY (ARRAY['INVALID_INPUT'::text, 'INVALID_RESPONSE'::text, 'UPSTREAM_UNAVAILABLE'::text, 'REJECTED'::text, 'NOT_FOUND'::text, 'RESPONSE_TOO_LARGE'::text, 'TIMEOUT'::text]))))),
    CONSTRAINT race_radio_link_source_check CHECK ((source = ANY (ARRAY['ROC'::text, 'ORESULTS'::text]))),
    CONSTRAINT race_radio_link_unit_check CHECK ((unit_id ~ '^[A-Za-z0-9_-]{1,64}$'::text))
);

CREATE TABLE public.race_settings_request (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.radio_punch (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    race_id uuid NOT NULL,
    source text NOT NULL,
    unit_id text NOT NULL,
    punch_id bigint NOT NULL,
    control_code integer NOT NULL,
    card_number text NOT NULL,
    punched_at timestamp with time zone NOT NULL,
    local_time text NOT NULL,
    raw_line text NOT NULL,
    received_at timestamp with time zone NOT NULL,
    CONSTRAINT radio_punch_source_check CHECK ((source = ANY (ARRAY['ROC'::text, 'ORESULTS'::text]))),
    CONSTRAINT radio_punch_values_check CHECK (((punch_id > 0) AND ((control_code >= 1) AND (control_code <= 9999)) AND (card_number ~ '^[1-9][0-9]{0,7}$'::text) AND (local_time ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$'::text) AND (char_length(raw_line) <= 1000)))
);

CREATE TABLE public.raw_device_message (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    race_id uuid NOT NULL,
    device_id uuid NOT NULL,
    session_id uuid NOT NULL,
    local_sequence integer NOT NULL,
    package_version integer NOT NULL,
    station_received_at timestamp with time zone NOT NULL,
    server_received_at timestamp with time zone DEFAULT now() NOT NULL,
    transport text NOT NULL,
    raw_payload jsonb NOT NULL,
    content_hash text NOT NULL,
    parser_status text DEFAULT 'normalized'::text NOT NULL,
    CONSTRAINT raw_device_message_content_hash_check CHECK ((content_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT raw_device_message_local_sequence_check CHECK ((local_sequence > 0))
);

CREATE TABLE public.relay_leg (
    class_id uuid NOT NULL,
    race_id uuid NOT NULL,
    leg integer NOT NULL,
    start_method text NOT NULL,
    start_time timestamp with time zone,
    course_variant_code text,
    CONSTRAINT relay_leg_first_check CHECK (((leg <> 1) OR (start_method = 'MASS_START'::text))),
    CONSTRAINT relay_leg_method_check CHECK ((start_method = ANY (ARRAY['MASS_START'::text, 'CHANGEOVER'::text, 'RESTART'::text]))),
    CONSTRAINT relay_leg_number_check CHECK (((leg >= 1) AND (leg <= 20))),
    CONSTRAINT relay_leg_time_check CHECK (((start_method = 'CHANGEOVER'::text) = (start_time IS NULL))),
    CONSTRAINT relay_leg_variant_check CHECK (((course_variant_code IS NULL) OR ((char_length(course_variant_code) BETWEEN 1 AND 32) AND (course_variant_code = btrim(course_variant_code)))))
);

CREATE TABLE public.relay_request (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    kind text NOT NULL,
    class_id uuid NOT NULL,
    team_id uuid,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT relay_request_json_check CHECK (((jsonb_typeof(request) = 'object'::text) AND (jsonb_typeof(response) = 'object'::text))),
    CONSTRAINT relay_request_kind_check CHECK ((((kind = ANY (ARRAY['CLASS'::text, 'START_TIMES'::text])) AND (team_id IS NULL)) OR ((kind = ANY (ARRAY['TEAM'::text, 'LEG_RUNNER'::text])) AND (team_id IS NOT NULL)))),
    CONSTRAINT relay_request_role_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability))
);

CREATE TABLE public.result_approval_decision (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    expected_entry_version integer NOT NULL,
    expected_class_id uuid NOT NULL,
    expected_course_version_id uuid NOT NULL,
    expected_snapshot_version integer NOT NULL,
    target_result_revision_id uuid NOT NULL,
    target_result_revision integer NOT NULL,
    policy_version text NOT NULL,
    status text NOT NULL,
    reason text NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT result_approval_decision_created_revision_check CHECK ((created_result_revision = (target_result_revision + 1))),
    CONSTRAINT result_approval_decision_distinct_result_check CHECK ((target_result_revision_id <> created_result_revision_id)),
    CONSTRAINT result_approval_decision_expected_entry_version_check CHECK ((expected_entry_version > 0)),
    CONSTRAINT result_approval_decision_expected_snapshot_check CHECK ((expected_snapshot_version > 0)),
    CONSTRAINT result_approval_decision_policy_version_check CHECK (((length(btrim(policy_version)) >= 1) AND (length(btrim(policy_version)) <= 64))),
    CONSTRAINT result_approval_decision_status_check CHECK (((status = 'OK'::text) AND (reason = 'MANUAL_APPROVAL'::text))),
    CONSTRAINT result_approval_decision_target_revision_check CHECK ((target_result_revision > 0))
);

CREATE TABLE public.result_approval_withdrawal (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    expected_entry_version integer NOT NULL,
    expected_class_id uuid NOT NULL,
    expected_course_version_id uuid NOT NULL,
    expected_snapshot_version integer NOT NULL,
    approval_decision_id uuid NOT NULL,
    withdrawn_result_revision_id uuid NOT NULL,
    withdrawn_result_revision integer NOT NULL,
    expected_latest_result_revision_id uuid NOT NULL,
    expected_latest_result_revision integer NOT NULL,
    restored_from_result_revision_id uuid NOT NULL,
    restored_from_result_revision integer NOT NULL,
    policy_version text NOT NULL,
    reason text NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    withdrawn_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT result_approval_withdrawal_distinct_results_check CHECK (((withdrawn_result_revision_id <> restored_from_result_revision_id) AND (withdrawn_result_revision_id <> created_result_revision_id) AND (restored_from_result_revision_id <> created_result_revision_id))),
    CONSTRAINT result_approval_withdrawal_expected_entry_version_check CHECK ((expected_entry_version > 0)),
    CONSTRAINT result_approval_withdrawal_expected_snapshot_check CHECK ((expected_snapshot_version > 0)),
    CONSTRAINT result_approval_withdrawal_policy_version_check CHECK (((length(btrim(policy_version)) >= 1) AND (length(btrim(policy_version)) <= 64))),
    CONSTRAINT result_approval_withdrawal_reason_check CHECK ((reason = 'ERRONEOUS_MANUAL_APPROVAL'::text)),
    CONSTRAINT result_approval_withdrawal_revision_chain_check CHECK (((withdrawn_result_revision > 0) AND (expected_latest_result_revision >= withdrawn_result_revision) AND (restored_from_result_revision > 0) AND (restored_from_result_revision <= expected_latest_result_revision) AND (created_result_revision = (expected_latest_result_revision + 1))))
);

CREATE TABLE public.result_disqualification_decision (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    expected_entry_version integer NOT NULL,
    expected_class_id uuid NOT NULL,
    expected_course_version_id uuid NOT NULL,
    expected_snapshot_version integer NOT NULL,
    target_result_revision_id uuid NOT NULL,
    target_result_revision integer NOT NULL,
    policy_version text NOT NULL,
    status text NOT NULL,
    reason text NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT result_disqualification_decision_created_revision_check CHECK ((created_result_revision = (target_result_revision + 1))),
    CONSTRAINT result_disqualification_decision_distinct_result_check CHECK ((target_result_revision_id <> created_result_revision_id)),
    CONSTRAINT result_disqualification_decision_expected_entry_version_check CHECK ((expected_entry_version > 0)),
    CONSTRAINT result_disqualification_decision_expected_snapshot_check CHECK ((expected_snapshot_version > 0)),
    CONSTRAINT result_disqualification_decision_policy_version_check CHECK (((length(btrim(policy_version)) >= 1) AND (length(btrim(policy_version)) <= 64))),
    CONSTRAINT result_disqualification_decision_status_check CHECK (((status = 'DSQ'::text) AND (reason = 'MANUAL_DISQUALIFICATION'::text))),
    CONSTRAINT result_disqualification_decision_target_revision_check CHECK ((target_result_revision > 0))
);

CREATE TABLE public.result_disqualification_withdrawal (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    expected_entry_version integer NOT NULL,
    expected_class_id uuid NOT NULL,
    expected_course_version_id uuid NOT NULL,
    expected_snapshot_version integer NOT NULL,
    disqualification_decision_id uuid NOT NULL,
    withdrawn_result_revision_id uuid NOT NULL,
    withdrawn_result_revision integer NOT NULL,
    expected_latest_result_revision_id uuid NOT NULL,
    expected_latest_result_revision integer NOT NULL,
    restored_from_result_revision_id uuid NOT NULL,
    restored_from_result_revision integer NOT NULL,
    policy_version text NOT NULL,
    reason text NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    withdrawn_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT result_disqualification_withdrawal_distinct_results_check CHECK (((withdrawn_result_revision_id <> restored_from_result_revision_id) AND (withdrawn_result_revision_id <> created_result_revision_id) AND (restored_from_result_revision_id <> created_result_revision_id))),
    CONSTRAINT result_disqualification_withdrawal_expected_entry_version_check CHECK ((expected_entry_version > 0)),
    CONSTRAINT result_disqualification_withdrawal_expected_snapshot_check CHECK ((expected_snapshot_version > 0)),
    CONSTRAINT result_disqualification_withdrawal_policy_version_check CHECK (((length(btrim(policy_version)) >= 1) AND (length(btrim(policy_version)) <= 64))),
    CONSTRAINT result_disqualification_withdrawal_reason_check CHECK ((reason = 'ERRONEOUS_MANUAL_DISQUALIFICATION'::text)),
    CONSTRAINT result_disqualification_withdrawal_revision_chain_check CHECK (((withdrawn_result_revision > 0) AND (expected_latest_result_revision >= withdrawn_result_revision) AND (restored_from_result_revision > 0) AND (restored_from_result_revision <= expected_latest_result_revision) AND (created_result_revision = (expected_latest_result_revision + 1))))
);

CREATE TABLE public.result_finalization (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    scope public.result_finalization_scope NOT NULL,
    class_id uuid,
    scope_revision integer NOT NULL,
    source_snapshot_version integer NOT NULL,
    source_hash text NOT NULL,
    frozen_projection jsonb NOT NULL,
    complete_xml text,
    complete_xml_hash text,
    actor_credential_id uuid NOT NULL,
    finalized_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT result_finalization_frozen_projection_object_check CHECK ((jsonb_typeof(frozen_projection) = 'object'::text)),
    CONSTRAINT result_finalization_scope_payload_check CHECK ((((scope = 'CLASS'::public.result_finalization_scope) AND (class_id IS NOT NULL) AND (complete_xml IS NULL) AND (complete_xml_hash IS NULL)) OR ((scope = 'RACE'::public.result_finalization_scope) AND (class_id IS NULL) AND (complete_xml IS NOT NULL) AND (length(complete_xml) > 0) AND (complete_xml_hash IS NOT NULL) AND (complete_xml_hash ~ '^[a-f0-9]{64}$'::text)))),
    CONSTRAINT result_finalization_scope_revision_check CHECK ((scope_revision > 0)),
    CONSTRAINT result_finalization_source_hash_check CHECK ((source_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT result_finalization_source_snapshot_version_check CHECK ((source_snapshot_version > 0))
);

CREATE TABLE public.result_recalculation_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    expected_entry_version integer NOT NULL,
    expected_class_id uuid NOT NULL,
    expected_snapshot_version integer NOT NULL,
    expected_card_assignment_id uuid NOT NULL,
    expected_readout_id uuid NOT NULL,
    expected_latest_result_revision_id uuid,
    expected_latest_result_revision integer NOT NULL,
    expected_engine_version text NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    recalculated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT result_recalculation_request_created_revision_check CHECK ((created_result_revision = (expected_latest_result_revision + 1))),
    CONSTRAINT result_recalculation_request_engine_version_check CHECK (((length(btrim(expected_engine_version)) >= 1) AND (length(btrim(expected_engine_version)) <= 64))),
    CONSTRAINT result_recalculation_request_expected_entry_version_check CHECK ((expected_entry_version > 0)),
    CONSTRAINT result_recalculation_request_expected_revision_pair_check CHECK ((((expected_latest_result_revision_id IS NULL) AND (expected_latest_result_revision = 0)) OR ((expected_latest_result_revision_id IS NOT NULL) AND (expected_latest_result_revision > 0)))),
    CONSTRAINT result_recalculation_request_expected_snapshot_version_check CHECK ((expected_snapshot_version > 0))
);

CREATE TABLE public.result_revision (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    readout_id uuid,
    revision integer NOT NULL,
    cause public.revision_cause NOT NULL,
    status text NOT NULL,
    reason text NOT NULL,
    evaluation jsonb NOT NULL,
    engine_version text NOT NULL,
    snapshot_version integer NOT NULL,
    course_version_id uuid NOT NULL,
    published boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    did_not_start_decision_id uuid,
    disqualification_decision_id uuid,
    disqualification_withdrawal_id uuid,
    approval_decision_id uuid,
    approval_withdrawal_id uuid,
    did_not_finish_decision_id uuid,
    did_not_finish_withdrawal_id uuid,
    not_competing_decision_id uuid,
    not_competing_withdrawal_id uuid,
    without_timing_decision_id uuid,
    without_timing_withdrawal_id uuid,
    start_checkin_dns_decision_id uuid,
    control_neutralization_id uuid,
    manual_finish_time_correction_id uuid,
    manual_finish_time_correction_withdrawal_id uuid,
    manual_punch_start_time_correction_id uuid,
    manual_punch_start_time_correction_withdrawal_id uuid,
    shortened_course_class_transfer_id uuid,
    basis_hash text,
    CONSTRAINT result_revision_manual_finish_time_correction_provenance_check CHECK (((((cause)::text = 'MANUAL_FINISH_TIME_CORRECTION'::text) AND (readout_id IS NULL) AND (manual_finish_time_correction_id IS NOT NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0) AND (((status = 'OK'::text) AND (reason = 'COMPLETE'::text)) OR ((status = 'MP'::text) AND (reason = ANY (ARRAY['MISSING_CONTROL'::text, 'WRONG_ORDER'::text]))))) OR (((cause)::text <> 'MANUAL_FINISH_TIME_CORRECTION'::text) AND (manual_finish_time_correction_id IS NULL)))),
    CONSTRAINT result_revision_manual_punch_start_time_correction_provenance_c CHECK (((((cause)::text = 'MANUAL_PUNCH_START_TIME_CORRECTION'::text) AND (readout_id IS NULL) AND (manual_punch_start_time_correction_id IS NOT NULL) AND (manual_finish_time_correction_id IS NULL) AND (manual_finish_time_correction_withdrawal_id IS NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0) AND (((status = 'OK'::text) AND (reason = 'COMPLETE'::text)) OR ((status = 'MP'::text) AND (reason = ANY (ARRAY['MISSING_CONTROL'::text, 'WRONG_ORDER'::text]))))) OR (((cause)::text <> 'MANUAL_PUNCH_START_TIME_CORRECTION'::text) AND (manual_punch_start_time_correction_id IS NULL)))),
    CONSTRAINT result_revision_shortened_course_class_transfer_provenance_chec CHECK (((((cause)::text = 'SHORTENED_COURSE_CLASS_TRANSFER'::text) AND (readout_id IS NOT NULL) AND (shortened_course_class_transfer_id IS NOT NULL) AND (manual_finish_time_correction_id IS NULL) AND (manual_finish_time_correction_withdrawal_id IS NULL) AND (manual_punch_start_time_correction_id IS NULL) AND (manual_punch_start_time_correction_withdrawal_id IS NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0) AND (((status = 'OK'::text) AND (reason = 'COMPLETE'::text)) OR ((status = 'MP'::text) AND (reason = ANY (ARRAY['MISSING_START'::text, 'MISSING_FINISH'::text, 'MISSING_CONTROL'::text, 'WRONG_ORDER'::text, 'INVALID_TIME_ORDER'::text]))))) OR (((cause)::text <> 'SHORTENED_COURSE_CLASS_TRANSFER'::text) AND (shortened_course_class_transfer_id IS NULL)))),
    CONSTRAINT result_revision_source_provenance_check CHECK (((((cause)::text = 'SHORTENED_COURSE_CLASS_TRANSFER'::text) AND (readout_id IS NOT NULL) AND (shortened_course_class_transfer_id IS NOT NULL) AND (manual_finish_time_correction_id IS NULL) AND (manual_finish_time_correction_withdrawal_id IS NULL) AND (manual_punch_start_time_correction_id IS NULL) AND (manual_punch_start_time_correction_withdrawal_id IS NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0) AND (((status = 'OK'::text) AND (reason = 'COMPLETE'::text)) OR ((status = 'MP'::text) AND (reason = ANY (ARRAY['MISSING_START'::text, 'MISSING_FINISH'::text, 'MISSING_CONTROL'::text, 'WRONG_ORDER'::text, 'INVALID_TIME_ORDER'::text]))))) OR ((((cause)::text = 'MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL'::text) AND (readout_id IS NULL) AND (manual_punch_start_time_correction_id IS NULL) AND (manual_punch_start_time_correction_withdrawal_id IS NOT NULL) AND (manual_finish_time_correction_id IS NULL) AND (manual_finish_time_correction_withdrawal_id IS NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0) AND (((status = 'OK'::text) AND (reason = 'COMPLETE'::text)) OR ((status = 'MP'::text) AND (reason = ANY (ARRAY['MISSING_CONTROL'::text, 'WRONG_ORDER'::text]))))) OR ((((cause)::text = 'MANUAL_PUNCH_START_TIME_CORRECTION'::text) AND (readout_id IS NULL) AND (manual_punch_start_time_correction_id IS NOT NULL) AND (manual_finish_time_correction_id IS NULL) AND (manual_finish_time_correction_withdrawal_id IS NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0) AND (((status = 'OK'::text) AND (reason = 'COMPLETE'::text)) OR ((status = 'MP'::text) AND (reason = ANY (ARRAY['MISSING_CONTROL'::text, 'WRONG_ORDER'::text]))))) OR ((((cause)::text = 'MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL'::text) AND (readout_id IS NULL) AND (manual_finish_time_correction_id IS NULL) AND (manual_finish_time_correction_withdrawal_id IS NOT NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0) AND (((status = 'OK'::text) AND (reason = 'COMPLETE'::text)) OR ((status = 'MP'::text) AND (reason = ANY (ARRAY['MISSING_CONTROL'::text, 'WRONG_ORDER'::text]))))) OR ((((cause)::text = 'MANUAL_FINISH_TIME_CORRECTION'::text) AND (readout_id IS NULL) AND (manual_finish_time_correction_id IS NOT NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0) AND (((status = 'OK'::text) AND (reason = 'COMPLETE'::text)) OR ((status = 'MP'::text) AND (reason = ANY (ARRAY['MISSING_CONTROL'::text, 'WRONG_ORDER'::text]))))) OR (((((cause)::text = ANY (ARRAY['CARD_READOUT'::text, 'CLASS_CHANGE_RECALCULATION'::text, 'EXPLICIT_RECALCULATION'::text, 'UNKNOWN_READOUT_RESOLUTION'::text])) AND (readout_id IS NOT NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0)) OR (((cause)::text = 'MANUAL_DID_NOT_START'::text) AND (readout_id IS NULL) AND (did_not_start_decision_id IS NOT NULL) AND (num_nonnulls(disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0)) OR (((cause)::text = 'MANUAL_DISQUALIFICATION'::text) AND (readout_id IS NULL) AND (disqualification_decision_id IS NOT NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0)) OR (((cause)::text = 'MANUAL_DISQUALIFICATION_WITHDRAWAL'::text) AND (readout_id IS NULL) AND (disqualification_withdrawal_id IS NOT NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0)) OR (((cause)::text = 'MANUAL_RESULT_APPROVAL'::text) AND (readout_id IS NULL) AND (approval_decision_id IS NOT NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0)) OR (((cause)::text = 'MANUAL_RESULT_APPROVAL_WITHDRAWAL'::text) AND (readout_id IS NULL) AND (approval_withdrawal_id IS NOT NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0)) OR (((cause)::text = 'MANUAL_DID_NOT_FINISH'::text) AND (readout_id IS NULL) AND (did_not_finish_decision_id IS NOT NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0)) OR (((cause)::text = 'MANUAL_DID_NOT_FINISH_WITHDRAWAL'::text) AND (readout_id IS NULL) AND (did_not_finish_withdrawal_id IS NOT NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0)) OR (((cause)::text = 'MANUAL_OUT_OF_COMPETITION'::text) AND (readout_id IS NULL) AND (not_competing_decision_id IS NOT NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0)) OR (((cause)::text = 'MANUAL_OUT_OF_COMPETITION_WITHDRAWAL'::text) AND (readout_id IS NULL) AND (not_competing_withdrawal_id IS NOT NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0)) OR (((cause)::text = 'MANUAL_WITHOUT_TIMING'::text) AND (readout_id IS NULL) AND (without_timing_decision_id IS NOT NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0)) OR (((cause)::text = 'MANUAL_WITHOUT_TIMING_WITHDRAWAL'::text) AND (readout_id IS NULL) AND (without_timing_withdrawal_id IS NOT NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, start_checkin_dns_decision_id) = 0)) OR (((cause)::text = 'START_CHECKIN_DID_NOT_START'::text) AND (readout_id IS NULL) AND (start_checkin_dns_decision_id IS NOT NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id) = 0))) AND ((((cause)::text = ANY (ARRAY['CARD_READOUT'::text, 'CLASS_CHANGE_RECALCULATION'::text, 'EXPLICIT_RECALCULATION'::text, 'UNKNOWN_READOUT_RESOLUTION'::text, 'MANUAL_DISQUALIFICATION_WITHDRAWAL'::text, 'MANUAL_RESULT_APPROVAL_WITHDRAWAL'::text, 'MANUAL_DID_NOT_FINISH_WITHDRAWAL'::text, 'MANUAL_OUT_OF_COMPETITION_WITHDRAWAL'::text, 'MANUAL_WITHOUT_TIMING_WITHDRAWAL'::text])) AND (((status = 'OK'::text) AND (reason = 'COMPLETE'::text)) OR ((status = 'MP'::text) AND (reason = ANY (ARRAY['MISSING_START'::text, 'MISSING_FINISH'::text, 'MISSING_CONTROL'::text, 'WRONG_ORDER'::text, 'INVALID_TIME_ORDER'::text]))))) OR (((cause)::text = ANY (ARRAY['MANUAL_DID_NOT_START'::text, 'START_CHECKIN_DID_NOT_START'::text])) AND (status = 'DNS'::text) AND (reason = 'DID_NOT_START'::text)) OR (((cause)::text = 'MANUAL_DISQUALIFICATION'::text) AND (status = 'DSQ'::text) AND (reason = 'MANUAL_DISQUALIFICATION'::text)) OR (((cause)::text = 'MANUAL_RESULT_APPROVAL'::text) AND (status = 'OK'::text) AND (reason = 'MANUAL_APPROVAL'::text)) OR (((cause)::text = 'MANUAL_DID_NOT_FINISH'::text) AND (status = 'DNF'::text) AND (reason = 'DID_NOT_FINISH'::text)) OR (((cause)::text = 'MANUAL_OUT_OF_COMPETITION'::text) AND (status = 'OOC'::text) AND (reason = 'OUT_OF_COMPETITION'::text)) OR (((cause)::text = 'MANUAL_WITHOUT_TIMING'::text) AND (status = 'NT'::text) AND (reason = 'WITHOUT_TIMING'::text)))))))))),
    CONSTRAINT rr_mpscw_provenance_check CHECK (((((cause)::text = 'MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL'::text) AND (readout_id IS NULL) AND (manual_punch_start_time_correction_id IS NULL) AND (manual_punch_start_time_correction_withdrawal_id IS NOT NULL) AND (manual_finish_time_correction_id IS NULL) AND (manual_finish_time_correction_withdrawal_id IS NULL) AND (num_nonnulls(did_not_start_decision_id, disqualification_decision_id, disqualification_withdrawal_id, approval_decision_id, approval_withdrawal_id, did_not_finish_decision_id, did_not_finish_withdrawal_id, not_competing_decision_id, not_competing_withdrawal_id, without_timing_decision_id, without_timing_withdrawal_id, start_checkin_dns_decision_id) = 0)) OR (((cause)::text <> 'MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL'::text) AND (manual_punch_start_time_correction_withdrawal_id IS NULL))))
);

CREATE TABLE public.rogaining_change_request (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    changed_at timestamp with time zone NOT NULL,
    CONSTRAINT rogaining_change_request_json_check CHECK (((jsonb_typeof(request) = 'object'::text) AND (jsonb_typeof(response) = 'object'::text))),
    CONSTRAINT rogaining_change_request_role_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability))
);

CREATE TABLE public.shortened_course_class_transfer (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    source_class_id uuid NOT NULL,
    source_course_id uuid NOT NULL,
    source_course_version_id uuid NOT NULL,
    short_course_id uuid NOT NULL,
    short_course_version_id uuid NOT NULL,
    short_class_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    source_snapshot_version integer NOT NULL,
    source_hash text NOT NULL,
    frozen_basis jsonb NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    transferred_at timestamp with time zone NOT NULL,
    CONSTRAINT shortened_course_class_transfer_capability_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability)),
    CONSTRAINT shortened_course_class_transfer_hash_check CHECK ((source_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT shortened_course_class_transfer_json_check CHECK (((jsonb_typeof(frozen_basis) = 'object'::text) AND (jsonb_typeof(request) = 'object'::text) AND (jsonb_typeof(response) = 'object'::text))),
    CONSTRAINT shortened_course_class_transfer_snapshot_check CHECK ((source_snapshot_version > 0))
);

CREATE TABLE public.shortened_course_class_transfer_item (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    entry_version_before integer NOT NULL,
    entry_version_after integer NOT NULL,
    source_result_revision_id uuid,
    source_result_revision integer,
    source_readout_id uuid,
    created_result_revision_id uuid,
    created_result_revision integer,
    CONSTRAINT shortened_course_class_transfer_item_result_chain_check CHECK ((((source_result_revision_id IS NULL) AND (source_result_revision IS NULL) AND (source_readout_id IS NULL) AND (created_result_revision_id IS NULL) AND (created_result_revision IS NULL)) OR ((source_result_revision_id IS NOT NULL) AND (source_result_revision IS NOT NULL) AND (source_readout_id IS NOT NULL) AND (created_result_revision_id IS NOT NULL) AND (created_result_revision IS NOT NULL) AND ((created_result_revision)::bigint = ((source_result_revision)::bigint + 1))))),
    CONSTRAINT shortened_course_class_transfer_item_version_check CHECK (((entry_version_before > 0) AND ((entry_version_after)::bigint = ((entry_version_before)::bigint + 1))))
);

CREATE TABLE public.source_snapshot (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    race_id uuid NOT NULL,
    source text NOT NULL,
    content_hash text NOT NULL,
    projection jsonb NOT NULL,
    original_xml text,
    file_name text,
    fetched_at timestamp with time zone NOT NULL,
    applied_request_id uuid,
    applied_at timestamp with time zone,
    actor_credential_id uuid,
    apply_request jsonb,
    apply_response jsonb,
    CONSTRAINT source_snapshot_applied_check CHECK ((((applied_request_id IS NULL) = (applied_at IS NULL)) AND ((applied_at IS NULL) = (apply_response IS NULL)) AND ((applied_at IS NULL) = (apply_request IS NULL)) AND ((applied_at IS NULL) = (actor_credential_id IS NULL)))),
    CONSTRAINT source_snapshot_file_check CHECK (((source = 'COURSE_FILE'::text) = (original_xml IS NOT NULL))),
    CONSTRAINT source_snapshot_hash_check CHECK ((content_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT source_snapshot_source_check CHECK ((source = ANY (ARRAY['EVENTOR'::text, 'COURSE_FILE'::text])))
);

CREATE TABLE public.start_checkin_conflict_review (
    id uuid NOT NULL,
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    decision text NOT NULL,
    reason text NOT NULL,
    source_hash text NOT NULL,
    intent_canonical_json text NOT NULL,
    intent_hash text NOT NULL,
    reviewed_at timestamp with time zone NOT NULL,
    CONSTRAINT start_checkin_conflict_review_capability_check CHECK ((capability = ANY (ARRAY['FINISH_FOREST_WATCH'::public.pairing_admin_capability, 'MANAGE_RACE'::public.pairing_admin_capability]))),
    CONSTRAINT start_checkin_conflict_review_decision_check CHECK ((decision = 'KEEP_CURRENT_STATE'::text)),
    CONSTRAINT start_checkin_conflict_review_hash_check CHECK (((source_hash ~ '^[a-f0-9]{64}$'::text) AND (intent_hash ~ '^[a-f0-9]{64}$'::text))),
    CONSTRAINT start_checkin_conflict_review_intent_check CHECK ((jsonb_typeof((intent_canonical_json)::jsonb) = 'object'::text)),
    CONSTRAINT start_checkin_conflict_review_reason_check CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 500)))
);

CREATE TABLE public.start_checkin_conflict_review_item (
    review_id uuid NOT NULL,
    conflict_request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    content_hash text NOT NULL,
    operation_effect text DEFAULT 'CONFLICT'::text NOT NULL,
    CONSTRAINT start_checkin_conflict_review_item_effect_check CHECK ((operation_effect = 'CONFLICT'::text)),
    CONSTRAINT start_checkin_conflict_review_item_hash_check CHECK ((content_hash ~ '^[a-f0-9]{64}$'::text))
);

CREATE TABLE public.start_checkin_device (
    id uuid NOT NULL,
    race_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    label text NOT NULL,
    registered_at timestamp with time zone NOT NULL,
    CONSTRAINT start_checkin_device_capability_check CHECK (((capability)::text = ANY (ARRAY['START_CHECKIN'::text, 'FINISH_FOREST_WATCH'::text, 'MANAGE_RACE'::text, 'RACE_FUNCTIONARY'::text]))),
    CONSTRAINT start_checkin_device_label_check CHECK (((length(btrim(label)) >= 1) AND (length(btrim(label)) <= 120)))
);

CREATE TABLE public.start_checkin_dns_decision (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    operation_request_id uuid NOT NULL,
    start_checkin_revision_id uuid NOT NULL,
    operational_revision integer NOT NULL,
    class_id uuid NOT NULL,
    course_version_id uuid NOT NULL,
    snapshot_version integer NOT NULL,
    expected_latest_result_revision integer NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    policy_version text NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT start_checkin_dns_decision_created_revision_check CHECK (((created_result_revision)::bigint = ((expected_latest_result_revision)::bigint + 1))),
    CONSTRAINT start_checkin_dns_decision_policy_version_check CHECK ((policy_version = 'start-checkin-dns-v1'::text)),
    CONSTRAINT start_checkin_dns_decision_positive_check CHECK (((operational_revision > 0) AND (snapshot_version > 0) AND (expected_latest_result_revision >= 0) AND (created_result_revision > 0)))
);

CREATE TABLE public.start_checkin_dns_withdrawal (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    operation_request_id uuid NOT NULL,
    start_checkin_revision_id uuid NOT NULL,
    operational_revision integer NOT NULL,
    start_checkin_dns_decision_id uuid NOT NULL,
    withdrawn_result_revision_id uuid NOT NULL,
    withdrawn_result_revision integer NOT NULL,
    policy_version text NOT NULL,
    withdrawn_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT start_checkin_dns_withdrawal_policy_version_check CHECK ((policy_version = 'start-checkin-dns-withdrawal-v1'::text)),
    CONSTRAINT start_checkin_dns_withdrawal_positive_check CHECK (((operational_revision > 0) AND (withdrawn_result_revision > 0)))
);

CREATE TABLE public.start_checkin_operation (
    request_id uuid NOT NULL,
    device_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    local_sequence integer NOT NULL,
    package_version integer NOT NULL,
    expected_entry_version integer NOT NULL,
    expected_revision integer NOT NULL,
    content_hash text NOT NULL,
    intent jsonb NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone NOT NULL,
    effect text NOT NULL,
    resulting_revision integer NOT NULL,
    created_revision_id uuid,
    conflict_reason text,
    receipt jsonb NOT NULL,
    CONSTRAINT start_checkin_operation_counters_check CHECK (((local_sequence > 0) AND (package_version > 0) AND (expected_entry_version > 0) AND (expected_revision >= 0) AND (resulting_revision >= 0))),
    CONSTRAINT start_checkin_operation_effect_check CHECK ((((effect = 'APPLIED'::text) AND (created_revision_id IS NOT NULL) AND ((resulting_revision)::bigint = ((expected_revision)::bigint + 1)) AND (conflict_reason IS NULL)) OR ((effect = 'UNCHANGED'::text) AND (created_revision_id IS NULL) AND (resulting_revision = expected_revision) AND (conflict_reason IS NULL)) OR ((effect = 'CONFLICT'::text) AND (created_revision_id IS NULL) AND (conflict_reason IS NOT NULL) AND (conflict_reason = ANY (ARRAY['STALE_ENTRY'::text, 'STALE_PACKAGE'::text, 'STALE_REVISION'::text, 'RETURN_ALREADY_REGISTERED'::text, 'RESULT_CONFLICT'::text, 'DEPENDENCY_CONFLICT'::text]))))),
    CONSTRAINT start_checkin_operation_hash_check CHECK ((content_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT start_checkin_operation_json_check CHECK (((jsonb_typeof(intent) = 'object'::text) AND (jsonb_typeof(receipt) = 'object'::text)))
);

CREATE TABLE public.start_checkin_revision (
    id uuid NOT NULL,
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    revision integer NOT NULL,
    operation_effect text DEFAULT 'APPLIED'::text NOT NULL,
    start_state text NOT NULL,
    manual_return_registered boolean NOT NULL,
    CONSTRAINT start_checkin_revision_effect_check CHECK ((operation_effect = 'APPLIED'::text)),
    CONSTRAINT start_checkin_revision_positive_check CHECK ((revision > 0)),
    CONSTRAINT start_checkin_revision_state_check CHECK ((start_state = ANY (ARRAY['UNMARKED'::text, 'STARTED'::text, 'REPORTED_NOT_STARTED'::text])))
);

CREATE TABLE public.start_draw_class (
    draw_id uuid NOT NULL,
    race_id uuid NOT NULL,
    class_id uuid NOT NULL,
    method text NOT NULL,
    first_start_time timestamp with time zone NOT NULL,
    interval_seconds integer NOT NULL,
    vacancy_count integer NOT NULL,
    CONSTRAINT start_draw_class_interval_check CHECK (((interval_seconds BETWEEN 60 AND 3600) AND ((interval_seconds % 60) = 0))),
    CONSTRAINT start_draw_class_method_check CHECK ((method = ANY (ARRAY['MINUTE'::text, 'MASS'::text]))),
    CONSTRAINT start_draw_class_minute_check CHECK ((date_trunc('minute'::text, first_start_time) = first_start_time)),
    CONSTRAINT start_draw_class_vacancy_check CHECK (((vacancy_count >= 0) AND (vacancy_count <= 10000)))
);

CREATE TABLE public.start_draw_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    seed bigint NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    snapshot_version_before integer NOT NULL,
    snapshot_version_after integer NOT NULL,
    drawn_at timestamp with time zone NOT NULL,
    CONSTRAINT start_draw_request_json_check CHECK (((jsonb_typeof(request) = 'object'::text) AND (jsonb_typeof(response) = 'object'::text))),
    CONSTRAINT start_draw_request_role_check CHECK ((capability = 'MANAGE_RACE'::public.pairing_admin_capability)),
    CONSTRAINT start_draw_request_seed_check CHECK (((seed >= 1) AND (seed <= '4294967295'::bigint))),
    CONSTRAINT start_draw_request_snapshot_check CHECK (((snapshot_version_before > 0) AND (snapshot_version_after = (snapshot_version_before + 1))))
);

CREATE TABLE public.start_draw_slot (
    draw_id uuid NOT NULL,
    class_id uuid NOT NULL,
    "position" integer NOT NULL,
    start_time timestamp with time zone NOT NULL,
    entry_id uuid,
    CONSTRAINT start_draw_slot_position_check CHECK (("position" >= 0))
);

CREATE TABLE public.start_list_publication (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    revision integer NOT NULL,
    action text NOT NULL,
    intent jsonb NOT NULL,
    source_snapshot_version integer NOT NULL,
    source_hash text,
    content jsonb,
    decided_at timestamp with time zone NOT NULL,
    iof_start_list_xml text,
    CONSTRAINT start_list_publication_action_check CHECK ((action = ANY (ARRAY['PUBLISH'::text, 'WITHDRAW'::text]))),
    CONSTRAINT start_list_publication_intent_check CHECK ((jsonb_typeof(intent) = 'object'::text)),
    CONSTRAINT start_list_publication_payload_check CHECK ((((action = 'PUBLISH'::text) AND (source_hash IS NOT NULL) AND (source_hash ~ '^[a-f0-9]{64}$'::text) AND (content IS NOT NULL) AND (jsonb_typeof(content) = 'object'::text)) OR ((action = 'WITHDRAW'::text) AND (source_hash IS NULL) AND (content IS NULL)))),
    CONSTRAINT start_list_publication_revision_check CHECK (((revision > 0) AND (source_snapshot_version > 0))),
    CONSTRAINT start_list_publication_xml_check CHECK (((iof_start_list_xml IS NULL) OR ((action = 'PUBLISH'::text) AND ((octet_length(iof_start_list_xml) >= 1) AND (octet_length(iof_start_list_xml) <= 67108864)))))
);

CREATE TABLE public.superadmin_action (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone NOT NULL,
    actor_account_id uuid,
    actor_label text NOT NULL,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    target_label text NOT NULL,
    reason text NOT NULL,
    CONSTRAINT superadmin_action_action_check CHECK ((action = ANY (ARRAY['GRANT_SUPERADMIN'::text, 'REVOKE_SUPERADMIN'::text, 'HIDE_RACE'::text, 'UNHIDE_RACE'::text, 'DELETE_EVENT'::text, 'BLOCK_ACCOUNT'::text, 'UNBLOCK_ACCOUNT'::text, 'DELETE_ACCOUNT'::text, 'CREATE_RESET_LINK'::text]))),
    CONSTRAINT superadmin_action_actor_label_check CHECK (((length(btrim(actor_label)) >= 1) AND (length(btrim(actor_label)) <= 254))),
    CONSTRAINT superadmin_action_reason_check CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 500))),
    CONSTRAINT superadmin_action_target_label_check CHECK (((length(btrim(target_label)) >= 1) AND (length(btrim(target_label)) <= 320))),
    CONSTRAINT superadmin_action_target_type_check CHECK ((target_type = ANY (ARRAY['ACCOUNT'::text, 'EVENT'::text, 'RACE'::text])))
);

CREATE TABLE public.team (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    race_id uuid NOT NULL,
    class_id uuid NOT NULL,
    number integer NOT NULL,
    name text NOT NULL,
    organisation_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    external_source text,
    external_id text,
    CONSTRAINT team_name_check CHECK (((char_length(name) BETWEEN 1 AND 160) AND (name = btrim(name)))),
    CONSTRAINT team_number_check CHECK (((number >= 1) AND (number <= 99999))),
    CONSTRAINT team_organisation_check CHECK (((organisation_name IS NULL) OR ((char_length(organisation_name) BETWEEN 1 AND 200) AND (organisation_name = btrim(organisation_name)))))
);

CREATE TABLE public.unknown_readout_resolution (
    request_id uuid NOT NULL,
    race_id uuid NOT NULL,
    readout_id uuid NOT NULL,
    raw_message_id uuid NOT NULL,
    card_number text NOT NULL,
    actor_credential_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    target text NOT NULL,
    entry_id uuid NOT NULL,
    class_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    expected_snapshot_version integer NOT NULL,
    snapshot_version_after integer NOT NULL,
    request jsonb NOT NULL,
    response jsonb NOT NULL,
    resolved_at timestamp with time zone NOT NULL,
    CONSTRAINT unknown_readout_resolution_capability_check CHECK ((((capability)::text = 'MANAGE_RACE'::text) OR (((capability)::text = 'RACE_FUNCTIONARY'::text) AND (target = 'NEW_ENTRY'::text)))),
    CONSTRAINT unknown_readout_resolution_check CHECK (((expected_snapshot_version > 0) AND ((snapshot_version_after)::bigint = ((expected_snapshot_version)::bigint + 1)))),
    CONSTRAINT unknown_readout_resolution_check1 CHECK (((jsonb_typeof(request) = 'object'::text) AND (jsonb_typeof(response) = 'object'::text))),
    CONSTRAINT unknown_readout_resolution_created_result_revision_check CHECK ((created_result_revision > 0)),
    CONSTRAINT unknown_readout_resolution_target_check CHECK ((target = ANY (ARRAY['EXISTING_ENTRY'::text, 'NEW_ENTRY'::text])))
);

CREATE TABLE public.user_account (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    display_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    email text NOT NULL,
    is_superadmin boolean DEFAULT false NOT NULL,
    blocked_at timestamp with time zone,
    last_login_at timestamp with time zone,
    CONSTRAINT user_account_display_name_check CHECK (((length(btrim(display_name)) >= 1) AND (length(btrim(display_name)) <= 120))),
    CONSTRAINT user_account_email_check CHECK (((email = lower(btrim(email))) AND ((length(email) >= 3) AND (length(email) <= 254)) AND (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'::text)))
);

CREATE TABLE public.user_account_auth_guard (
    account_id uuid NOT NULL,
    generation bigint DEFAULT 0 NOT NULL,
    CONSTRAINT user_account_auth_guard_generation_check CHECK ((generation >= 0))
);

CREATE TABLE public.user_account_event_creation_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    actor_account_id uuid NOT NULL,
    event_name text NOT NULL,
    race_name text NOT NULL,
    race_date date NOT NULL,
    time_zone text NOT NULL,
    event_id uuid NOT NULL,
    race_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    race_type text DEFAULT 'STANDARD'::text NOT NULL,
    CONSTRAINT user_account_event_creation_event_name_check CHECK (((length(btrim(event_name)) >= 2) AND (length(btrim(event_name)) <= 160))),
    CONSTRAINT user_account_event_creation_race_name_check CHECK (((length(btrim(race_name)) >= 2) AND (length(btrim(race_name)) <= 160))),
    CONSTRAINT user_account_event_creation_race_type_check CHECK ((race_type = ANY (ARRAY['TRAINING'::text, 'SMALL'::text, 'STANDARD'::text, 'FORKED'::text, 'RELAY'::text, 'ROGAINING'::text]))),
    CONSTRAINT user_account_event_creation_time_zone_check CHECK (((length(btrim(time_zone)) >= 1) AND (length(btrim(time_zone)) <= 100)))
);

CREATE TABLE public.user_account_login_throttle (
    login_key_hash text NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    failed_attempts integer NOT NULL,
    blocked_until timestamp with time zone,
    CONSTRAINT user_account_login_throttle_attempts_check CHECK ((failed_attempts >= 0)),
    CONSTRAINT user_account_login_throttle_key_check CHECK ((login_key_hash ~ '^[a-f0-9]{64}$'::text))
);

CREATE TABLE public.user_account_password_verifier (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    version integer NOT NULL,
    algorithm text NOT NULL,
    salt_hex text NOT NULL,
    verifier_hex text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_account_password_verifier_algorithm_check CHECK ((algorithm = 'scrypt-v1'::text)),
    CONSTRAINT user_account_password_verifier_hash_check CHECK ((verifier_hex ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT user_account_password_verifier_salt_check CHECK ((salt_hex ~ '^[a-f0-9]{32}$'::text)),
    CONSTRAINT user_account_password_verifier_version_check CHECK ((version > 0))
);

CREATE TABLE public.user_account_race_delegation (
    credential_id uuid NOT NULL,
    account_id uuid NOT NULL,
    account_session_id uuid NOT NULL,
    grant_id uuid NOT NULL,
    event_id uuid NOT NULL,
    race_id uuid NOT NULL,
    capability public.pairing_admin_capability NOT NULL,
    issued_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT user_account_race_delegation_capability_check CHECK (((capability)::text = ANY (ARRAY['MANAGE_RACE'::text, 'RACE_FUNCTIONARY'::text]))),
    CONSTRAINT user_account_race_delegation_lifetime_check CHECK (((expires_at > issued_at) AND (expires_at <= (issued_at + '01:00:00'::interval))))
);

CREATE TABLE public.user_account_session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    password_version integer NOT NULL,
    session_secret_hash text NOT NULL,
    csrf_secret_hash text NOT NULL,
    issued_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT user_account_session_csrf_hash_check CHECK ((csrf_secret_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT user_account_session_lifetime_check CHECK (((expires_at > issued_at) AND (expires_at <= (issued_at + '31 days'::interval)))),
    CONSTRAINT user_account_session_secret_hash_check CHECK ((session_secret_hash ~ '^[a-f0-9]{64}$'::text))
);

CREATE TABLE public.user_account_session_revocation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    revoked_at timestamp with time zone NOT NULL,
    reason text NOT NULL,
    CONSTRAINT user_account_session_revocation_reason_check CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 240)))
);

CREATE TABLE public.without_timing_decision (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    expected_entry_version integer NOT NULL,
    expected_class_id uuid NOT NULL,
    expected_course_version_id uuid NOT NULL,
    expected_snapshot_version integer NOT NULL,
    target_result_revision_id uuid NOT NULL,
    target_result_revision integer NOT NULL,
    policy_version text NOT NULL,
    status text NOT NULL,
    reason text NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT without_timing_decision_created_revision_check CHECK ((created_result_revision = (target_result_revision + 1))),
    CONSTRAINT without_timing_decision_distinct_result_check CHECK ((target_result_revision_id <> created_result_revision_id)),
    CONSTRAINT without_timing_decision_expected_entry_version_check CHECK ((expected_entry_version > 0)),
    CONSTRAINT without_timing_decision_expected_snapshot_check CHECK ((expected_snapshot_version > 0)),
    CONSTRAINT without_timing_decision_policy_version_check CHECK ((policy_version = 'without-timing-v1'::text)),
    CONSTRAINT without_timing_decision_status_check CHECK (((status = 'NT'::text) AND (reason = 'WITHOUT_TIMING'::text))),
    CONSTRAINT without_timing_decision_target_revision_check CHECK ((target_result_revision > 0))
);

CREATE TABLE public.without_timing_withdrawal (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    actor_credential_id uuid NOT NULL,
    race_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    expected_entry_version integer NOT NULL,
    expected_class_id uuid NOT NULL,
    expected_course_version_id uuid NOT NULL,
    expected_snapshot_version integer NOT NULL,
    without_timing_decision_id uuid NOT NULL,
    target_result_revision_id uuid NOT NULL,
    target_result_revision integer NOT NULL,
    withdrawn_result_revision_id uuid NOT NULL,
    withdrawn_result_revision integer NOT NULL,
    expected_latest_result_revision_id uuid NOT NULL,
    expected_latest_result_revision integer NOT NULL,
    restored_from_result_revision_id uuid NOT NULL,
    restored_from_result_revision integer NOT NULL,
    policy_version text NOT NULL,
    reason text NOT NULL,
    created_result_revision_id uuid NOT NULL,
    created_result_revision integer NOT NULL,
    withdrawn_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT without_timing_withdrawal_distinct_results_check CHECK (((target_result_revision_id <> withdrawn_result_revision_id) AND (withdrawn_result_revision_id <> restored_from_result_revision_id) AND (withdrawn_result_revision_id <> created_result_revision_id) AND (restored_from_result_revision_id <> created_result_revision_id))),
    CONSTRAINT without_timing_withdrawal_expected_entry_version_check CHECK ((expected_entry_version > 0)),
    CONSTRAINT without_timing_withdrawal_expected_snapshot_check CHECK ((expected_snapshot_version > 0)),
    CONSTRAINT without_timing_withdrawal_policy_version_check CHECK ((policy_version = 'without-timing-withdrawal-v1'::text)),
    CONSTRAINT without_timing_withdrawal_reason_check CHECK ((reason = 'ERRONEOUS_MANUAL_WITHOUT_TIMING'::text)),
    CONSTRAINT without_timing_withdrawal_revision_chain_check CHECK (((target_result_revision > 0) AND (withdrawn_result_revision = (target_result_revision + 1)) AND (expected_latest_result_revision >= withdrawn_result_revision) AND ((restored_from_result_revision = target_result_revision) OR (restored_from_result_revision > withdrawn_result_revision)) AND (restored_from_result_revision <= expected_latest_result_revision) AND (created_result_revision = (expected_latest_result_revision + 1))))
);

ALTER TABLE ONLY public.account_request_throttle
    ADD CONSTRAINT account_request_throttle_pkey PRIMARY KEY (scope, key_hash);

ALTER TABLE ONLY public.audit_event
    ADD CONSTRAINT audit_event_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.card_assignment
    ADD CONSTRAINT card_assignment_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.card_readout
    ADD CONSTRAINT card_readout_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.card_readout
    ADD CONSTRAINT card_readout_raw_message_id_key UNIQUE (raw_message_id);

ALTER TABLE ONLY public.class_capacity_change_request
    ADD CONSTRAINT class_capacity_change_request_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.class_capacity_change_request
    ADD CONSTRAINT class_capacity_change_request_request_id_key UNIQUE (request_id);

ALTER TABLE ONLY public.class_control_neutralization
    ADD CONSTRAINT class_control_neutralization_class_id_course_version_id_key UNIQUE (class_id, course_version_id);

ALTER TABLE ONLY public.class_control_neutralization
    ADD CONSTRAINT class_control_neutralization_id_race_id_class_id_course_ver_key UNIQUE (id, race_id, class_id, course_version_id, course_control_id, sequence, control_code);

ALTER TABLE ONLY public.class_control_neutralization
    ADD CONSTRAINT class_control_neutralization_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.class_edit_request
    ADD CONSTRAINT class_edit_request_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.class_edit_request
    ADD CONSTRAINT class_edit_request_scope_uidx UNIQUE (request_id, race_id);

ALTER TABLE ONLY public.class
    ADD CONSTRAINT class_id_course_version_uidx UNIQUE (id, course_version_id);

ALTER TABLE ONLY public.class
    ADD CONSTRAINT class_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.class_result_recalculation_item
    ADD CONSTRAINT class_result_recalculation_item_created_result_revision_id_key UNIQUE (created_result_revision_id);

ALTER TABLE ONLY public.class_result_recalculation_item
    ADD CONSTRAINT class_result_recalculation_item_pkey PRIMARY KEY (request_id, entry_id);

ALTER TABLE ONLY public.class_result_recalculation
    ADD CONSTRAINT class_result_recalculation_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.control
    ADD CONSTRAINT control_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.control
    ADD CONSTRAINT control_race_id_code_key UNIQUE (race_id, code);

ALTER TABLE ONLY public.course_control
    ADD CONSTRAINT course_control_course_version_id_sequence_key UNIQUE (course_version_id, sequence);

ALTER TABLE ONLY public.course_control
    ADD CONSTRAINT course_control_id_version_uidx UNIQUE (id, course_version_id);

ALTER TABLE ONLY public.course_control
    ADD CONSTRAINT course_control_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.course_edit_request
    ADD CONSTRAINT course_edit_request_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.course_edit_request
    ADD CONSTRAINT course_edit_request_scope_uidx UNIQUE (request_id, race_id);

ALTER TABLE ONLY public.course
    ADD CONSTRAINT course_id_race_uidx UNIQUE (id, race_id);

ALTER TABLE ONLY public.course
    ADD CONSTRAINT course_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.course_variant_assignment_request
    ADD CONSTRAINT course_variant_assignment_request_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.course_variant_assignment_request
    ADD CONSTRAINT course_variant_assignment_request_scope_uidx UNIQUE (request_id, race_id);

ALTER TABLE ONLY public.course_variant
    ADD CONSTRAINT course_variant_code_uidx UNIQUE (course_version_id, code);

ALTER TABLE ONLY public.course_variant_control
    ADD CONSTRAINT course_variant_control_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.course_variant_control
    ADD CONSTRAINT course_variant_control_sequence_uidx UNIQUE (course_variant_id, sequence);

ALTER TABLE ONLY public.course_variant
    ADD CONSTRAINT course_variant_id_version_uidx UNIQUE (id, course_version_id);

ALTER TABLE ONLY public.course_variant
    ADD CONSTRAINT course_variant_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.course_variant
    ADD CONSTRAINT course_variant_sequence_uidx UNIQUE (course_version_id, sequence);

ALTER TABLE ONLY public.course_version
    ADD CONSTRAINT course_version_course_id_version_key UNIQUE (course_id, version);

ALTER TABLE ONLY public.course_version
    ADD CONSTRAINT course_version_id_course_uidx UNIQUE (id, course_id);

ALTER TABLE ONLY public.course_version
    ADD CONSTRAINT course_version_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.device_ingest_outcome
    ADD CONSTRAINT device_ingest_outcome_pkey PRIMARY KEY (raw_message_id);

ALTER TABLE ONLY public.did_not_finish_decision
    ADD CONSTRAINT did_not_finish_decision_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.did_not_finish_withdrawal
    ADD CONSTRAINT did_not_finish_withdrawal_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.did_not_start_decision
    ADD CONSTRAINT did_not_start_decision_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.did_not_start_withdrawal
    ADD CONSTRAINT did_not_start_withdrawal_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.entry_card_change_request
    ADD CONSTRAINT entry_card_change_request_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.entry_card_rental_change
    ADD CONSTRAINT entry_card_rental_change_entry_version_uidx UNIQUE (entry_id, entry_version_before);

ALTER TABLE ONLY public.entry_card_rental_change
    ADD CONSTRAINT entry_card_rental_change_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.entry_card_rental_return_change
    ADD CONSTRAINT entry_card_rental_return_change_entry_version_uidx UNIQUE (entry_id, entry_version_before);

ALTER TABLE ONLY public.entry_card_rental_return_change
    ADD CONSTRAINT entry_card_rental_return_change_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.entry_card_rental_reuse_request
    ADD CONSTRAINT entry_card_rental_reuse_request_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.entry_class_change_request
    ADD CONSTRAINT entry_class_change_request_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.entry_identity_change_request
    ADD CONSTRAINT entry_identity_change_request_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.entry
    ADD CONSTRAINT entry_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.entry_registration_request
    ADD CONSTRAINT entry_registration_request_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.entry_start_time_change_request
    ADD CONSTRAINT entry_start_time_change_request_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.entry_transfer_request
    ADD CONSTRAINT entry_transfer_request_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.entry_transfer_request
    ADD CONSTRAINT entry_transfer_request_request_id_key UNIQUE (request_id);

ALTER TABLE ONLY public.event_administration_access_request
    ADD CONSTRAINT event_administration_access_request_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.event_administration_grant_guard
    ADD CONSTRAINT event_administration_grant_guard_pkey PRIMARY KEY (grant_id);

ALTER TABLE ONLY public.event_administration_grant
    ADD CONSTRAINT event_administration_grant_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.event_administration_grant_revocation
    ADD CONSTRAINT event_administration_grant_revocation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.event
    ADD CONSTRAINT event_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.import_file
    ADD CONSTRAINT import_file_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.import_file
    ADD CONSTRAINT import_file_race_id_kind_content_hash_key UNIQUE (race_id, kind, content_hash);

ALTER TABLE ONLY public.iof_import_request
    ADD CONSTRAINT iof_import_request_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.manual_class_create_request
    ADD CONSTRAINT manual_class_create_request_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.manual_class_create_request
    ADD CONSTRAINT manual_class_create_request_scope_uidx UNIQUE (request_id, race_id);

ALTER TABLE ONLY public.manual_course_class_create_request
    ADD CONSTRAINT manual_course_class_create_request_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.manual_course_class_create_request
    ADD CONSTRAINT manual_course_class_create_request_request_id_race_id_key UNIQUE (request_id, race_id);

ALTER TABLE ONLY public.manual_finish_time_correction
    ADD CONSTRAINT manual_finish_time_correction_created_result_revision_id_key UNIQUE (created_result_revision_id);

ALTER TABLE ONLY public.manual_finish_time_correction_withdrawal
    ADD CONSTRAINT manual_finish_time_correction_id_created_result_revision_id_key UNIQUE (id, created_result_revision_id, race_id, entry_id, created_result_revision);

ALTER TABLE ONLY public.manual_finish_time_correction
    ADD CONSTRAINT manual_finish_time_correction_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.manual_finish_time_correction
    ADD CONSTRAINT manual_finish_time_correction_request_id_created_result_rev_key UNIQUE (request_id, created_result_revision_id, race_id, entry_id, created_result_revision);

ALTER TABLE ONLY public.manual_finish_time_correction
    ADD CONSTRAINT manual_finish_time_correction_source_result_revision_id_key UNIQUE (source_result_revision_id);

ALTER TABLE ONLY public.manual_finish_time_correction_withdrawal
    ADD CONSTRAINT manual_finish_time_correction_wi_created_result_revision_id_key UNIQUE (created_result_revision_id);

ALTER TABLE ONLY public.manual_finish_time_correction_withdrawal
    ADD CONSTRAINT manual_finish_time_correction_withdrawal_correction_id_key UNIQUE (correction_id);

ALTER TABLE ONLY public.manual_finish_time_correction_withdrawal
    ADD CONSTRAINT manual_finish_time_correction_withdrawal_id_key UNIQUE (id);

ALTER TABLE ONLY public.manual_finish_time_correction_withdrawal
    ADD CONSTRAINT manual_finish_time_correction_withdrawal_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.manual_punch_start_time_correction_withdrawal
    ADD CONSTRAINT manual_punch_start_time_corre_id_created_result_revision_id_key UNIQUE (id, created_result_revision_id, race_id, entry_id, created_result_revision);

ALTER TABLE ONLY public.manual_punch_start_time_correction
    ADD CONSTRAINT manual_punch_start_time_corre_request_id_created_result_rev_key UNIQUE (request_id, created_result_revision_id, race_id, entry_id, created_result_revision);

ALTER TABLE ONLY public.manual_punch_start_time_correction_withdrawal
    ADD CONSTRAINT manual_punch_start_time_correct_created_result_revision_id_key1 UNIQUE (created_result_revision_id);

ALTER TABLE ONLY public.manual_punch_start_time_correction
    ADD CONSTRAINT manual_punch_start_time_correcti_created_result_revision_id_key UNIQUE (created_result_revision_id);

ALTER TABLE ONLY public.manual_punch_start_time_correction
    ADD CONSTRAINT manual_punch_start_time_correctio_source_result_revision_id_key UNIQUE (source_result_revision_id);

ALTER TABLE ONLY public.manual_punch_start_time_correction
    ADD CONSTRAINT manual_punch_start_time_correction_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.manual_punch_start_time_correction_withdrawal
    ADD CONSTRAINT manual_punch_start_time_correction_withdrawal_correction_id_key UNIQUE (correction_id);

ALTER TABLE ONLY public.manual_punch_start_time_correction_withdrawal
    ADD CONSTRAINT manual_punch_start_time_correction_withdrawal_id_key UNIQUE (id);

ALTER TABLE ONLY public.manual_punch_start_time_correction_withdrawal
    ADD CONSTRAINT manual_punch_start_time_correction_withdrawal_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.not_competing_decision
    ADD CONSTRAINT not_competing_decision_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.not_competing_withdrawal
    ADD CONSTRAINT not_competing_withdrawal_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pairing_admin_access_credential
    ADD CONSTRAINT pairing_admin_access_credential_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pairing_admin_access_credential_revocation
    ADD CONSTRAINT pairing_admin_access_credential_revocation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pairing_admin_revocation_guard
    ADD CONSTRAINT pairing_admin_revocation_guard_pkey PRIMARY KEY (credential_id);

ALTER TABLE ONLY public.pairing_admin_session
    ADD CONSTRAINT pairing_admin_session_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pairing_admin_session_revocation
    ADD CONSTRAINT pairing_admin_session_revocation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.participant_route
    ADD CONSTRAINT participant_route_pkey PRIMARY KEY (entry_id);

ALTER TABLE ONLY public.password_reset_token
    ADD CONSTRAINT password_reset_token_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.public_result_update_event
    ADD CONSTRAINT public_result_update_event_pkey PRIMARY KEY (event_sequence);

ALTER TABLE ONLY public.race_copy_request
    ADD CONSTRAINT race_copy_request_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.race_eventor_link
    ADD CONSTRAINT race_eventor_link_pkey PRIMARY KEY (race_id);

ALTER TABLE ONLY public.race_map
    ADD CONSTRAINT race_map_pkey PRIMARY KEY (race_id);

ALTER TABLE ONLY public.race
    ADD CONSTRAINT race_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.race_radio_control
    ADD CONSTRAINT race_radio_control_pkey PRIMARY KEY (race_id, control_code);

ALTER TABLE ONLY public.race_radio_link
    ADD CONSTRAINT race_radio_link_pkey PRIMARY KEY (race_id);

ALTER TABLE ONLY public.race_settings_request
    ADD CONSTRAINT race_settings_request_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.radio_punch
    ADD CONSTRAINT radio_punch_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.raw_device_message
    ADD CONSTRAINT raw_device_message_device_id_local_sequence_key UNIQUE (device_id, local_sequence);

ALTER TABLE ONLY public.raw_device_message
    ADD CONSTRAINT raw_device_message_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.relay_leg
    ADD CONSTRAINT relay_leg_pk PRIMARY KEY (class_id, leg);

ALTER TABLE ONLY public.relay_request
    ADD CONSTRAINT relay_request_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.result_approval_decision
    ADD CONSTRAINT result_approval_decision_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.result_approval_withdrawal
    ADD CONSTRAINT result_approval_withdrawal_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.result_disqualification_decision
    ADD CONSTRAINT result_disqualification_decision_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.result_disqualification_withdrawal
    ADD CONSTRAINT result_disqualification_withdrawal_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.result_finalization
    ADD CONSTRAINT result_finalization_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.result_recalculation_request
    ADD CONSTRAINT result_recalculation_request_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_entry_id_revision_key UNIQUE (entry_id, revision);

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.rogaining_change_request
    ADD CONSTRAINT rogaining_change_request_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.rogaining_change_request
    ADD CONSTRAINT rogaining_change_request_scope_uidx UNIQUE (request_id, race_id);

ALTER TABLE ONLY public.shortened_course_class_transfer_item
    ADD CONSTRAINT shortened_course_class_transf_request_id_created_result_rev_key UNIQUE (request_id, created_result_revision_id, race_id, entry_id, created_result_revision);

ALTER TABLE ONLY public.shortened_course_class_transfer_item
    ADD CONSTRAINT shortened_course_class_transfer_item_pkey PRIMARY KEY (request_id, entry_id);

ALTER TABLE ONLY public.shortened_course_class_transfer
    ADD CONSTRAINT shortened_course_class_transfer_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.shortened_course_class_transfer
    ADD CONSTRAINT shortened_course_class_transfer_request_id_race_id_key UNIQUE (request_id, race_id);

ALTER TABLE ONLY public.source_snapshot
    ADD CONSTRAINT source_snapshot_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.start_checkin_conflict_review_item
    ADD CONSTRAINT start_checkin_conflict_review_item_pkey PRIMARY KEY (conflict_request_id);

ALTER TABLE ONLY public.start_checkin_conflict_review
    ADD CONSTRAINT start_checkin_conflict_review_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.start_checkin_device
    ADD CONSTRAINT start_checkin_device_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.start_checkin_dns_decision
    ADD CONSTRAINT start_checkin_dns_decision_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.start_checkin_dns_withdrawal
    ADD CONSTRAINT start_checkin_dns_withdrawal_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.start_checkin_operation
    ADD CONSTRAINT start_checkin_operation_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.start_checkin_revision
    ADD CONSTRAINT start_checkin_revision_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.start_draw_class
    ADD CONSTRAINT start_draw_class_pkey PRIMARY KEY (draw_id, class_id);

ALTER TABLE ONLY public.start_draw_request
    ADD CONSTRAINT start_draw_request_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.start_draw_request
    ADD CONSTRAINT start_draw_request_request_id_key UNIQUE (request_id);

ALTER TABLE ONLY public.start_draw_request
    ADD CONSTRAINT start_draw_request_scope_uidx UNIQUE (id, race_id);

ALTER TABLE ONLY public.start_draw_slot
    ADD CONSTRAINT start_draw_slot_pkey PRIMARY KEY (draw_id, class_id, "position");

ALTER TABLE ONLY public.start_list_publication
    ADD CONSTRAINT start_list_publication_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.superadmin_action
    ADD CONSTRAINT superadmin_action_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.team
    ADD CONSTRAINT team_id_class_uidx UNIQUE (id, class_id);

ALTER TABLE ONLY public.team
    ADD CONSTRAINT team_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.team
    ADD CONSTRAINT team_race_number_uidx UNIQUE (race_id, number);

ALTER TABLE ONLY public.unknown_readout_resolution
    ADD CONSTRAINT unknown_readout_resolution_created_result_revision_id_key UNIQUE (created_result_revision_id);

ALTER TABLE ONLY public.unknown_readout_resolution
    ADD CONSTRAINT unknown_readout_resolution_pkey PRIMARY KEY (request_id);

ALTER TABLE ONLY public.unknown_readout_resolution
    ADD CONSTRAINT unknown_readout_resolution_readout_id_key UNIQUE (readout_id);

ALTER TABLE ONLY public.user_account_auth_guard
    ADD CONSTRAINT user_account_auth_guard_pkey PRIMARY KEY (account_id);

ALTER TABLE ONLY public.user_account_event_creation_request
    ADD CONSTRAINT user_account_event_creation_request_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_account_login_throttle
    ADD CONSTRAINT user_account_login_throttle_pkey PRIMARY KEY (login_key_hash);

ALTER TABLE ONLY public.user_account_password_verifier
    ADD CONSTRAINT user_account_password_verifier_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT user_account_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_account_race_delegation
    ADD CONSTRAINT user_account_race_delegation_pkey PRIMARY KEY (credential_id);

ALTER TABLE ONLY public.user_account_session
    ADD CONSTRAINT user_account_session_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_account_session_revocation
    ADD CONSTRAINT user_account_session_revocation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.without_timing_decision
    ADD CONSTRAINT without_timing_decision_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.without_timing_withdrawal
    ADD CONSTRAINT without_timing_withdrawal_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX card_assignment_active_race_card_uidx ON public.card_assignment USING btree (race_id, card_number) WHERE active;

CREATE UNIQUE INDEX card_assignment_id_race_entry_card_uidx ON public.card_assignment USING btree (id, race_id, entry_id, card_number);

CREATE UNIQUE INDEX card_readout_resolution_scope_uidx ON public.card_readout USING btree (id, race_id, raw_message_id, card_number);

CREATE UNIQUE INDEX class_capacity_version_uidx ON public.class_capacity_change_request USING btree (class_id, version_before);

CREATE INDEX class_control_neutralization_race_idx ON public.class_control_neutralization USING btree (race_id);

CREATE UNIQUE INDEX class_external_uidx ON public.class USING btree (race_id, external_source, external_id);

CREATE UNIQUE INDEX class_id_race_uidx ON public.class USING btree (id, race_id);

CREATE UNIQUE INDEX class_race_name_uidx ON public.class USING btree (race_id, lower(name));

CREATE INDEX class_result_recalculation_item_race_entry_idx ON public.class_result_recalculation_item USING btree (race_id, entry_id);

CREATE INDEX class_result_recalculation_race_time_idx ON public.class_result_recalculation USING btree (race_id, recalculated_at);

CREATE UNIQUE INDEX course_external_uidx ON public.course USING btree (race_id, external_source, external_id);

CREATE UNIQUE INDEX course_race_name_uidx ON public.course USING btree (race_id, lower(name));

CREATE INDEX course_variant_control_variant_idx ON public.course_variant_control USING btree (course_variant_id);

CREATE UNIQUE INDEX did_not_finish_decision_created_result_uidx ON public.did_not_finish_decision USING btree (created_result_revision_id);

CREATE UNIQUE INDEX did_not_finish_decision_created_source_tuple_uidx ON public.did_not_finish_decision USING btree (id, created_result_revision_id, race_id, entry_id, created_result_revision);

CREATE INDEX did_not_finish_decision_race_entry_revision_idx ON public.did_not_finish_decision USING btree (race_id, entry_id, created_result_revision, id);

CREATE INDEX did_not_finish_decision_race_time_idx ON public.did_not_finish_decision USING btree (race_id, decided_at, id);

CREATE UNIQUE INDEX did_not_finish_decision_request_uidx ON public.did_not_finish_decision USING btree (request_id);

CREATE UNIQUE INDEX did_not_finish_decision_target_uidx ON public.did_not_finish_decision USING btree (target_result_revision_id);

CREATE UNIQUE INDEX did_not_finish_decision_withdrawal_source_tuple_uidx ON public.did_not_finish_decision USING btree (id, target_result_revision_id, target_result_revision, created_result_revision_id, race_id, entry_id, created_result_revision);

CREATE UNIQUE INDEX did_not_finish_withdrawal_created_result_uidx ON public.did_not_finish_withdrawal USING btree (created_result_revision_id);

CREATE UNIQUE INDEX did_not_finish_withdrawal_created_source_tuple_uidx ON public.did_not_finish_withdrawal USING btree (id, created_result_revision_id, race_id, entry_id, created_result_revision);

CREATE UNIQUE INDEX did_not_finish_withdrawal_decision_uidx ON public.did_not_finish_withdrawal USING btree (did_not_finish_decision_id);

CREATE INDEX did_not_finish_withdrawal_race_time_idx ON public.did_not_finish_withdrawal USING btree (race_id, withdrawn_at, id);

CREATE UNIQUE INDEX did_not_finish_withdrawal_request_uidx ON public.did_not_finish_withdrawal USING btree (request_id);

CREATE UNIQUE INDEX did_not_finish_withdrawal_result_uidx ON public.did_not_finish_withdrawal USING btree (withdrawn_result_revision_id);

CREATE UNIQUE INDEX did_not_start_decision_created_result_uidx ON public.did_not_start_decision USING btree (created_result_revision_id);

CREATE UNIQUE INDEX did_not_start_decision_entry_previous_uidx ON public.did_not_start_decision USING btree (entry_id, expected_latest_result_revision);

CREATE INDEX did_not_start_decision_race_time_idx ON public.did_not_start_decision USING btree (race_id, decided_at);

CREATE UNIQUE INDEX did_not_start_decision_request_uidx ON public.did_not_start_decision USING btree (request_id);

CREATE UNIQUE INDEX did_not_start_decision_source_tuple_uidx ON public.did_not_start_decision USING btree (id, created_result_revision_id, race_id, entry_id, created_result_revision);

CREATE UNIQUE INDEX did_not_start_withdrawal_decision_uidx ON public.did_not_start_withdrawal USING btree (did_not_start_decision_id);

CREATE INDEX did_not_start_withdrawal_race_time_idx ON public.did_not_start_withdrawal USING btree (race_id, withdrawn_at, id);

CREATE UNIQUE INDEX did_not_start_withdrawal_request_uidx ON public.did_not_start_withdrawal USING btree (request_id);

CREATE UNIQUE INDEX did_not_start_withdrawal_result_uidx ON public.did_not_start_withdrawal USING btree (withdrawn_result_revision_id);

CREATE UNIQUE INDEX entry_card_change_request_entry_version_uidx ON public.entry_card_change_request USING btree (entry_id, entry_version_before);

CREATE INDEX entry_card_change_request_race_time_idx ON public.entry_card_change_request USING btree (race_id, changed_at);

CREATE UNIQUE INDEX entry_card_change_request_request_uidx ON public.entry_card_change_request USING btree (request_id);

CREATE INDEX entry_card_rental_change_race_time_idx ON public.entry_card_rental_change USING btree (race_id, changed_at);

CREATE INDEX entry_card_rental_return_change_race_time_idx ON public.entry_card_rental_return_change USING btree (race_id, changed_at);

CREATE INDEX entry_card_rental_reuse_race_time_idx ON public.entry_card_rental_reuse_request USING btree (race_id, changed_at);

CREATE UNIQUE INDEX entry_card_rental_reuse_source_entry_version_uidx ON public.entry_card_rental_reuse_request USING btree (source_entry_id, source_entry_version_before);

CREATE UNIQUE INDEX entry_card_rental_reuse_target_entry_version_uidx ON public.entry_card_rental_reuse_request USING btree (target_entry_id, target_entry_version_before);

CREATE UNIQUE INDEX entry_class_change_request_entry_version_uidx ON public.entry_class_change_request USING btree (entry_id, entry_version_before);

CREATE INDEX entry_class_change_request_race_time_idx ON public.entry_class_change_request USING btree (race_id, changed_at);

CREATE UNIQUE INDEX entry_class_change_request_request_uidx ON public.entry_class_change_request USING btree (request_id);

CREATE INDEX entry_class_idx ON public.entry USING btree (class_id);

CREATE UNIQUE INDEX entry_external_uidx ON public.entry USING btree (race_id, external_source, external_id);

CREATE UNIQUE INDEX entry_id_race_uidx ON public.entry USING btree (id, race_id);

CREATE UNIQUE INDEX entry_identity_change_request_entry_version_uidx ON public.entry_identity_change_request USING btree (entry_id, entry_version_before);

CREATE INDEX entry_identity_change_request_race_time_idx ON public.entry_identity_change_request USING btree (race_id, changed_at);

CREATE UNIQUE INDEX entry_identity_change_request_request_uidx ON public.entry_identity_change_request USING btree (request_id);

CREATE UNIQUE INDEX entry_race_public_result_uidx ON public.entry USING btree (race_id, public_result_id);

CREATE UNIQUE INDEX entry_registration_request_entry_uidx ON public.entry_registration_request USING btree (entry_id);

CREATE INDEX entry_registration_request_race_time_idx ON public.entry_registration_request USING btree (race_id, created_at);

CREATE UNIQUE INDEX entry_registration_request_request_uidx ON public.entry_registration_request USING btree (request_id);

CREATE UNIQUE INDEX entry_start_time_change_request_entry_version_uidx ON public.entry_start_time_change_request USING btree (entry_id, entry_version_before);

CREATE INDEX entry_start_time_change_request_race_time_idx ON public.entry_start_time_change_request USING btree (race_id, changed_at);

CREATE UNIQUE INDEX entry_start_time_change_request_request_uidx ON public.entry_start_time_change_request USING btree (request_id);

CREATE UNIQUE INDEX entry_team_leg_uidx ON public.entry USING btree (team_id, relay_leg) WHERE (team_id IS NOT NULL);

CREATE UNIQUE INDEX entry_transfer_entry_version_uidx ON public.entry_transfer_request USING btree (entry_id, entry_version_before);

CREATE INDEX entry_transfer_race_time_idx ON public.entry_transfer_request USING btree (race_id, changed_at);

CREATE INDEX event_administration_access_request_actor_idx ON public.event_administration_access_request USING btree (actor_account_id, created_at);

CREATE INDEX event_administration_access_request_event_idx ON public.event_administration_access_request USING btree (event_id, created_at);

CREATE INDEX event_administration_grant_account_idx ON public.event_administration_grant USING btree (account_id, granted_at);

CREATE UNIQUE INDEX event_administration_grant_owner_account_event_uidx ON public.event_administration_grant USING btree (account_id, event_id) WHERE (role = 'OWNER'::public.event_administration_role);

CREATE UNIQUE INDEX event_administration_grant_revocation_grant_uidx ON public.event_administration_grant_revocation USING btree (grant_id);

CREATE UNIQUE INDEX event_administration_grant_scope_uidx ON public.event_administration_grant USING btree (id, account_id, event_id);

CREATE INDEX iof_import_request_race_time_idx ON public.iof_import_request USING btree (race_id, created_at);

CREATE INDEX manual_finish_time_correction_race_time_idx ON public.manual_finish_time_correction USING btree (race_id, corrected_at);

CREATE INDEX manual_finish_time_correction_withdrawal_race_time_idx ON public.manual_finish_time_correction_withdrawal USING btree (race_id, withdrawn_at);

CREATE INDEX manual_punch_start_time_correction_race_time_idx ON public.manual_punch_start_time_correction USING btree (race_id, corrected_at);

CREATE INDEX manual_punch_start_time_correction_withdrawal_race_time_idx ON public.manual_punch_start_time_correction_withdrawal USING btree (race_id, withdrawn_at);

CREATE UNIQUE INDEX not_competing_decision_created_result_uidx ON public.not_competing_decision USING btree (created_result_revision_id);

CREATE UNIQUE INDEX not_competing_decision_created_source_tuple_uidx ON public.not_competing_decision USING btree (id, created_result_revision_id, race_id, entry_id, created_result_revision);

CREATE INDEX not_competing_decision_race_entry_revision_idx ON public.not_competing_decision USING btree (race_id, entry_id, created_result_revision, id);

CREATE INDEX not_competing_decision_race_time_idx ON public.not_competing_decision USING btree (race_id, decided_at, id);

CREATE UNIQUE INDEX not_competing_decision_request_uidx ON public.not_competing_decision USING btree (request_id);

CREATE UNIQUE INDEX not_competing_decision_target_uidx ON public.not_competing_decision USING btree (target_result_revision_id);

CREATE UNIQUE INDEX not_competing_decision_withdrawal_source_tuple_uidx ON public.not_competing_decision USING btree (id, target_result_revision_id, target_result_revision, created_result_revision_id, race_id, entry_id, created_result_revision);

CREATE UNIQUE INDEX not_competing_withdrawal_created_result_uidx ON public.not_competing_withdrawal USING btree (created_result_revision_id);

CREATE UNIQUE INDEX not_competing_withdrawal_created_source_tuple_uidx ON public.not_competing_withdrawal USING btree (id, created_result_revision_id, race_id, entry_id, created_result_revision);

CREATE UNIQUE INDEX not_competing_withdrawal_decision_uidx ON public.not_competing_withdrawal USING btree (not_competing_decision_id);

CREATE INDEX not_competing_withdrawal_race_time_idx ON public.not_competing_withdrawal USING btree (race_id, withdrawn_at, id);

CREATE UNIQUE INDEX not_competing_withdrawal_request_uidx ON public.not_competing_withdrawal USING btree (request_id);

CREATE UNIQUE INDEX not_competing_withdrawal_result_uidx ON public.not_competing_withdrawal USING btree (withdrawn_result_revision_id);

CREATE INDEX pairing_admin_access_credential_race_idx ON public.pairing_admin_access_credential USING btree (race_id, capability);

CREATE UNIQUE INDEX pairing_admin_access_credential_revocation_uidx ON public.pairing_admin_access_credential_revocation USING btree (credential_id);

CREATE UNIQUE INDEX pairing_admin_credential_scope_uidx ON public.pairing_admin_access_credential USING btree (id, race_id, capability);

CREATE INDEX pairing_admin_session_credential_idx ON public.pairing_admin_session USING btree (access_credential_id);

CREATE UNIQUE INDEX pairing_admin_session_revocation_uidx ON public.pairing_admin_session_revocation USING btree (session_id);

CREATE INDEX participant_route_race_idx ON public.participant_route USING btree (race_id);

CREATE INDEX password_reset_token_account_idx ON public.password_reset_token USING btree (account_id, created_at);

CREATE UNIQUE INDEX password_reset_token_hash_uidx ON public.password_reset_token USING btree (token_hash);

CREATE INDEX public_result_update_event_race_sequence_idx ON public.public_result_update_event USING btree (race_id, event_sequence);

CREATE UNIQUE INDEX race_copy_request_race_uidx ON public.race_copy_request USING btree (race_id);

CREATE INDEX race_copy_request_source_idx ON public.race_copy_request USING btree (source_race_id, created_at);

CREATE INDEX race_event_idx ON public.race USING btree (event_id);

CREATE UNIQUE INDEX race_id_event_uidx ON public.race USING btree (id, event_id);

CREATE INDEX race_settings_request_race_idx ON public.race_settings_request USING btree (race_id);

CREATE UNIQUE INDEX race_short_code_uidx ON public.race USING btree (short_code);

CREATE UNIQUE INDEX radio_punch_content_uidx ON public.radio_punch USING btree (race_id, card_number, control_code, punched_at);

CREATE INDEX radio_punch_race_time_idx ON public.radio_punch USING btree (race_id, punched_at);

CREATE UNIQUE INDEX radio_punch_source_uidx ON public.radio_punch USING btree (race_id, source, unit_id, punch_id);

CREATE INDEX raw_device_message_race_received_id_idx ON public.raw_device_message USING btree (race_id, server_received_at DESC, id DESC);

CREATE INDEX relay_leg_race_idx ON public.relay_leg USING btree (race_id);

CREATE UNIQUE INDEX result_approval_decision_created_result_uidx ON public.result_approval_decision USING btree (created_result_revision_id);

CREATE UNIQUE INDEX result_approval_decision_created_source_tuple_uidx ON public.result_approval_decision USING btree (id, created_result_revision_id, race_id, entry_id, created_result_revision);

CREATE INDEX result_approval_decision_race_time_idx ON public.result_approval_decision USING btree (race_id, decided_at, id);

CREATE UNIQUE INDEX result_approval_decision_request_uidx ON public.result_approval_decision USING btree (request_id);

CREATE UNIQUE INDEX result_approval_decision_target_uidx ON public.result_approval_decision USING btree (target_result_revision_id);

CREATE UNIQUE INDEX result_approval_withdrawal_created_result_uidx ON public.result_approval_withdrawal USING btree (created_result_revision_id);

CREATE UNIQUE INDEX result_approval_withdrawal_created_source_tuple_uidx ON public.result_approval_withdrawal USING btree (id, created_result_revision_id, race_id, entry_id, created_result_revision);

CREATE UNIQUE INDEX result_approval_withdrawal_decision_uidx ON public.result_approval_withdrawal USING btree (approval_decision_id);

CREATE INDEX result_approval_withdrawal_race_time_idx ON public.result_approval_withdrawal USING btree (race_id, withdrawn_at, id);

CREATE UNIQUE INDEX result_approval_withdrawal_request_uidx ON public.result_approval_withdrawal USING btree (request_id);

CREATE UNIQUE INDEX result_approval_withdrawal_result_uidx ON public.result_approval_withdrawal USING btree (withdrawn_result_revision_id);

CREATE UNIQUE INDEX result_disqualification_decision_created_result_uidx ON public.result_disqualification_decision USING btree (created_result_revision_id);

CREATE UNIQUE INDEX result_disqualification_decision_created_source_tuple_uidx ON public.result_disqualification_decision USING btree (id, created_result_revision_id, race_id, entry_id, created_result_revision);

CREATE INDEX result_disqualification_decision_race_time_idx ON public.result_disqualification_decision USING btree (race_id, decided_at, id);

CREATE UNIQUE INDEX result_disqualification_decision_request_uidx ON public.result_disqualification_decision USING btree (request_id);

CREATE UNIQUE INDEX result_disqualification_decision_target_uidx ON public.result_disqualification_decision USING btree (target_result_revision_id);

CREATE UNIQUE INDEX result_disqualification_withdrawal_created_result_uidx ON public.result_disqualification_withdrawal USING btree (created_result_revision_id);

CREATE UNIQUE INDEX result_disqualification_withdrawal_created_source_tuple_uidx ON public.result_disqualification_withdrawal USING btree (id, created_result_revision_id, race_id, entry_id, created_result_revision);

CREATE UNIQUE INDEX result_disqualification_withdrawal_decision_uidx ON public.result_disqualification_withdrawal USING btree (disqualification_decision_id);

CREATE INDEX result_disqualification_withdrawal_race_time_idx ON public.result_disqualification_withdrawal USING btree (race_id, withdrawn_at, id);

CREATE UNIQUE INDEX result_disqualification_withdrawal_request_uidx ON public.result_disqualification_withdrawal USING btree (request_id);

CREATE UNIQUE INDEX result_disqualification_withdrawal_result_uidx ON public.result_disqualification_withdrawal USING btree (withdrawn_result_revision_id);

CREATE UNIQUE INDEX result_finalization_class_scope_revision_uidx ON public.result_finalization USING btree (class_id, scope_revision) WHERE (scope = 'CLASS'::public.result_finalization_scope);

CREATE INDEX result_finalization_race_finalized_idx ON public.result_finalization USING btree (race_id, finalized_at, id);

CREATE UNIQUE INDEX result_finalization_race_scope_revision_uidx ON public.result_finalization USING btree (race_id, scope_revision) WHERE (scope = 'RACE'::public.result_finalization_scope);

CREATE UNIQUE INDEX result_finalization_request_uidx ON public.result_finalization USING btree (request_id);

CREATE UNIQUE INDEX result_recalculation_request_created_result_uidx ON public.result_recalculation_request USING btree (created_result_revision_id);

CREATE UNIQUE INDEX result_recalculation_request_entry_previous_uidx ON public.result_recalculation_request USING btree (entry_id, expected_latest_result_revision);

CREATE INDEX result_recalculation_request_race_time_idx ON public.result_recalculation_request USING btree (race_id, recalculated_at);

CREATE UNIQUE INDEX result_recalculation_request_request_uidx ON public.result_recalculation_request USING btree (request_id);

CREATE UNIQUE INDEX result_revision_approval_decision_uidx ON public.result_revision USING btree (approval_decision_id);

CREATE UNIQUE INDEX result_revision_approval_source_tuple_uidx ON public.result_revision USING btree (id, approval_decision_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_approval_withdrawal_source_tuple_uidx ON public.result_revision USING btree (id, approval_withdrawal_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_approval_withdrawal_uidx ON public.result_revision USING btree (approval_withdrawal_id);

CREATE UNIQUE INDEX result_revision_did_not_finish_decision_uidx ON public.result_revision USING btree (did_not_finish_decision_id);

CREATE UNIQUE INDEX result_revision_did_not_finish_source_tuple_uidx ON public.result_revision USING btree (id, did_not_finish_decision_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_did_not_finish_withdrawal_source_tuple_uidx ON public.result_revision USING btree (id, did_not_finish_withdrawal_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_did_not_finish_withdrawal_uidx ON public.result_revision USING btree (did_not_finish_withdrawal_id);

CREATE UNIQUE INDEX result_revision_did_not_start_decision_uidx ON public.result_revision USING btree (did_not_start_decision_id);

CREATE UNIQUE INDEX result_revision_disqualification_decision_uidx ON public.result_revision USING btree (disqualification_decision_id);

CREATE UNIQUE INDEX result_revision_disqualification_source_tuple_uidx ON public.result_revision USING btree (id, disqualification_decision_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_disqualification_withdrawal_source_tuple_uidx ON public.result_revision USING btree (id, disqualification_withdrawal_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_disqualification_withdrawal_uidx ON public.result_revision USING btree (disqualification_withdrawal_id);

CREATE UNIQUE INDEX result_revision_dns_source_tuple_uidx ON public.result_revision USING btree (id, did_not_start_decision_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_exact_source_tuple_uidx ON public.result_revision USING btree (id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_manual_finish_time_correction_source_tuple_uidx ON public.result_revision USING btree (id, manual_finish_time_correction_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_manual_finish_time_correction_uidx ON public.result_revision USING btree (manual_finish_time_correction_id);

CREATE UNIQUE INDEX result_revision_manual_finish_time_correction_withdrawal_source ON public.result_revision USING btree (id, manual_finish_time_correction_withdrawal_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_manual_finish_time_correction_withdrawal_uidx ON public.result_revision USING btree (manual_finish_time_correction_withdrawal_id);

CREATE UNIQUE INDEX result_revision_manual_punch_start_time_correction_source_tuple ON public.result_revision USING btree (id, manual_punch_start_time_correction_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_manual_punch_start_time_correction_uidx ON public.result_revision USING btree (manual_punch_start_time_correction_id);

CREATE UNIQUE INDEX result_revision_manual_punch_start_time_correction_withdrawal_s ON public.result_revision USING btree (id, manual_punch_start_time_correction_withdrawal_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_manual_punch_start_time_correction_withdrawal_u ON public.result_revision USING btree (manual_punch_start_time_correction_withdrawal_id);

CREATE UNIQUE INDEX result_revision_not_competing_decision_uidx ON public.result_revision USING btree (not_competing_decision_id);

CREATE UNIQUE INDEX result_revision_not_competing_source_tuple_uidx ON public.result_revision USING btree (id, not_competing_decision_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_not_competing_withdrawal_source_tuple_uidx ON public.result_revision USING btree (id, not_competing_withdrawal_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_not_competing_withdrawal_uidx ON public.result_revision USING btree (not_competing_withdrawal_id);

CREATE UNIQUE INDEX result_revision_private_route_context_scope_uidx ON public.result_revision USING btree (id, race_id, entry_id, revision, course_version_id);

CREATE INDEX result_revision_public_idx ON public.result_revision USING btree (race_id, published);

CREATE UNIQUE INDEX result_revision_shortened_course_class_transfer_source_tuple_ui ON public.result_revision USING btree (id, shortened_course_class_transfer_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_start_checkin_dns_decision_uidx ON public.result_revision USING btree (start_checkin_dns_decision_id);

CREATE UNIQUE INDEX result_revision_start_checkin_dns_source_tuple_uidx ON public.result_revision USING btree (id, start_checkin_dns_decision_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_without_timing_decision_uidx ON public.result_revision USING btree (without_timing_decision_id);

CREATE UNIQUE INDEX result_revision_without_timing_source_tuple_uidx ON public.result_revision USING btree (id, without_timing_decision_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_without_timing_withdrawal_source_tuple_uidx ON public.result_revision USING btree (id, without_timing_withdrawal_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX result_revision_without_timing_withdrawal_uidx ON public.result_revision USING btree (without_timing_withdrawal_id);

CREATE INDEX shortened_course_class_transfer_race_time_idx ON public.shortened_course_class_transfer USING btree (race_id, transferred_at);

CREATE UNIQUE INDEX source_snapshot_applied_request_uidx ON public.source_snapshot USING btree (applied_request_id);

CREATE INDEX source_snapshot_race_source_idx ON public.source_snapshot USING btree (race_id, source, fetched_at);

CREATE INDEX start_checkin_conflict_review_item_review_idx ON public.start_checkin_conflict_review_item USING btree (review_id);

CREATE INDEX start_checkin_conflict_review_race_time_idx ON public.start_checkin_conflict_review USING btree (race_id, reviewed_at);

CREATE UNIQUE INDEX start_checkin_conflict_review_request_uidx ON public.start_checkin_conflict_review USING btree (request_id);

CREATE UNIQUE INDEX start_checkin_conflict_review_scope_uidx ON public.start_checkin_conflict_review USING btree (id, race_id, entry_id);

CREATE UNIQUE INDEX start_checkin_device_capability_scope_uidx ON public.start_checkin_device USING btree (id, race_id, actor_credential_id, capability);

CREATE UNIQUE INDEX start_checkin_device_online_credential_uidx ON public.start_checkin_device USING btree (actor_credential_id) WHERE (capability = ANY (ARRAY['MANAGE_RACE'::public.pairing_admin_capability, 'RACE_FUNCTIONARY'::public.pairing_admin_capability]));

CREATE INDEX start_checkin_device_race_idx ON public.start_checkin_device USING btree (race_id);

CREATE UNIQUE INDEX start_checkin_device_scope_uidx ON public.start_checkin_device USING btree (id, race_id, actor_credential_id);

CREATE UNIQUE INDEX start_checkin_dns_decision_created_result_uidx ON public.start_checkin_dns_decision USING btree (created_result_revision_id);

CREATE UNIQUE INDEX start_checkin_dns_decision_operation_uidx ON public.start_checkin_dns_decision USING btree (operation_request_id);

CREATE INDEX start_checkin_dns_decision_race_time_idx ON public.start_checkin_dns_decision USING btree (race_id, decided_at);

CREATE UNIQUE INDEX start_checkin_dns_decision_result_pair_uidx ON public.start_checkin_dns_decision USING btree (id, created_result_revision_id, race_id, entry_id, created_result_revision);

CREATE UNIQUE INDEX start_checkin_dns_withdrawal_decision_uidx ON public.start_checkin_dns_withdrawal USING btree (start_checkin_dns_decision_id);

CREATE UNIQUE INDEX start_checkin_dns_withdrawal_operation_uidx ON public.start_checkin_dns_withdrawal USING btree (operation_request_id);

CREATE INDEX start_checkin_dns_withdrawal_race_time_idx ON public.start_checkin_dns_withdrawal USING btree (race_id, withdrawn_at);

CREATE UNIQUE INDEX start_checkin_dns_withdrawal_result_uidx ON public.start_checkin_dns_withdrawal USING btree (withdrawn_result_revision_id);

CREATE UNIQUE INDEX start_checkin_operation_conflict_review_source_uidx ON public.start_checkin_operation USING btree (request_id, race_id, entry_id, content_hash, effect);

CREATE UNIQUE INDEX start_checkin_operation_created_revision_uidx ON public.start_checkin_operation USING btree (created_revision_id);

CREATE INDEX start_checkin_operation_entry_idx ON public.start_checkin_operation USING btree (race_id, entry_id, received_at);

CREATE UNIQUE INDEX start_checkin_operation_recovery_source_uidx ON public.start_checkin_operation USING btree (request_id, device_id, actor_credential_id, race_id, local_sequence, content_hash);

CREATE UNIQUE INDEX start_checkin_operation_revision_scope_uidx ON public.start_checkin_operation USING btree (request_id, race_id, entry_id, effect, resulting_revision);

CREATE UNIQUE INDEX start_checkin_operation_sequence_uidx ON public.start_checkin_operation USING btree (device_id, local_sequence);

CREATE UNIQUE INDEX start_checkin_revision_entry_uidx ON public.start_checkin_revision USING btree (race_id, entry_id, revision);

CREATE UNIQUE INDEX start_checkin_revision_reciprocal_uidx ON public.start_checkin_revision USING btree (id, request_id, race_id, entry_id, revision);

CREATE UNIQUE INDEX start_checkin_revision_request_uidx ON public.start_checkin_revision USING btree (request_id);

CREATE INDEX start_draw_request_race_time_idx ON public.start_draw_request USING btree (race_id, drawn_at);

CREATE INDEX start_list_publication_race_revision_idx ON public.start_list_publication USING btree (race_id, revision DESC);

CREATE UNIQUE INDEX start_list_publication_race_revision_uidx ON public.start_list_publication USING btree (race_id, revision);

CREATE UNIQUE INDEX start_list_publication_request_uidx ON public.start_list_publication USING btree (request_id);

CREATE INDEX superadmin_action_created_idx ON public.superadmin_action USING btree (created_at DESC);

CREATE INDEX team_class_idx ON public.team USING btree (class_id);

CREATE UNIQUE INDEX team_external_uidx ON public.team USING btree (race_id, external_source, external_id);

CREATE INDEX unknown_readout_resolution_race_time_idx ON public.unknown_readout_resolution USING btree (race_id, resolved_at);

CREATE UNIQUE INDEX user_account_email_uidx ON public.user_account USING btree (email);

CREATE INDEX user_account_event_creation_actor_idx ON public.user_account_event_creation_request USING btree (actor_account_id, created_at);

CREATE UNIQUE INDEX user_account_event_creation_event_uidx ON public.user_account_event_creation_request USING btree (event_id);

CREATE UNIQUE INDEX user_account_event_creation_race_uidx ON public.user_account_event_creation_request USING btree (race_id);

CREATE UNIQUE INDEX user_account_event_creation_request_uidx ON public.user_account_event_creation_request USING btree (request_id);

CREATE UNIQUE INDEX user_account_password_verifier_version_uidx ON public.user_account_password_verifier USING btree (account_id, version);

CREATE INDEX user_account_race_delegation_session_idx ON public.user_account_race_delegation USING btree (account_session_id, expires_at);

CREATE INDEX user_account_session_account_idx ON public.user_account_session USING btree (account_id, expires_at);

CREATE UNIQUE INDEX user_account_session_id_account_uidx ON public.user_account_session USING btree (id, account_id);

CREATE UNIQUE INDEX user_account_session_revocation_session_uidx ON public.user_account_session_revocation USING btree (session_id);

CREATE UNIQUE INDEX without_timing_decision_created_result_uidx ON public.without_timing_decision USING btree (created_result_revision_id);

CREATE UNIQUE INDEX without_timing_decision_created_source_tuple_uidx ON public.without_timing_decision USING btree (id, created_result_revision_id, race_id, entry_id, created_result_revision);

CREATE INDEX without_timing_decision_race_entry_revision_idx ON public.without_timing_decision USING btree (race_id, entry_id, created_result_revision, id);

CREATE INDEX without_timing_decision_race_time_idx ON public.without_timing_decision USING btree (race_id, decided_at, id);

CREATE UNIQUE INDEX without_timing_decision_request_uidx ON public.without_timing_decision USING btree (request_id);

CREATE UNIQUE INDEX without_timing_decision_target_uidx ON public.without_timing_decision USING btree (target_result_revision_id);

CREATE UNIQUE INDEX without_timing_decision_withdrawal_source_tuple_uidx ON public.without_timing_decision USING btree (id, target_result_revision_id, target_result_revision, created_result_revision_id, race_id, entry_id, created_result_revision);

CREATE UNIQUE INDEX without_timing_withdrawal_created_result_uidx ON public.without_timing_withdrawal USING btree (created_result_revision_id);

CREATE UNIQUE INDEX without_timing_withdrawal_created_source_tuple_uidx ON public.without_timing_withdrawal USING btree (id, created_result_revision_id, race_id, entry_id, created_result_revision);

CREATE UNIQUE INDEX without_timing_withdrawal_decision_uidx ON public.without_timing_withdrawal USING btree (without_timing_decision_id);

CREATE INDEX without_timing_withdrawal_race_time_idx ON public.without_timing_withdrawal USING btree (race_id, withdrawn_at, id);

CREATE UNIQUE INDEX without_timing_withdrawal_request_uidx ON public.without_timing_withdrawal USING btree (request_id);

CREATE UNIQUE INDEX without_timing_withdrawal_result_uidx ON public.without_timing_withdrawal USING btree (withdrawn_result_revision_id);

CREATE TRIGGER audit_event_immutable BEFORE DELETE OR UPDATE ON public.audit_event FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER card_assignment_identity_immutable BEFORE DELETE OR UPDATE ON public.card_assignment FOR EACH ROW EXECUTE FUNCTION public.protect_card_assignment_identity();

CREATE TRIGGER class_capacity_immutable BEFORE DELETE OR UPDATE ON public.class_capacity_change_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER class_control_neutralization_immutable BEFORE DELETE OR UPDATE ON public.class_control_neutralization FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER class_edit_request_immutable BEFORE DELETE OR UPDATE ON public.class_edit_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER class_result_recalculation_immutable BEFORE DELETE OR UPDATE ON public.class_result_recalculation FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER class_result_recalculation_item_immutable BEFORE DELETE OR UPDATE ON public.class_result_recalculation_item FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER course_control_immutable BEFORE DELETE OR UPDATE ON public.course_control FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER course_edit_request_immutable BEFORE DELETE OR UPDATE ON public.course_edit_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER course_variant_assignment_request_immutable BEFORE DELETE OR UPDATE ON public.course_variant_assignment_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER course_variant_control_immutable BEFORE DELETE OR UPDATE ON public.course_variant_control FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER course_variant_immutable BEFORE DELETE OR UPDATE ON public.course_variant FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER course_version_immutable BEFORE DELETE OR UPDATE ON public.course_version FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER device_ingest_outcome_immutable BEFORE DELETE OR UPDATE ON public.device_ingest_outcome FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER did_not_finish_decision_immutable BEFORE DELETE OR UPDATE ON public.did_not_finish_decision FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER did_not_finish_withdrawal_immutable BEFORE DELETE OR UPDATE ON public.did_not_finish_withdrawal FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER did_not_start_decision_immutable BEFORE DELETE OR UPDATE ON public.did_not_start_decision FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER did_not_start_withdrawal_immutable BEFORE DELETE OR UPDATE ON public.did_not_start_withdrawal FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER entry_card_change_request_immutable BEFORE DELETE OR UPDATE ON public.entry_card_change_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER entry_card_rental_change_immutable BEFORE DELETE OR UPDATE ON public.entry_card_rental_change FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER entry_card_rental_return_change_immutable BEFORE DELETE OR UPDATE ON public.entry_card_rental_return_change FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER entry_card_rental_reuse_request_immutable BEFORE DELETE OR UPDATE ON public.entry_card_rental_reuse_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER entry_class_change_request_immutable BEFORE DELETE OR UPDATE ON public.entry_class_change_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER entry_identity_change_request_immutable BEFORE DELETE OR UPDATE ON public.entry_identity_change_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER entry_registration_request_immutable BEFORE DELETE OR UPDATE ON public.entry_registration_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER entry_start_time_change_request_immutable BEFORE DELETE OR UPDATE ON public.entry_start_time_change_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER entry_transfer_immutable BEFORE DELETE OR UPDATE ON public.entry_transfer_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER event_administration_access_request_immutable BEFORE DELETE OR UPDATE ON public.event_administration_access_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER event_administration_grant_create_guard AFTER INSERT ON public.event_administration_grant FOR EACH ROW EXECUTE FUNCTION public.create_event_administration_grant_guard();

CREATE TRIGGER event_administration_grant_guard_protected BEFORE DELETE OR UPDATE ON public.event_administration_grant_guard FOR EACH ROW EXECUTE FUNCTION public.protect_task150_auth_guard();

CREATE TRIGGER event_administration_grant_immutable BEFORE DELETE OR UPDATE ON public.event_administration_grant FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER event_administration_grant_revocation_advance_guard AFTER INSERT ON public.event_administration_grant_revocation FOR EACH ROW EXECUTE FUNCTION public.advance_event_administration_grant_guard();

CREATE TRIGGER event_administration_grant_revocation_immutable BEFORE DELETE OR UPDATE ON public.event_administration_grant_revocation FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER import_file_immutable BEFORE DELETE OR UPDATE ON public.import_file FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER iof_import_request_immutable BEFORE DELETE OR UPDATE ON public.iof_import_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER manual_class_create_request_immutable BEFORE DELETE OR UPDATE ON public.manual_class_create_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER manual_course_class_create_request_immutable BEFORE DELETE OR UPDATE ON public.manual_course_class_create_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER manual_finish_time_correction_immutable BEFORE DELETE OR UPDATE ON public.manual_finish_time_correction FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER manual_finish_time_correction_withdrawal_immutable BEFORE DELETE OR UPDATE ON public.manual_finish_time_correction_withdrawal FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER manual_punch_start_time_correction_immutable BEFORE DELETE OR UPDATE ON public.manual_punch_start_time_correction FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER manual_punch_start_time_correction_withdrawal_immutable BEFORE DELETE OR UPDATE ON public.manual_punch_start_time_correction_withdrawal FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER not_competing_decision_immutable BEFORE DELETE OR UPDATE ON public.not_competing_decision FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER not_competing_withdrawal_immutable BEFORE DELETE OR UPDATE ON public.not_competing_withdrawal FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER pairing_admin_access_credential_immutable BEFORE DELETE OR UPDATE ON public.pairing_admin_access_credential FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER pairing_admin_access_credential_revocation_immutable BEFORE DELETE OR UPDATE ON public.pairing_admin_access_credential_revocation FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER pairing_admin_credential_create_guard AFTER INSERT ON public.pairing_admin_access_credential FOR EACH ROW EXECUTE FUNCTION public.create_pairing_admin_revocation_guard();

CREATE TRIGGER pairing_admin_credential_revocation_advance_guard AFTER INSERT ON public.pairing_admin_access_credential_revocation FOR EACH ROW EXECUTE FUNCTION public.advance_pairing_admin_revocation_guard();

CREATE TRIGGER pairing_admin_revocation_guard_protected BEFORE DELETE OR UPDATE ON public.pairing_admin_revocation_guard FOR EACH ROW EXECUTE FUNCTION public.protect_pairing_admin_revocation_guard();

CREATE TRIGGER pairing_admin_session_immutable BEFORE DELETE OR UPDATE ON public.pairing_admin_session FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER pairing_admin_session_revocation_advance_guard AFTER INSERT ON public.pairing_admin_session_revocation FOR EACH ROW EXECUTE FUNCTION public.advance_pairing_admin_revocation_guard();

CREATE TRIGGER pairing_admin_session_revocation_immutable BEFORE DELETE OR UPDATE ON public.pairing_admin_session_revocation FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER public_result_update_event_immutable BEFORE UPDATE ON public.public_result_update_event FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER race_copy_request_immutable BEFORE DELETE OR UPDATE ON public.race_copy_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER radio_punch_immutable BEFORE DELETE OR UPDATE ON public.radio_punch FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER radio_punch_public_update_event AFTER INSERT ON public.radio_punch REFERENCING NEW TABLE AS new_radio_punches FOR EACH STATEMENT EXECUTE FUNCTION public.record_radio_punch_update_event();

CREATE TRIGGER raw_device_message_immutable BEFORE DELETE OR UPDATE ON public.raw_device_message FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER relay_request_immutable BEFORE DELETE OR UPDATE ON public.relay_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER result_approval_decision_immutable BEFORE DELETE OR UPDATE ON public.result_approval_decision FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER result_approval_withdrawal_immutable BEFORE DELETE OR UPDATE ON public.result_approval_withdrawal FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER result_disqualification_decision_immutable BEFORE DELETE OR UPDATE ON public.result_disqualification_decision FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER result_disqualification_withdrawal_immutable BEFORE DELETE OR UPDATE ON public.result_disqualification_withdrawal FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER result_finalization_immutable BEFORE DELETE OR UPDATE ON public.result_finalization FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER result_recalculation_request_immutable BEFORE DELETE OR UPDATE ON public.result_recalculation_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER result_revision_basis_hash BEFORE INSERT ON public.result_revision FOR EACH ROW EXECUTE FUNCTION public.set_result_revision_basis_hash();

CREATE TRIGGER result_revision_immutable BEFORE DELETE OR UPDATE ON public.result_revision FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER result_revision_public_result_update_event AFTER INSERT ON public.result_revision FOR EACH ROW EXECUTE FUNCTION public.record_public_result_update_event();

CREATE TRIGGER rogaining_change_request_immutable BEFORE DELETE OR UPDATE ON public.rogaining_change_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER shortened_course_class_transfer_immutable BEFORE DELETE OR UPDATE ON public.shortened_course_class_transfer FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER shortened_course_class_transfer_item_immutable BEFORE DELETE OR UPDATE ON public.shortened_course_class_transfer_item FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER start_checkin_conflict_review_immutable BEFORE DELETE OR UPDATE ON public.start_checkin_conflict_review FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER start_checkin_conflict_review_item_immutable BEFORE DELETE OR UPDATE ON public.start_checkin_conflict_review_item FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER start_checkin_device_immutable BEFORE DELETE OR UPDATE ON public.start_checkin_device FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER start_checkin_dns_decision_immutable BEFORE DELETE OR UPDATE ON public.start_checkin_dns_decision FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER start_checkin_dns_withdrawal_immutable BEFORE DELETE OR UPDATE ON public.start_checkin_dns_withdrawal FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER start_checkin_operation_immutable BEFORE DELETE OR UPDATE ON public.start_checkin_operation FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER start_checkin_revision_immutable BEFORE DELETE OR UPDATE ON public.start_checkin_revision FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER start_draw_class_immutable BEFORE DELETE OR UPDATE ON public.start_draw_class FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER start_draw_request_immutable BEFORE DELETE OR UPDATE ON public.start_draw_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER start_draw_slot_immutable BEFORE DELETE OR UPDATE ON public.start_draw_slot FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER start_list_publication_immutable BEFORE DELETE OR UPDATE ON public.start_list_publication FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER superadmin_action_append_only BEFORE DELETE OR UPDATE ON public.superadmin_action FOR EACH ROW EXECUTE FUNCTION public.superadmin_action_reject_change();

CREATE TRIGGER unknown_readout_resolution_immutable BEFORE DELETE OR UPDATE ON public.unknown_readout_resolution FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER user_account_auth_guard_protected BEFORE DELETE OR UPDATE ON public.user_account_auth_guard FOR EACH ROW EXECUTE FUNCTION public.protect_task150_auth_guard();

CREATE TRIGGER user_account_create_guard AFTER INSERT ON public.user_account FOR EACH ROW EXECUTE FUNCTION public.create_user_account_auth_guard();

CREATE TRIGGER user_account_event_creation_request_immutable BEFORE DELETE OR UPDATE ON public.user_account_event_creation_request FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER user_account_identity_protected BEFORE DELETE OR UPDATE ON public.user_account FOR EACH ROW EXECUTE FUNCTION public.protect_user_account_identity();

CREATE TRIGGER user_account_password_advance_guard AFTER INSERT ON public.user_account_password_verifier FOR EACH ROW EXECUTE FUNCTION public.advance_user_account_auth_guard();

CREATE TRIGGER user_account_password_verifier_immutable BEFORE DELETE OR UPDATE ON public.user_account_password_verifier FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER user_account_race_delegation_immutable BEFORE DELETE OR UPDATE ON public.user_account_race_delegation FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER user_account_session_immutable BEFORE DELETE OR UPDATE ON public.user_account_session FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER user_account_session_revocation_advance_guard AFTER INSERT ON public.user_account_session_revocation FOR EACH ROW EXECUTE FUNCTION public.advance_user_account_auth_guard();

CREATE TRIGGER user_account_session_revocation_immutable BEFORE DELETE OR UPDATE ON public.user_account_session_revocation FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER without_timing_decision_immutable BEFORE DELETE OR UPDATE ON public.without_timing_decision FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER without_timing_withdrawal_immutable BEFORE DELETE OR UPDATE ON public.without_timing_withdrawal FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

ALTER TABLE ONLY public.audit_event
    ADD CONSTRAINT audit_event_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.card_assignment
    ADD CONSTRAINT card_assignment_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.card_assignment
    ADD CONSTRAINT card_assignment_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.card_readout
    ADD CONSTRAINT card_readout_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.card_readout
    ADD CONSTRAINT card_readout_raw_message_id_fkey FOREIGN KEY (raw_message_id) REFERENCES public.raw_device_message(id);

ALTER TABLE ONLY public.class_capacity_change_request
    ADD CONSTRAINT class_capacity_change_request_actor_credential_id_race_id__fkey FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.class_capacity_change_request
    ADD CONSTRAINT class_capacity_change_request_class_id_race_id_fkey FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.class_capacity_change_request
    ADD CONSTRAINT class_capacity_change_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.class_control_neutralization
    ADD CONSTRAINT class_control_neutralization_actor_credential_id_race_id_c_fkey FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.class_control_neutralization
    ADD CONSTRAINT class_control_neutralization_class_id_race_id_fkey FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.class_control_neutralization
    ADD CONSTRAINT class_control_neutralization_course_control_id_fkey FOREIGN KEY (course_control_id) REFERENCES public.course_control(id);

ALTER TABLE ONLY public.class_control_neutralization
    ADD CONSTRAINT class_control_neutralization_course_version_id_fkey FOREIGN KEY (course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.class_control_neutralization
    ADD CONSTRAINT class_control_neutralization_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.class
    ADD CONSTRAINT class_course_version_id_fkey FOREIGN KEY (course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.class_edit_request
    ADD CONSTRAINT class_edit_request_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.class_edit_request
    ADD CONSTRAINT class_edit_request_class_race_fk FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.class_edit_request
    ADD CONSTRAINT class_edit_request_course_version_id_fkey FOREIGN KEY (course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.class_edit_request
    ADD CONSTRAINT class_edit_request_previous_course_version_id_fkey FOREIGN KEY (previous_course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.class_edit_request
    ADD CONSTRAINT class_edit_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.class
    ADD CONSTRAINT class_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.class_result_recalculation
    ADD CONSTRAINT class_result_recalculation_actor_credential_id_race_id_cap_fkey FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.class_result_recalculation
    ADD CONSTRAINT class_result_recalculation_class_id_race_id_fkey FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.class_result_recalculation_item
    ADD CONSTRAINT class_result_recalculation_ite_expected_result_revision_id_fkey FOREIGN KEY (expected_result_revision_id) REFERENCES public.result_revision(id);

ALTER TABLE ONLY public.class_result_recalculation_item
    ADD CONSTRAINT class_result_recalculation_item_class_id_race_id_fkey FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.class_result_recalculation_item
    ADD CONSTRAINT class_result_recalculation_item_created_result_revision_id_fkey FOREIGN KEY (created_result_revision_id) REFERENCES public.result_revision(id);

ALTER TABLE ONLY public.class_result_recalculation_item
    ADD CONSTRAINT class_result_recalculation_item_entry_id_race_id_fkey FOREIGN KEY (entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.class_result_recalculation_item
    ADD CONSTRAINT class_result_recalculation_item_expected_assignment_id_fkey FOREIGN KEY (expected_assignment_id) REFERENCES public.card_assignment(id);

ALTER TABLE ONLY public.class_result_recalculation_item
    ADD CONSTRAINT class_result_recalculation_item_expected_readout_id_fkey FOREIGN KEY (expected_readout_id) REFERENCES public.card_readout(id);

ALTER TABLE ONLY public.class_result_recalculation_item
    ADD CONSTRAINT class_result_recalculation_item_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.class_result_recalculation(request_id);

ALTER TABLE ONLY public.class_result_recalculation
    ADD CONSTRAINT class_result_recalculation_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.class
    ADD CONSTRAINT class_start_draw_fk FOREIGN KEY (start_draw_id, id) REFERENCES public.start_draw_class(draw_id, class_id);

ALTER TABLE ONLY public.control
    ADD CONSTRAINT control_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.course_control
    ADD CONSTRAINT course_control_control_id_fkey FOREIGN KEY (control_id) REFERENCES public.control(id);

ALTER TABLE ONLY public.course_control
    ADD CONSTRAINT course_control_course_version_id_fkey FOREIGN KEY (course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.course_edit_request
    ADD CONSTRAINT course_edit_request_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.course_edit_request
    ADD CONSTRAINT course_edit_request_course_race_fk FOREIGN KEY (course_id, race_id) REFERENCES public.course(id, race_id);

ALTER TABLE ONLY public.course_edit_request
    ADD CONSTRAINT course_edit_request_previous_version_fk FOREIGN KEY (previous_course_version_id, course_id) REFERENCES public.course_version(id, course_id);

ALTER TABLE ONLY public.course_edit_request
    ADD CONSTRAINT course_edit_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.course_edit_request
    ADD CONSTRAINT course_edit_request_version_fk FOREIGN KEY (course_version_id, course_id) REFERENCES public.course_version(id, course_id);

ALTER TABLE ONLY public.course
    ADD CONSTRAINT course_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.course_variant_assignment_request
    ADD CONSTRAINT course_variant_assignment_request_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.course_variant_assignment_request
    ADD CONSTRAINT course_variant_assignment_request_class_fk FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.course_variant_assignment_request
    ADD CONSTRAINT course_variant_assignment_request_entry_fk FOREIGN KEY (entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.course_variant_assignment_request
    ADD CONSTRAINT course_variant_assignment_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.course_variant_control
    ADD CONSTRAINT course_variant_control_control_id_fkey FOREIGN KEY (control_id) REFERENCES public.control(id);

ALTER TABLE ONLY public.course_variant_control
    ADD CONSTRAINT course_variant_control_course_variant_id_fkey FOREIGN KEY (course_variant_id) REFERENCES public.course_variant(id);

ALTER TABLE ONLY public.course_variant
    ADD CONSTRAINT course_variant_course_version_id_fkey FOREIGN KEY (course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.course_version
    ADD CONSTRAINT course_version_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(id);

ALTER TABLE ONLY public.device_ingest_outcome
    ADD CONSTRAINT device_ingest_outcome_raw_message_id_fkey FOREIGN KEY (raw_message_id) REFERENCES public.raw_device_message(id);

ALTER TABLE ONLY public.did_not_finish_decision
    ADD CONSTRAINT did_not_finish_decision_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.did_not_finish_decision
    ADD CONSTRAINT did_not_finish_decision_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.did_not_finish_decision
    ADD CONSTRAINT did_not_finish_decision_expected_class_id_fkey FOREIGN KEY (expected_class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.did_not_finish_decision
    ADD CONSTRAINT did_not_finish_decision_expected_course_version_id_fkey FOREIGN KEY (expected_course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.did_not_finish_decision
    ADD CONSTRAINT did_not_finish_decision_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.did_not_finish_decision
    ADD CONSTRAINT did_not_finish_decision_result_pair_fk FOREIGN KEY (created_result_revision_id, id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, did_not_finish_decision_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.did_not_finish_decision
    ADD CONSTRAINT did_not_finish_decision_target_fk FOREIGN KEY (target_result_revision_id, race_id, entry_id, target_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.did_not_finish_withdrawal
    ADD CONSTRAINT did_not_finish_withdrawal_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.did_not_finish_withdrawal
    ADD CONSTRAINT did_not_finish_withdrawal_decision_fk FOREIGN KEY (did_not_finish_decision_id, target_result_revision_id, target_result_revision, withdrawn_result_revision_id, race_id, entry_id, withdrawn_result_revision) REFERENCES public.did_not_finish_decision(id, target_result_revision_id, target_result_revision, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.did_not_finish_withdrawal
    ADD CONSTRAINT did_not_finish_withdrawal_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.did_not_finish_withdrawal
    ADD CONSTRAINT did_not_finish_withdrawal_expected_class_id_fkey FOREIGN KEY (expected_class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.did_not_finish_withdrawal
    ADD CONSTRAINT did_not_finish_withdrawal_expected_course_version_id_fkey FOREIGN KEY (expected_course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.did_not_finish_withdrawal
    ADD CONSTRAINT did_not_finish_withdrawal_latest_result_fk FOREIGN KEY (expected_latest_result_revision_id, race_id, entry_id, expected_latest_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.did_not_finish_withdrawal
    ADD CONSTRAINT did_not_finish_withdrawal_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.did_not_finish_withdrawal
    ADD CONSTRAINT did_not_finish_withdrawal_restored_from_fk FOREIGN KEY (restored_from_result_revision_id, race_id, entry_id, restored_from_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.did_not_finish_withdrawal
    ADD CONSTRAINT did_not_finish_withdrawal_result_pair_fk FOREIGN KEY (created_result_revision_id, id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, did_not_finish_withdrawal_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.did_not_start_decision
    ADD CONSTRAINT did_not_start_decision_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.did_not_start_decision
    ADD CONSTRAINT did_not_start_decision_created_result_fk FOREIGN KEY (created_result_revision_id) REFERENCES public.result_revision(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.did_not_start_decision
    ADD CONSTRAINT did_not_start_decision_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.did_not_start_decision
    ADD CONSTRAINT did_not_start_decision_expected_class_id_fkey FOREIGN KEY (expected_class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.did_not_start_decision
    ADD CONSTRAINT did_not_start_decision_expected_course_version_id_fkey FOREIGN KEY (expected_course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.did_not_start_decision
    ADD CONSTRAINT did_not_start_decision_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.did_not_start_decision
    ADD CONSTRAINT did_not_start_decision_result_pair_fk FOREIGN KEY (created_result_revision_id, id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, did_not_start_decision_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.did_not_start_withdrawal
    ADD CONSTRAINT did_not_start_withdrawal_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.did_not_start_withdrawal
    ADD CONSTRAINT did_not_start_withdrawal_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.did_not_start_withdrawal
    ADD CONSTRAINT did_not_start_withdrawal_expected_class_id_fkey FOREIGN KEY (expected_class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.did_not_start_withdrawal
    ADD CONSTRAINT did_not_start_withdrawal_expected_course_version_id_fkey FOREIGN KEY (expected_course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.did_not_start_withdrawal
    ADD CONSTRAINT did_not_start_withdrawal_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.did_not_start_withdrawal
    ADD CONSTRAINT did_not_start_withdrawal_target_fk FOREIGN KEY (did_not_start_decision_id, withdrawn_result_revision_id, race_id, entry_id, expected_latest_result_revision) REFERENCES public.did_not_start_decision(id, created_result_revision_id, race_id, entry_id, created_result_revision);

ALTER TABLE ONLY public.entry_card_change_request
    ADD CONSTRAINT entry_card_change_request_active_assignment_id_fkey FOREIGN KEY (active_assignment_id) REFERENCES public.card_assignment(id);

ALTER TABLE ONLY public.entry_card_change_request
    ADD CONSTRAINT entry_card_change_request_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.entry_card_change_request
    ADD CONSTRAINT entry_card_change_request_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.entry_card_change_request
    ADD CONSTRAINT entry_card_change_request_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.entry_card_change_request
    ADD CONSTRAINT entry_card_change_request_previous_assignment_id_fkey FOREIGN KEY (previous_assignment_id) REFERENCES public.card_assignment(id);

ALTER TABLE ONLY public.entry_card_change_request
    ADD CONSTRAINT entry_card_change_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.entry_card_rental_change
    ADD CONSTRAINT entry_card_rental_change_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.entry_card_rental_change
    ADD CONSTRAINT entry_card_rental_change_assignment_scope_fk FOREIGN KEY (assignment_id, race_id, entry_id, card_number) REFERENCES public.card_assignment(id, race_id, entry_id, card_number);

ALTER TABLE ONLY public.entry_card_rental_change
    ADD CONSTRAINT entry_card_rental_change_class_scope_fk FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.entry_card_rental_change
    ADD CONSTRAINT entry_card_rental_change_entry_scope_fk FOREIGN KEY (entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.entry_card_rental_return_change
    ADD CONSTRAINT entry_card_rental_return_change_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.entry_card_rental_return_change
    ADD CONSTRAINT entry_card_rental_return_change_assignment_scope_fk FOREIGN KEY (assignment_id, race_id, entry_id, card_number) REFERENCES public.card_assignment(id, race_id, entry_id, card_number);

ALTER TABLE ONLY public.entry_card_rental_return_change
    ADD CONSTRAINT entry_card_rental_return_change_class_scope_fk FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.entry_card_rental_return_change
    ADD CONSTRAINT entry_card_rental_return_change_entry_scope_fk FOREIGN KEY (entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.entry_card_rental_reuse_request
    ADD CONSTRAINT entry_card_rental_reuse_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.entry_card_rental_reuse_request
    ADD CONSTRAINT entry_card_rental_reuse_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.entry_card_rental_reuse_request
    ADD CONSTRAINT entry_card_rental_reuse_source_assignment_scope_fk FOREIGN KEY (source_assignment_id, race_id, source_entry_id, card_number) REFERENCES public.card_assignment(id, race_id, entry_id, card_number);

ALTER TABLE ONLY public.entry_card_rental_reuse_request
    ADD CONSTRAINT entry_card_rental_reuse_source_class_scope_fk FOREIGN KEY (source_class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.entry_card_rental_reuse_request
    ADD CONSTRAINT entry_card_rental_reuse_source_entry_scope_fk FOREIGN KEY (source_entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.entry_card_rental_reuse_request
    ADD CONSTRAINT entry_card_rental_reuse_target_assignment_scope_fk FOREIGN KEY (target_assignment_id, race_id, target_entry_id, card_number) REFERENCES public.card_assignment(id, race_id, entry_id, card_number);

ALTER TABLE ONLY public.entry_card_rental_reuse_request
    ADD CONSTRAINT entry_card_rental_reuse_target_class_scope_fk FOREIGN KEY (target_class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.entry_card_rental_reuse_request
    ADD CONSTRAINT entry_card_rental_reuse_target_entry_scope_fk FOREIGN KEY (target_entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.entry_class_change_request
    ADD CONSTRAINT entry_class_change_request_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.entry_class_change_request
    ADD CONSTRAINT entry_class_change_request_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.entry_class_change_request
    ADD CONSTRAINT entry_class_change_request_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.entry_class_change_request
    ADD CONSTRAINT entry_class_change_request_previous_class_id_fkey FOREIGN KEY (previous_class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.entry_class_change_request
    ADD CONSTRAINT entry_class_change_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.entry
    ADD CONSTRAINT entry_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.entry_identity_change_request
    ADD CONSTRAINT entry_identity_change_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.entry_identity_change_request
    ADD CONSTRAINT entry_identity_change_class_scope_fk FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.entry_identity_change_request
    ADD CONSTRAINT entry_identity_change_entry_scope_fk FOREIGN KEY (entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.entry_identity_change_request
    ADD CONSTRAINT entry_identity_change_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.entry
    ADD CONSTRAINT entry_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.entry_registration_request
    ADD CONSTRAINT entry_registration_request_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.entry_registration_request
    ADD CONSTRAINT entry_registration_request_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.card_assignment(id);

ALTER TABLE ONLY public.entry_registration_request
    ADD CONSTRAINT entry_registration_request_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.entry_registration_request
    ADD CONSTRAINT entry_registration_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.entry_start_time_change_request
    ADD CONSTRAINT entry_start_time_change_request_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.entry_start_time_change_request
    ADD CONSTRAINT entry_start_time_change_request_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.entry_start_time_change_request
    ADD CONSTRAINT entry_start_time_change_request_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.entry_start_time_change_request
    ADD CONSTRAINT entry_start_time_change_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.entry
    ADD CONSTRAINT entry_team_fk FOREIGN KEY (team_id, class_id) REFERENCES public.team(id, class_id);

ALTER TABLE ONLY public.entry_transfer_request
    ADD CONSTRAINT entry_transfer_request_actor_credential_id_race_id_capabil_fkey FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.entry_transfer_request
    ADD CONSTRAINT entry_transfer_request_entry_id_race_id_fkey FOREIGN KEY (entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.entry_transfer_request
    ADD CONSTRAINT entry_transfer_request_previous_class_id_race_id_fkey FOREIGN KEY (previous_class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.entry_transfer_request
    ADD CONSTRAINT entry_transfer_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.entry_transfer_request
    ADD CONSTRAINT entry_transfer_request_target_class_id_race_id_fkey FOREIGN KEY (target_class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.event_administration_access_request
    ADD CONSTRAINT event_administration_access_request_actor_account_id_fkey FOREIGN KEY (actor_account_id) REFERENCES public.user_account(id);

ALTER TABLE ONLY public.event_administration_access_request
    ADD CONSTRAINT event_administration_access_request_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.event(id);

ALTER TABLE ONLY public.event_administration_access_request
    ADD CONSTRAINT event_administration_access_request_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES public.event_administration_grant(id);

ALTER TABLE ONLY public.event_administration_access_request
    ADD CONSTRAINT event_administration_access_request_grant_scope_fk FOREIGN KEY (grant_id, target_account_id, event_id) REFERENCES public.event_administration_grant(id, account_id, event_id);

ALTER TABLE ONLY public.event_administration_access_request
    ADD CONSTRAINT event_administration_access_request_target_account_id_fkey FOREIGN KEY (target_account_id) REFERENCES public.user_account(id);

ALTER TABLE ONLY public.event_administration_grant
    ADD CONSTRAINT event_administration_grant_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.user_account(id);

ALTER TABLE ONLY public.event_administration_grant
    ADD CONSTRAINT event_administration_grant_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.event(id);

ALTER TABLE ONLY public.event_administration_grant_guard
    ADD CONSTRAINT event_administration_grant_guard_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES public.event_administration_grant(id);

ALTER TABLE ONLY public.event_administration_grant_revocation
    ADD CONSTRAINT event_administration_grant_revocation_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES public.event_administration_grant(id);

ALTER TABLE ONLY public.import_file
    ADD CONSTRAINT import_file_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.iof_import_request
    ADD CONSTRAINT iof_import_request_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.iof_import_request
    ADD CONSTRAINT iof_import_request_import_file_id_fkey FOREIGN KEY (import_file_id) REFERENCES public.import_file(id);

ALTER TABLE ONLY public.iof_import_request
    ADD CONSTRAINT iof_import_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.manual_class_create_request
    ADD CONSTRAINT manual_class_create_request_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.manual_class_create_request
    ADD CONSTRAINT manual_class_create_request_class_race_fk FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.manual_class_create_request
    ADD CONSTRAINT manual_class_create_request_course_race_fk FOREIGN KEY (course_id, race_id) REFERENCES public.course(id, race_id);

ALTER TABLE ONLY public.manual_class_create_request
    ADD CONSTRAINT manual_class_create_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.manual_class_create_request
    ADD CONSTRAINT manual_class_create_request_version_course_fk FOREIGN KEY (course_version_id, course_id) REFERENCES public.course_version(id, course_id);

ALTER TABLE ONLY public.manual_course_class_create_request
    ADD CONSTRAINT manual_course_class_create_re_actor_credential_id_race_id__fkey FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.manual_course_class_create_request
    ADD CONSTRAINT manual_course_class_create_req_course_version_id_course_id_fkey FOREIGN KEY (course_version_id, course_id) REFERENCES public.course_version(id, course_id);

ALTER TABLE ONLY public.manual_course_class_create_request
    ADD CONSTRAINT manual_course_class_create_request_class_race_fk FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.manual_course_class_create_request
    ADD CONSTRAINT manual_course_class_create_request_course_id_race_id_fkey FOREIGN KEY (course_id, race_id) REFERENCES public.course(id, race_id);

ALTER TABLE ONLY public.manual_course_class_create_request
    ADD CONSTRAINT manual_course_class_create_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.manual_finish_time_correction
    ADD CONSTRAINT manual_finish_time_correction_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.manual_finish_time_correction
    ADD CONSTRAINT manual_finish_time_correction_class_scope_fk FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.manual_finish_time_correction
    ADD CONSTRAINT manual_finish_time_correction_course_version_id_fkey FOREIGN KEY (course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.manual_finish_time_correction
    ADD CONSTRAINT manual_finish_time_correction_entry_scope_fk FOREIGN KEY (entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.manual_finish_time_correction
    ADD CONSTRAINT manual_finish_time_correction_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.manual_finish_time_correction
    ADD CONSTRAINT manual_finish_time_correction_result_pair_fk FOREIGN KEY (created_result_revision_id, request_id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, manual_finish_time_correction_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.manual_finish_time_correction
    ADD CONSTRAINT manual_finish_time_correction_source_readout_id_fkey FOREIGN KEY (source_readout_id) REFERENCES public.card_readout(id);

ALTER TABLE ONLY public.manual_finish_time_correction
    ADD CONSTRAINT manual_finish_time_correction_source_result_fk FOREIGN KEY (source_result_revision_id, race_id, entry_id, source_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision);

ALTER TABLE ONLY public.manual_finish_time_correction_withdrawal
    ADD CONSTRAINT manual_finish_time_correction_withdrawal_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.manual_finish_time_correction_withdrawal
    ADD CONSTRAINT manual_finish_time_correction_withdrawal_class_scope_fk FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.manual_finish_time_correction_withdrawal
    ADD CONSTRAINT manual_finish_time_correction_withdrawal_corrected_fk FOREIGN KEY (corrected_result_revision_id, correction_id, race_id, entry_id, corrected_result_revision) REFERENCES public.result_revision(id, manual_finish_time_correction_id, race_id, entry_id, revision);

ALTER TABLE ONLY public.manual_finish_time_correction_withdrawal
    ADD CONSTRAINT manual_finish_time_correction_withdrawal_course_version_id_fkey FOREIGN KEY (course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.manual_finish_time_correction_withdrawal
    ADD CONSTRAINT manual_finish_time_correction_withdrawal_created_fk FOREIGN KEY (created_result_revision_id, id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, manual_finish_time_correction_withdrawal_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.manual_finish_time_correction_withdrawal
    ADD CONSTRAINT manual_finish_time_correction_withdrawal_entry_scope_fk FOREIGN KEY (entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.manual_finish_time_correction_withdrawal
    ADD CONSTRAINT manual_finish_time_correction_withdrawal_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.manual_finish_time_correction_withdrawal
    ADD CONSTRAINT manual_finish_time_correction_withdrawal_source_fk FOREIGN KEY (source_result_revision_id, race_id, entry_id, source_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision);

ALTER TABLE ONLY public.manual_punch_start_time_correction
    ADD CONSTRAINT manual_punch_start_time_correction_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.manual_punch_start_time_correction
    ADD CONSTRAINT manual_punch_start_time_correction_class_scope_fk FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.manual_punch_start_time_correction
    ADD CONSTRAINT manual_punch_start_time_correction_course_version_id_fkey FOREIGN KEY (course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.manual_punch_start_time_correction
    ADD CONSTRAINT manual_punch_start_time_correction_entry_scope_fk FOREIGN KEY (entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.manual_punch_start_time_correction
    ADD CONSTRAINT manual_punch_start_time_correction_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.manual_punch_start_time_correction
    ADD CONSTRAINT manual_punch_start_time_correction_result_pair_fk FOREIGN KEY (created_result_revision_id, request_id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, manual_punch_start_time_correction_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.manual_punch_start_time_correction
    ADD CONSTRAINT manual_punch_start_time_correction_source_readout_id_fkey FOREIGN KEY (source_readout_id) REFERENCES public.card_readout(id);

ALTER TABLE ONLY public.manual_punch_start_time_correction
    ADD CONSTRAINT manual_punch_start_time_correction_source_result_fk FOREIGN KEY (source_result_revision_id, race_id, entry_id, source_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision);

ALTER TABLE ONLY public.manual_punch_start_time_correction_withdrawal
    ADD CONSTRAINT manual_punch_start_time_correction_withd_course_version_id_fkey FOREIGN KEY (course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.manual_punch_start_time_correction_withdrawal
    ADD CONSTRAINT manual_punch_start_time_correction_withdrawal_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.manual_punch_start_time_correction_withdrawal
    ADD CONSTRAINT manual_punch_start_time_correction_withdrawal_class_scope_fk FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.manual_punch_start_time_correction_withdrawal
    ADD CONSTRAINT manual_punch_start_time_correction_withdrawal_corrected_fk FOREIGN KEY (corrected_result_revision_id, correction_id, race_id, entry_id, corrected_result_revision) REFERENCES public.result_revision(id, manual_punch_start_time_correction_id, race_id, entry_id, revision);

ALTER TABLE ONLY public.manual_punch_start_time_correction_withdrawal
    ADD CONSTRAINT manual_punch_start_time_correction_withdrawal_created_fk FOREIGN KEY (created_result_revision_id, id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, manual_punch_start_time_correction_withdrawal_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.manual_punch_start_time_correction_withdrawal
    ADD CONSTRAINT manual_punch_start_time_correction_withdrawal_entry_scope_fk FOREIGN KEY (entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.manual_punch_start_time_correction_withdrawal
    ADD CONSTRAINT manual_punch_start_time_correction_withdrawal_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.manual_punch_start_time_correction_withdrawal
    ADD CONSTRAINT manual_punch_start_time_correction_withdrawal_source_fk FOREIGN KEY (source_result_revision_id, race_id, entry_id, source_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision);

ALTER TABLE ONLY public.not_competing_decision
    ADD CONSTRAINT not_competing_decision_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.not_competing_decision
    ADD CONSTRAINT not_competing_decision_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.not_competing_decision
    ADD CONSTRAINT not_competing_decision_expected_class_id_fkey FOREIGN KEY (expected_class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.not_competing_decision
    ADD CONSTRAINT not_competing_decision_expected_course_version_id_fkey FOREIGN KEY (expected_course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.not_competing_decision
    ADD CONSTRAINT not_competing_decision_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.not_competing_decision
    ADD CONSTRAINT not_competing_decision_result_pair_fk FOREIGN KEY (created_result_revision_id, id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, not_competing_decision_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.not_competing_decision
    ADD CONSTRAINT not_competing_decision_target_fk FOREIGN KEY (target_result_revision_id, race_id, entry_id, target_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.not_competing_withdrawal
    ADD CONSTRAINT not_competing_withdrawal_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.not_competing_withdrawal
    ADD CONSTRAINT not_competing_withdrawal_decision_fk FOREIGN KEY (not_competing_decision_id, target_result_revision_id, target_result_revision, withdrawn_result_revision_id, race_id, entry_id, withdrawn_result_revision) REFERENCES public.not_competing_decision(id, target_result_revision_id, target_result_revision, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.not_competing_withdrawal
    ADD CONSTRAINT not_competing_withdrawal_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.not_competing_withdrawal
    ADD CONSTRAINT not_competing_withdrawal_expected_class_id_fkey FOREIGN KEY (expected_class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.not_competing_withdrawal
    ADD CONSTRAINT not_competing_withdrawal_expected_course_version_id_fkey FOREIGN KEY (expected_course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.not_competing_withdrawal
    ADD CONSTRAINT not_competing_withdrawal_latest_result_fk FOREIGN KEY (expected_latest_result_revision_id, race_id, entry_id, expected_latest_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.not_competing_withdrawal
    ADD CONSTRAINT not_competing_withdrawal_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.not_competing_withdrawal
    ADD CONSTRAINT not_competing_withdrawal_restored_from_fk FOREIGN KEY (restored_from_result_revision_id, race_id, entry_id, restored_from_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.not_competing_withdrawal
    ADD CONSTRAINT not_competing_withdrawal_result_pair_fk FOREIGN KEY (created_result_revision_id, id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, not_competing_withdrawal_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.pairing_admin_access_credential
    ADD CONSTRAINT pairing_admin_access_credential_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.pairing_admin_access_credential_revocation
    ADD CONSTRAINT pairing_admin_access_credential_revocation_credential_id_fkey FOREIGN KEY (credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.pairing_admin_revocation_guard
    ADD CONSTRAINT pairing_admin_revocation_guard_credential_id_fkey FOREIGN KEY (credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.pairing_admin_session
    ADD CONSTRAINT pairing_admin_session_access_credential_id_fkey FOREIGN KEY (access_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.pairing_admin_session_revocation
    ADD CONSTRAINT pairing_admin_session_revocation_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.pairing_admin_session(id);

ALTER TABLE ONLY public.participant_route
    ADD CONSTRAINT participant_route_entry_scope_fk FOREIGN KEY (entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.participant_route
    ADD CONSTRAINT participant_route_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.password_reset_token
    ADD CONSTRAINT password_reset_token_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.user_account(id);

ALTER TABLE ONLY public.public_result_update_event
    ADD CONSTRAINT public_result_update_event_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.race_copy_request
    ADD CONSTRAINT race_copy_request_actor_account_id_fkey FOREIGN KEY (actor_account_id) REFERENCES public.user_account(id);

ALTER TABLE ONLY public.race_copy_request
    ADD CONSTRAINT race_copy_request_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.event(id);

ALTER TABLE ONLY public.race_copy_request
    ADD CONSTRAINT race_copy_request_race_event_fk FOREIGN KEY (race_id, event_id) REFERENCES public.race(id, event_id);

ALTER TABLE ONLY public.race_copy_request
    ADD CONSTRAINT race_copy_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.race_copy_request
    ADD CONSTRAINT race_copy_request_source_race_id_fkey FOREIGN KEY (source_race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.race
    ADD CONSTRAINT race_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.event(id);

ALTER TABLE ONLY public.race_eventor_link
    ADD CONSTRAINT race_eventor_link_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.race_map
    ADD CONSTRAINT race_map_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.race_radio_control
    ADD CONSTRAINT race_radio_control_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.race_radio_link
    ADD CONSTRAINT race_radio_link_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.race_settings_request
    ADD CONSTRAINT race_settings_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.radio_punch
    ADD CONSTRAINT radio_punch_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.raw_device_message
    ADD CONSTRAINT raw_device_message_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.relay_leg
    ADD CONSTRAINT relay_leg_class_fk FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.relay_leg
    ADD CONSTRAINT relay_leg_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.relay_request
    ADD CONSTRAINT relay_request_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.relay_request
    ADD CONSTRAINT relay_request_class_fk FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.relay_request
    ADD CONSTRAINT relay_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.relay_request
    ADD CONSTRAINT relay_request_team_fk FOREIGN KEY (team_id) REFERENCES public.team(id);

ALTER TABLE ONLY public.result_approval_decision
    ADD CONSTRAINT result_approval_decision_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.result_approval_decision
    ADD CONSTRAINT result_approval_decision_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.result_approval_decision
    ADD CONSTRAINT result_approval_decision_expected_class_id_fkey FOREIGN KEY (expected_class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.result_approval_decision
    ADD CONSTRAINT result_approval_decision_expected_course_version_id_fkey FOREIGN KEY (expected_course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.result_approval_decision
    ADD CONSTRAINT result_approval_decision_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.result_approval_decision
    ADD CONSTRAINT result_approval_decision_result_pair_fk FOREIGN KEY (created_result_revision_id, id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, approval_decision_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_approval_decision
    ADD CONSTRAINT result_approval_decision_target_fk FOREIGN KEY (target_result_revision_id, race_id, entry_id, target_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_approval_withdrawal
    ADD CONSTRAINT result_approval_withdrawal_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.result_approval_withdrawal
    ADD CONSTRAINT result_approval_withdrawal_decision_fk FOREIGN KEY (approval_decision_id, withdrawn_result_revision_id, race_id, entry_id, withdrawn_result_revision) REFERENCES public.result_approval_decision(id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_approval_withdrawal
    ADD CONSTRAINT result_approval_withdrawal_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.result_approval_withdrawal
    ADD CONSTRAINT result_approval_withdrawal_expected_class_id_fkey FOREIGN KEY (expected_class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.result_approval_withdrawal
    ADD CONSTRAINT result_approval_withdrawal_expected_course_version_id_fkey FOREIGN KEY (expected_course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.result_approval_withdrawal
    ADD CONSTRAINT result_approval_withdrawal_latest_result_fk FOREIGN KEY (expected_latest_result_revision_id, race_id, entry_id, expected_latest_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_approval_withdrawal
    ADD CONSTRAINT result_approval_withdrawal_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.result_approval_withdrawal
    ADD CONSTRAINT result_approval_withdrawal_restored_from_fk FOREIGN KEY (restored_from_result_revision_id, race_id, entry_id, restored_from_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_approval_withdrawal
    ADD CONSTRAINT result_approval_withdrawal_result_pair_fk FOREIGN KEY (created_result_revision_id, id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, approval_withdrawal_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_disqualification_decision
    ADD CONSTRAINT result_disqualification_decisio_expected_course_version_id_fkey FOREIGN KEY (expected_course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.result_disqualification_decision
    ADD CONSTRAINT result_disqualification_decision_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.result_disqualification_decision
    ADD CONSTRAINT result_disqualification_decision_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.result_disqualification_decision
    ADD CONSTRAINT result_disqualification_decision_expected_class_id_fkey FOREIGN KEY (expected_class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.result_disqualification_decision
    ADD CONSTRAINT result_disqualification_decision_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.result_disqualification_decision
    ADD CONSTRAINT result_disqualification_decision_result_pair_fk FOREIGN KEY (created_result_revision_id, id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, disqualification_decision_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_disqualification_decision
    ADD CONSTRAINT result_disqualification_decision_target_fk FOREIGN KEY (target_result_revision_id, race_id, entry_id, target_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_disqualification_withdrawal
    ADD CONSTRAINT result_disqualification_withdra_expected_course_version_id_fkey FOREIGN KEY (expected_course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.result_disqualification_withdrawal
    ADD CONSTRAINT result_disqualification_withdrawal_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.result_disqualification_withdrawal
    ADD CONSTRAINT result_disqualification_withdrawal_decision_fk FOREIGN KEY (disqualification_decision_id, withdrawn_result_revision_id, race_id, entry_id, withdrawn_result_revision) REFERENCES public.result_disqualification_decision(id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_disqualification_withdrawal
    ADD CONSTRAINT result_disqualification_withdrawal_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.result_disqualification_withdrawal
    ADD CONSTRAINT result_disqualification_withdrawal_expected_class_id_fkey FOREIGN KEY (expected_class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.result_disqualification_withdrawal
    ADD CONSTRAINT result_disqualification_withdrawal_latest_result_fk FOREIGN KEY (expected_latest_result_revision_id, race_id, entry_id, expected_latest_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_disqualification_withdrawal
    ADD CONSTRAINT result_disqualification_withdrawal_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.result_disqualification_withdrawal
    ADD CONSTRAINT result_disqualification_withdrawal_restored_from_fk FOREIGN KEY (restored_from_result_revision_id, race_id, entry_id, restored_from_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_disqualification_withdrawal
    ADD CONSTRAINT result_disqualification_withdrawal_result_pair_fk FOREIGN KEY (created_result_revision_id, id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, disqualification_withdrawal_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_finalization
    ADD CONSTRAINT result_finalization_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.result_finalization
    ADD CONSTRAINT result_finalization_class_race_fk FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.result_finalization
    ADD CONSTRAINT result_finalization_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.result_recalculation_request
    ADD CONSTRAINT result_recalculation_request_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.result_recalculation_request
    ADD CONSTRAINT result_recalculation_request_created_result_revision_id_fkey FOREIGN KEY (created_result_revision_id) REFERENCES public.result_revision(id);

ALTER TABLE ONLY public.result_recalculation_request
    ADD CONSTRAINT result_recalculation_request_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.result_recalculation_request
    ADD CONSTRAINT result_recalculation_request_expected_card_assignment_id_fkey FOREIGN KEY (expected_card_assignment_id) REFERENCES public.card_assignment(id);

ALTER TABLE ONLY public.result_recalculation_request
    ADD CONSTRAINT result_recalculation_request_expected_class_id_fkey FOREIGN KEY (expected_class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.result_recalculation_request
    ADD CONSTRAINT result_recalculation_request_expected_latest_result_revisi_fkey FOREIGN KEY (expected_latest_result_revision_id) REFERENCES public.result_revision(id);

ALTER TABLE ONLY public.result_recalculation_request
    ADD CONSTRAINT result_recalculation_request_expected_readout_id_fkey FOREIGN KEY (expected_readout_id) REFERENCES public.card_readout(id);

ALTER TABLE ONLY public.result_recalculation_request
    ADD CONSTRAINT result_recalculation_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_approval_decision_pair_fk FOREIGN KEY (approval_decision_id, id, race_id, entry_id, revision) REFERENCES public.result_approval_decision(id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_approval_withdrawal_pair_fk FOREIGN KEY (approval_withdrawal_id, id, race_id, entry_id, revision) REFERENCES public.result_approval_withdrawal(id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_control_neutralization_fkey FOREIGN KEY (control_neutralization_id) REFERENCES public.class_control_neutralization(id);

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_course_version_id_fkey FOREIGN KEY (course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_did_not_finish_decision_pair_fk FOREIGN KEY (did_not_finish_decision_id, id, race_id, entry_id, revision) REFERENCES public.did_not_finish_decision(id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_did_not_finish_withdrawal_pair_fk FOREIGN KEY (did_not_finish_withdrawal_id, id, race_id, entry_id, revision) REFERENCES public.did_not_finish_withdrawal(id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_did_not_start_decision_fk FOREIGN KEY (did_not_start_decision_id) REFERENCES public.did_not_start_decision(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_did_not_start_decision_pair_fk FOREIGN KEY (did_not_start_decision_id, id, race_id, entry_id, revision) REFERENCES public.did_not_start_decision(id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_disqualification_decision_pair_fk FOREIGN KEY (disqualification_decision_id, id, race_id, entry_id, revision) REFERENCES public.result_disqualification_decision(id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_disqualification_withdrawal_pair_fk FOREIGN KEY (disqualification_withdrawal_id, id, race_id, entry_id, revision) REFERENCES public.result_disqualification_withdrawal(id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_manual_finish_time_correction_pair_fk FOREIGN KEY (manual_finish_time_correction_id, id, race_id, entry_id, revision) REFERENCES public.manual_finish_time_correction(request_id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_manual_finish_time_correction_withdrawal_pair_f FOREIGN KEY (manual_finish_time_correction_withdrawal_id, id, race_id, entry_id, revision) REFERENCES public.manual_finish_time_correction_withdrawal(id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_manual_punch_start_time_correction_pair_fk FOREIGN KEY (manual_punch_start_time_correction_id, id, race_id, entry_id, revision) REFERENCES public.manual_punch_start_time_correction(request_id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_not_competing_decision_pair_fk FOREIGN KEY (not_competing_decision_id, id, race_id, entry_id, revision) REFERENCES public.not_competing_decision(id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_not_competing_withdrawal_pair_fk FOREIGN KEY (not_competing_withdrawal_id, id, race_id, entry_id, revision) REFERENCES public.not_competing_withdrawal(id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_readout_id_fkey FOREIGN KEY (readout_id) REFERENCES public.card_readout(id);

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_shortened_course_class_transfer_header_fk FOREIGN KEY (shortened_course_class_transfer_id) REFERENCES public.shortened_course_class_transfer(request_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_shortened_course_class_transfer_item_fk FOREIGN KEY (shortened_course_class_transfer_id, id, race_id, entry_id, revision) REFERENCES public.shortened_course_class_transfer_item(request_id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_start_checkin_dns_decision_pair_fk FOREIGN KEY (start_checkin_dns_decision_id, id, race_id, entry_id, revision) REFERENCES public.start_checkin_dns_decision(id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_without_timing_decision_pair_fk FOREIGN KEY (without_timing_decision_id, id, race_id, entry_id, revision) REFERENCES public.without_timing_decision(id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT result_revision_without_timing_withdrawal_pair_fk FOREIGN KEY (without_timing_withdrawal_id, id, race_id, entry_id, revision) REFERENCES public.without_timing_withdrawal(id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.rogaining_change_request
    ADD CONSTRAINT rogaining_change_request_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.rogaining_change_request
    ADD CONSTRAINT rogaining_change_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.result_revision
    ADD CONSTRAINT rr_mpscw_pair_fk FOREIGN KEY (manual_punch_start_time_correction_withdrawal_id, id, race_id, entry_id, revision) REFERENCES public.manual_punch_start_time_correction_withdrawal(id, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.shortened_course_class_transfer
    ADD CONSTRAINT shortened_course_class_transfer_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.shortened_course_class_transfer_item
    ADD CONSTRAINT shortened_course_class_transfer_item_created_result_fk FOREIGN KEY (created_result_revision_id, request_id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, shortened_course_class_transfer_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.shortened_course_class_transfer_item
    ADD CONSTRAINT shortened_course_class_transfer_item_entry_scope_fk FOREIGN KEY (entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.shortened_course_class_transfer_item
    ADD CONSTRAINT shortened_course_class_transfer_item_header_scope_fk FOREIGN KEY (request_id, race_id) REFERENCES public.shortened_course_class_transfer(request_id, race_id);

ALTER TABLE ONLY public.shortened_course_class_transfer_item
    ADD CONSTRAINT shortened_course_class_transfer_item_source_readout_fk FOREIGN KEY (source_readout_id) REFERENCES public.card_readout(id);

ALTER TABLE ONLY public.shortened_course_class_transfer_item
    ADD CONSTRAINT shortened_course_class_transfer_item_source_result_fk FOREIGN KEY (source_result_revision_id, race_id, entry_id, source_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision);

ALTER TABLE ONLY public.shortened_course_class_transfer
    ADD CONSTRAINT shortened_course_class_transfer_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.shortened_course_class_transfer
    ADD CONSTRAINT shortened_course_class_transfer_short_class_scope_fk FOREIGN KEY (short_class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.shortened_course_class_transfer
    ADD CONSTRAINT shortened_course_class_transfer_short_course_scope_fk FOREIGN KEY (short_course_id, race_id) REFERENCES public.course(id, race_id);

ALTER TABLE ONLY public.shortened_course_class_transfer
    ADD CONSTRAINT shortened_course_class_transfer_short_version_course_fk FOREIGN KEY (short_course_version_id, short_course_id) REFERENCES public.course_version(id, course_id);

ALTER TABLE ONLY public.shortened_course_class_transfer
    ADD CONSTRAINT shortened_course_class_transfer_source_class_scope_fk FOREIGN KEY (source_class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.shortened_course_class_transfer
    ADD CONSTRAINT shortened_course_class_transfer_source_course_scope_fk FOREIGN KEY (source_course_id, race_id) REFERENCES public.course(id, race_id);

ALTER TABLE ONLY public.shortened_course_class_transfer
    ADD CONSTRAINT shortened_course_class_transfer_source_version_course_fk FOREIGN KEY (source_course_version_id, source_course_id) REFERENCES public.course_version(id, course_id);

ALTER TABLE ONLY public.source_snapshot
    ADD CONSTRAINT source_snapshot_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.start_checkin_conflict_review
    ADD CONSTRAINT start_checkin_conflict_review_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.start_checkin_conflict_review
    ADD CONSTRAINT start_checkin_conflict_review_entry_scope_fk FOREIGN KEY (entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.start_checkin_conflict_review_item
    ADD CONSTRAINT start_checkin_conflict_review_item_operation_source_fk FOREIGN KEY (conflict_request_id, race_id, entry_id, content_hash, operation_effect) REFERENCES public.start_checkin_operation(request_id, race_id, entry_id, content_hash, effect);

ALTER TABLE ONLY public.start_checkin_conflict_review_item
    ADD CONSTRAINT start_checkin_conflict_review_item_review_scope_fk FOREIGN KEY (review_id, race_id, entry_id) REFERENCES public.start_checkin_conflict_review(id, race_id, entry_id);

ALTER TABLE ONLY public.start_checkin_device
    ADD CONSTRAINT start_checkin_device_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.start_checkin_device
    ADD CONSTRAINT start_checkin_device_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.start_checkin_dns_decision
    ADD CONSTRAINT start_checkin_dns_decision_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.start_checkin_dns_decision
    ADD CONSTRAINT start_checkin_dns_decision_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.start_checkin_dns_decision
    ADD CONSTRAINT start_checkin_dns_decision_class_scope_fk FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.start_checkin_dns_decision
    ADD CONSTRAINT start_checkin_dns_decision_course_version_id_fkey FOREIGN KEY (course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.start_checkin_dns_decision
    ADD CONSTRAINT start_checkin_dns_decision_entry_scope_fk FOREIGN KEY (entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.start_checkin_dns_decision
    ADD CONSTRAINT start_checkin_dns_decision_operation_revision_fk FOREIGN KEY (start_checkin_revision_id, operation_request_id, race_id, entry_id, operational_revision) REFERENCES public.start_checkin_revision(id, request_id, race_id, entry_id, revision);

ALTER TABLE ONLY public.start_checkin_dns_decision
    ADD CONSTRAINT start_checkin_dns_decision_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.start_checkin_dns_decision
    ADD CONSTRAINT start_checkin_dns_decision_result_pair_fk FOREIGN KEY (created_result_revision_id, id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, start_checkin_dns_decision_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.start_checkin_dns_withdrawal
    ADD CONSTRAINT start_checkin_dns_withdrawal_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.start_checkin_dns_withdrawal
    ADD CONSTRAINT start_checkin_dns_withdrawal_entry_scope_fk FOREIGN KEY (entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.start_checkin_dns_withdrawal
    ADD CONSTRAINT start_checkin_dns_withdrawal_operation_revision_fk FOREIGN KEY (start_checkin_revision_id, operation_request_id, race_id, entry_id, operational_revision) REFERENCES public.start_checkin_revision(id, request_id, race_id, entry_id, revision);

ALTER TABLE ONLY public.start_checkin_dns_withdrawal
    ADD CONSTRAINT start_checkin_dns_withdrawal_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.start_checkin_dns_withdrawal
    ADD CONSTRAINT start_checkin_dns_withdrawal_target_fk FOREIGN KEY (start_checkin_dns_decision_id, withdrawn_result_revision_id, race_id, entry_id, withdrawn_result_revision) REFERENCES public.start_checkin_dns_decision(id, created_result_revision_id, race_id, entry_id, created_result_revision);

ALTER TABLE ONLY public.start_checkin_operation
    ADD CONSTRAINT start_checkin_operation_created_revision_fk FOREIGN KEY (created_revision_id, request_id, race_id, entry_id, resulting_revision) REFERENCES public.start_checkin_revision(id, request_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.start_checkin_operation
    ADD CONSTRAINT start_checkin_operation_device_scope_fk FOREIGN KEY (device_id, race_id, actor_credential_id) REFERENCES public.start_checkin_device(id, race_id, actor_credential_id);

ALTER TABLE ONLY public.start_checkin_operation
    ADD CONSTRAINT start_checkin_operation_entry_scope_fk FOREIGN KEY (entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.start_checkin_revision
    ADD CONSTRAINT start_checkin_revision_operation_fk FOREIGN KEY (request_id, race_id, entry_id, operation_effect, revision) REFERENCES public.start_checkin_operation(request_id, race_id, entry_id, effect, resulting_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.start_draw_class
    ADD CONSTRAINT start_draw_class_class_fk FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.start_draw_class
    ADD CONSTRAINT start_draw_class_draw_fk FOREIGN KEY (draw_id, race_id) REFERENCES public.start_draw_request(id, race_id);

ALTER TABLE ONLY public.start_draw_request
    ADD CONSTRAINT start_draw_request_actor_scope_fk FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.start_draw_request
    ADD CONSTRAINT start_draw_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.start_draw_slot
    ADD CONSTRAINT start_draw_slot_class_fk FOREIGN KEY (draw_id, class_id) REFERENCES public.start_draw_class(draw_id, class_id);

ALTER TABLE ONLY public.start_draw_slot
    ADD CONSTRAINT start_draw_slot_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.start_list_publication
    ADD CONSTRAINT start_list_publication_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.start_list_publication
    ADD CONSTRAINT start_list_publication_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.team
    ADD CONSTRAINT team_class_fk FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.team
    ADD CONSTRAINT team_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.unknown_readout_resolution
    ADD CONSTRAINT unknown_readout_resolution_actor_credential_id_race_id_cap_fkey FOREIGN KEY (actor_credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.unknown_readout_resolution
    ADD CONSTRAINT unknown_readout_resolution_assignment_id_race_id_entry_id__fkey FOREIGN KEY (assignment_id, race_id, entry_id, card_number) REFERENCES public.card_assignment(id, race_id, entry_id, card_number);

ALTER TABLE ONLY public.unknown_readout_resolution
    ADD CONSTRAINT unknown_readout_resolution_class_id_race_id_fkey FOREIGN KEY (class_id, race_id) REFERENCES public.class(id, race_id);

ALTER TABLE ONLY public.unknown_readout_resolution
    ADD CONSTRAINT unknown_readout_resolution_created_result_revision_id_race_fkey FOREIGN KEY (created_result_revision_id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision);

ALTER TABLE ONLY public.unknown_readout_resolution
    ADD CONSTRAINT unknown_readout_resolution_entry_id_race_id_fkey FOREIGN KEY (entry_id, race_id) REFERENCES public.entry(id, race_id);

ALTER TABLE ONLY public.unknown_readout_resolution
    ADD CONSTRAINT unknown_readout_resolution_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.unknown_readout_resolution
    ADD CONSTRAINT unknown_readout_resolution_readout_id_race_id_raw_message__fkey FOREIGN KEY (readout_id, race_id, raw_message_id, card_number) REFERENCES public.card_readout(id, race_id, raw_message_id, card_number);

ALTER TABLE ONLY public.user_account_auth_guard
    ADD CONSTRAINT user_account_auth_guard_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.user_account(id);

ALTER TABLE ONLY public.user_account_event_creation_request
    ADD CONSTRAINT user_account_event_creation_race_event_fk FOREIGN KEY (race_id, event_id) REFERENCES public.race(id, event_id);

ALTER TABLE ONLY public.user_account_event_creation_request
    ADD CONSTRAINT user_account_event_creation_request_actor_account_id_fkey FOREIGN KEY (actor_account_id) REFERENCES public.user_account(id);

ALTER TABLE ONLY public.user_account_event_creation_request
    ADD CONSTRAINT user_account_event_creation_request_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.event(id);

ALTER TABLE ONLY public.user_account_event_creation_request
    ADD CONSTRAINT user_account_event_creation_request_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.user_account_password_verifier
    ADD CONSTRAINT user_account_password_verifier_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.user_account(id);

ALTER TABLE ONLY public.user_account_race_delegation
    ADD CONSTRAINT user_account_race_delegation_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.user_account(id);

ALTER TABLE ONLY public.user_account_race_delegation
    ADD CONSTRAINT user_account_race_delegation_account_session_id_fkey FOREIGN KEY (account_session_id) REFERENCES public.user_account_session(id);

ALTER TABLE ONLY public.user_account_race_delegation
    ADD CONSTRAINT user_account_race_delegation_credential_id_fkey FOREIGN KEY (credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.user_account_race_delegation
    ADD CONSTRAINT user_account_race_delegation_credential_scope_fk FOREIGN KEY (credential_id, race_id, capability) REFERENCES public.pairing_admin_access_credential(id, race_id, capability);

ALTER TABLE ONLY public.user_account_race_delegation
    ADD CONSTRAINT user_account_race_delegation_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.event(id);

ALTER TABLE ONLY public.user_account_race_delegation
    ADD CONSTRAINT user_account_race_delegation_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES public.event_administration_grant(id);

ALTER TABLE ONLY public.user_account_race_delegation
    ADD CONSTRAINT user_account_race_delegation_grant_scope_fk FOREIGN KEY (grant_id, account_id, event_id) REFERENCES public.event_administration_grant(id, account_id, event_id);

ALTER TABLE ONLY public.user_account_race_delegation
    ADD CONSTRAINT user_account_race_delegation_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.user_account_race_delegation
    ADD CONSTRAINT user_account_race_delegation_race_scope_fk FOREIGN KEY (race_id, event_id) REFERENCES public.race(id, event_id);

ALTER TABLE ONLY public.user_account_race_delegation
    ADD CONSTRAINT user_account_race_delegation_session_scope_fk FOREIGN KEY (account_session_id, account_id) REFERENCES public.user_account_session(id, account_id);

ALTER TABLE ONLY public.user_account_session
    ADD CONSTRAINT user_account_session_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.user_account(id);

ALTER TABLE ONLY public.user_account_session_revocation
    ADD CONSTRAINT user_account_session_revocation_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.user_account_session(id);

ALTER TABLE ONLY public.user_account_session
    ADD CONSTRAINT user_account_session_verifier_fk FOREIGN KEY (account_id, password_version) REFERENCES public.user_account_password_verifier(account_id, version);

ALTER TABLE ONLY public.without_timing_decision
    ADD CONSTRAINT without_timing_decision_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.without_timing_decision
    ADD CONSTRAINT without_timing_decision_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.without_timing_decision
    ADD CONSTRAINT without_timing_decision_expected_class_id_fkey FOREIGN KEY (expected_class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.without_timing_decision
    ADD CONSTRAINT without_timing_decision_expected_course_version_id_fkey FOREIGN KEY (expected_course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.without_timing_decision
    ADD CONSTRAINT without_timing_decision_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.without_timing_decision
    ADD CONSTRAINT without_timing_decision_result_pair_fk FOREIGN KEY (created_result_revision_id, id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, without_timing_decision_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.without_timing_decision
    ADD CONSTRAINT without_timing_decision_target_fk FOREIGN KEY (target_result_revision_id, race_id, entry_id, target_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.without_timing_withdrawal
    ADD CONSTRAINT without_timing_withdrawal_actor_credential_id_fkey FOREIGN KEY (actor_credential_id) REFERENCES public.pairing_admin_access_credential(id);

ALTER TABLE ONLY public.without_timing_withdrawal
    ADD CONSTRAINT without_timing_withdrawal_decision_fk FOREIGN KEY (without_timing_decision_id, target_result_revision_id, target_result_revision, withdrawn_result_revision_id, race_id, entry_id, withdrawn_result_revision) REFERENCES public.without_timing_decision(id, target_result_revision_id, target_result_revision, created_result_revision_id, race_id, entry_id, created_result_revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.without_timing_withdrawal
    ADD CONSTRAINT without_timing_withdrawal_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entry(id);

ALTER TABLE ONLY public.without_timing_withdrawal
    ADD CONSTRAINT without_timing_withdrawal_expected_class_id_fkey FOREIGN KEY (expected_class_id) REFERENCES public.class(id);

ALTER TABLE ONLY public.without_timing_withdrawal
    ADD CONSTRAINT without_timing_withdrawal_expected_course_version_id_fkey FOREIGN KEY (expected_course_version_id) REFERENCES public.course_version(id);

ALTER TABLE ONLY public.without_timing_withdrawal
    ADD CONSTRAINT without_timing_withdrawal_latest_result_fk FOREIGN KEY (expected_latest_result_revision_id, race_id, entry_id, expected_latest_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.without_timing_withdrawal
    ADD CONSTRAINT without_timing_withdrawal_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.race(id);

ALTER TABLE ONLY public.without_timing_withdrawal
    ADD CONSTRAINT without_timing_withdrawal_restored_from_fk FOREIGN KEY (restored_from_result_revision_id, race_id, entry_id, restored_from_result_revision) REFERENCES public.result_revision(id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY public.without_timing_withdrawal
    ADD CONSTRAINT without_timing_withdrawal_result_pair_fk FOREIGN KEY (created_result_revision_id, id, race_id, entry_id, created_result_revision) REFERENCES public.result_revision(id, without_timing_withdrawal_id, race_id, entry_id, revision) DEFERRABLE INITIALLY DEFERRED;
