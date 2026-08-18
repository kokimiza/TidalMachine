#!/bin/bash
# Entry point for `ws.runtime.exec()` (see src/lib/server/tidal-agent.ts).
# Runs as root (computerd's default exec context) so it's the only thing
# that ever touches the FUSE-mounted /workspace tree; the actual audio
# engine runs entirely under /tmp as the unprivileged `render` user via
# render-inner.sh, which sclang requires (see Dockerfile comment).
#
# Usage: render.sh <job-dir-under-workspace> <duration-seconds>
set -uo pipefail

JOB_DIR="${1:?usage: render.sh <job-dir> <duration-seconds>}"
DURATION="${2:?usage: render.sh <job-dir> <duration-seconds>}"

if [ ! -f "$JOB_DIR/Main.hs" ]; then
  echo "render.sh: $JOB_DIR/Main.hs not found" >&2
  exit 2
fi

rm -f /tmp/render-stop /tmp/render-out.wav /tmp/render.log
cp "$JOB_DIR/Main.hs" /opt/tidal-runner/Main.hs
chown render:render /opt/tidal-runner/Main.hs

su - render -c "bash /opt/render-inner.sh '$DURATION'"
STATUS=$?

[ -f /tmp/render-out.wav ] && cp /tmp/render-out.wav "$JOB_DIR/out.wav"
[ -f /tmp/render.log ] && cp /tmp/render.log "$JOB_DIR/render.log"

exit $STATUS
