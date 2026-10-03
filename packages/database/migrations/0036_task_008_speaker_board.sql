ALTER TYPE pairing_admin_capability ADD VALUE IF NOT EXISTS 'VIEW_SPEAKER_BOARD';

ALTER TABLE pairing_admin_access_credential ADD CONSTRAINT pairing_admin_speaker_board_lifetime_check
CHECK (capability::text <> 'VIEW_SPEAKER_BOARD' OR expires_at <= issued_at + interval '8 hours');
