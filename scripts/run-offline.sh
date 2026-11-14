#!/usr/bin/env bash
set -euo pipefail

# Optional network-isolated runner wrapper (Spike S3, ubuntu-latest only).
# Brings up only loopback inside a new network namespace so localhost test fixtures
# work while outbound sockets fail with ENETUNREACH/EAI_AGAIN.
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "unit-agent: unshare strategy is supported on Linux only" >&2
  exit 125
fi

if ! command -v unshare >/dev/null 2>&1; then
  echo "unit-agent: unshare binary not found" >&2
  exit 125
fi

# Probe userns + netns support first (Ubuntu 24.04 AppArmor may restrict unprivileged userns).
if ! unshare --map-root-user --net -- true >/dev/null 2>&1; then
  echo "unit-agent: unshare self-test failed (user namespaces restricted or unsupported)" >&2
  exit 125
fi

exec unshare --map-root-user --net -- sh -c 'ip link set lo up 2>/dev/null || true; exec "$@"' -- "$@"

