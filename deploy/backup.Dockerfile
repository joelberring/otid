# Backup och hälsokontroll (ADR-0186): samma PostgreSQL som databasen (pg_dump/pg_restore i rätt huvudversion) plus restic
# för den krypterade kopian utanför servern, curl för bevakningens pingar och ssh för en Storage Box (sftp).
# ADR-0195: byggs av GitHub Actions (ghcr.io/joelberring/otid-backup, .github/workflows/images.yml); på servern bara i reserven
# `docker compose -f docker-compose.prod.yml build` (tjänsten backup-before-migrate, docs/drift.md).
FROM postgres:17.11-trixie
RUN apt-get update \
  && apt-get install -y --no-install-recommends restic curl ca-certificates openssh-client \
  && rm -rf /var/lib/apt/lists/*
