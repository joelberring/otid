# Backup och hälsokontroll (ADR-0185): samma PostgreSQL som databasen (pg_dump/pg_restore i rätt huvudversion) plus restic
# för den krypterade kopian utanför servern, curl för bevakningens pingar och ssh för en Storage Box (sftp).
# Byggs av `docker compose -f docker-compose.prod.yml build` (tjänsten backup-before-migrate).
FROM postgres:17.11-trixie
RUN apt-get update \
  && apt-get install -y --no-install-recommends restic curl ca-certificates openssh-client \
  && rm -rf /var/lib/apt/lists/*
