-- Ägaren 2026-11-15 (ADR-0209 tillägg 2026-11-15): en klubbledare som är administratör för en träning via arrangörsklubben får
-- en auditpost första gången hen ändrar något i en inloggning. Uppslaget före posten går på det här delindexet, som bara har
-- de raderna (audit_event har inget index på tävlingen). Bara tillägg; byggs CONCURRENTLY utanför transaktionen.
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_event_club_leader_idx ON audit_event (race_id, actor_id)
  WHERE action = 'RACE_ADMIN_VIA_CLUB_LEADER';
