-- ADR-0189 beslut 7–9: små säkerhetsfynd. Bara tillägg.
--
-- Träningsgruppens ledare och medlemmar sparas för e-postadressen (som ADR-0188 beslut 6 för tävlingens behörigheter), så
-- att svaret aldrig avslöjar om adressen har ett konto. Inbjudan blir ett medlemskap när ett konto med adressen och
-- bekräftad e-post loggar in, bekräftar adressen eller öppnar Mina tävlingar eller gruppens sida.
CREATE TABLE IF NOT EXISTS training_group_invitation (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  group_id uuid NOT NULL REFERENCES training_group (id),
  email text NOT NULL,
  role text NOT NULL,
  actor_account_id uuid NOT NULL REFERENCES user_account (id),
  created_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_account_id uuid REFERENCES user_account (id),
  revoked_at timestamptz,
  CONSTRAINT training_group_invitation_request_uidx UNIQUE (request_id),
  CONSTRAINT training_group_invitation_email_check CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  CONSTRAINT training_group_invitation_role_check CHECK (role IN ('LEADER', 'MEMBER')),
  CONSTRAINT training_group_invitation_state_check CHECK (NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL)
    AND ((accepted_at IS NULL) = (accepted_account_id IS NULL)))
);
-- Ny och tom tabell: indexen byggs i samma transaktion utan långa lås.
CREATE INDEX IF NOT EXISTS training_group_invitation_open_email_idx ON training_group_invitation (email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS training_group_invitation_group_idx ON training_group_invitation (group_id, created_at);

-- Spärren räknar också missade gruppkoder per IP-adress (gruppsidan /g/<kod>).
ALTER TABLE account_request_throttle DROP CONSTRAINT IF EXISTS account_request_throttle_scope_check;
ALTER TABLE account_request_throttle ADD CONSTRAINT account_request_throttle_scope_check CHECK (scope IN ('REGISTER_IP', 'RESET_IP',
  'RESET_EMAIL', 'SELF_REGISTRATION_IP', 'SELF_REGISTRATION_RACE', 'VERIFY_EMAIL', 'GROUP_CODE_IP'));
