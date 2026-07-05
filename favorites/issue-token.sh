#!/usr/bin/env bash
# Issue, map, or revoke a favorites sync token for a user.
#
#   ./issue-token.sh <userId>              generate a new token, print it once,
#                                          and store its hash in KV
#   ./issue-token.sh <userId> --existing   read a token from stdin (silent) and
#                                          map it — for migrating a token that
#                                          is already on devices
#   ./issue-token.sh --revoke              read a token from stdin (silent) and
#                                          delete its KV mapping
#
# Run from favorites/ so wrangler picks up wrangler.toml. The plaintext token
# is shown only to whoever runs this — it is never stored server-side.
set -euo pipefail

NAMESPACE_ID="71257de3aef04824ad72e7597d0ed8ac"

hash_token() {
  printf %s "$1" | openssl dgst -sha256 -hex | awk '{print $NF}'
}

read_token_silent() {
  read -r -s -p "Paste token: " TOKEN
  echo >&2
  TOKEN="$(printf %s "$TOKEN" | tr -d '[:space:]')"
  [ -n "$TOKEN" ] || { echo "error: empty token" >&2; exit 1; }
}

if [ "${1:-}" = "--revoke" ]; then
  read_token_silent
  wrangler kv key delete "token:$(hash_token "$TOKEN")" --namespace-id "$NAMESPACE_ID" --remote
  echo "Token revoked. The user's state:<userId> document is untouched."
  exit 0
fi

USER_ID="${1:-}"
case "$USER_ID" in
  ""|--*) echo "usage: $0 <userId> [--existing] | $0 --revoke" >&2; exit 1 ;;
esac
if ! printf %s "$USER_ID" | grep -Eq '^[a-z0-9_-]{1,32}$'; then
  echo "error: userId must match ^[a-z0-9_-]{1,32}\$ (it becomes a KV key)" >&2
  exit 1
fi

if [ "${2:-}" = "--existing" ]; then
  read_token_silent
else
  TOKEN="$(openssl rand -base64 32)"
fi

wrangler kv key put "token:$(hash_token "$TOKEN")" "$USER_ID" --namespace-id "$NAMESPACE_ID" --remote

if [ "${2:-}" = "--existing" ]; then
  echo "Existing token mapped to user '$USER_ID'."
else
  echo "Token for user '$USER_ID' (copy it now — it is not stored anywhere):"
  echo "$TOKEN"
fi
