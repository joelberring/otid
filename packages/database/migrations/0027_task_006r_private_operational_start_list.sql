ALTER TYPE pairing_admin_capability ADD VALUE IF NOT EXISTS 'VIEW_START_LIST';
ALTER TABLE pairing_admin_access_credential ADD CONSTRAINT pairing_admin_start_list_lifetime_check
CHECK (capability::text <> 'VIEW_START_LIST' OR expires_at <= issued_at + interval '8 hours');
