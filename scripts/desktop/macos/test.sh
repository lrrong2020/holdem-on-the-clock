#!/bin/bash
set -euo pipefail
if [[ $# != 1 ]]; then echo 'Usage: test.sh IMAGE.dmg' >&2; exit 2; fi
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/holdem.install.XXXXXX")"
mount="$test_dir/disk"
mounted=false
cleanup() {
  if [[ "$mounted" == true ]]; then hdiutil detach "$mount" -quiet || return; fi
  rm -rf "$test_dir"
}
trap cleanup EXIT
mkdir "$mount"
hdiutil attach "$1" -readonly -nobrowse -mountpoint "$mount" -quiet
mounted=true
app="$test_dir/Installed Apps/Holdem on the Clock.app"
mkdir -p "$(dirname "$app")"
ditto "$mount/Holdem on the Clock.app" "$app"
hdiutil detach "$mount" -quiet
mounted=false
codesign --verify --deep --strict "$app"
payload="$app/Contents/Resources/runtime"
PORT=0 node "$repo/scripts/desktop/smoke.mjs" "$payload"
# Use the real app launcher with a hidden UI, including the normal quit path.
python3 - "$app/Contents/MacOS/HoldemClock" <<'PY'
import os
import socket
import subprocess
import sys
from urllib.parse import urlparse

env = dict(os.environ, PORT="0")
run = subprocess.run([sys.argv[1], "--verify-launch"], env=env, capture_output=True,
                     text=True, timeout=70, check=False)
print(run.stderr, file=sys.stderr, end="")
print(run.stdout, end="")
if run.returncode:
    sys.exit(run.returncode)
line = next((s for s in run.stdout.splitlines() if s.startswith("MAC_APP_READY ")), None)
if not line:
    sys.exit("App did not pass its startup check")
url = urlparse(line.split(" ", 1)[1])
with socket.socket() as sock:
    sock.settimeout(1)
    if sock.connect_ex((url.hostname, url.port)) == 0:
        sys.exit("Server is still running after Quit")
PY
