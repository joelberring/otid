#!/bin/sh
# This example launcher must only run from an inventoried, systemd-owned unit.
set +x
set -eu

if [ "$#" -eq 0 ]; then
  echo "OTID_WRITER_COMMAND_MISSING" >&2
  exit 78
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
node "$script_dir/check-writer-start.mjs"

if [ -z "${CREDENTIALS_DIRECTORY:-}" ] || [ ! -d "$CREDENTIALS_DIRECTORY" ]; then
  echo "OTID_WRITER_CREDENTIALS_MISSING" >&2
  exit 78
fi

load_credential() {
  variable=$1
  name=$2
  file="$CREDENTIALS_DIRECTORY/$name"
  if [ ! -r "$file" ]; then
    echo "OTID_WRITER_CREDENTIALS_MISSING" >&2
    exit 78
  fi
  value=$(cat -- "$file")
  if [ -z "$value" ]; then
    echo "OTID_WRITER_CREDENTIALS_EMPTY" >&2
    exit 78
  fi
  export "$variable=$value"
}

load_optional_credential() {
  variable=$1
  name=$2
  file="$CREDENTIALS_DIRECTORY/$name"
  unset "$variable"
  if [ -e "$file" ] || [ -L "$file" ]; then
    load_credential "$variable" "$name"
  fi
}

unset DATABASE_URL
load_credential DATABASE_URL database-url
load_optional_credential OTID_MAP_STORE_ACCESS_KEY map-store-access-key
load_optional_credential OTID_MAP_STORE_SECRET_KEY map-store-secret-key
load_optional_credential OTID_ROUTE_STORE_ACCESS_KEY route-store-access-key
load_optional_credential OTID_ROUTE_STORE_SECRET_KEY route-store-secret-key
load_optional_credential OTID_EVENTOR_MASTER_KEY_ID eventor-master-key-id
load_optional_credential OTID_EVENTOR_MASTER_KEY_BASE64 eventor-master-key-base64
load_optional_credential O_TID_PACKAGE_SIGNING_PRIVATE_KEY_PEM package-signing-private-key-pem

# Close the small gap between credential loading and replacing the shell.
node "$script_dir/check-writer-start.mjs"
exec "$@"
