#!/bin/bash
# Runs as the unprivileged `render` user (invoked via `su - render` from
# render.sh). Boots SuperCollider + SuperDirt against a dummy JACK sink,
# builds and runs the job's Main.hs against the pre-built `tidal` package,
# and records whatever SuperDirt plays to a WAV file.
set -uo pipefail

DURATION="${1:?usage: render-inner.sh <duration-seconds>}"
LOG=/tmp/render.log
OUT_WAV=/tmp/render-out.wav
STOP_FILE=/tmp/render-stop
BOOT_LOG=/tmp/boot.log
SAFETY_SECONDS=$((DURATION + 30))

: > "$LOG"
log() { echo "$*" | tee -a "$LOG"; }

export HOME=/home/render
export PATH=/home/render/.ghcup/bin:/home/render/.cabal/bin:$PATH
export QT_QPA_PLATFORM=offscreen
export XDG_RUNTIME_DIR=/tmp/runtime-render
mkdir -p "$XDG_RUNTIME_DIR"
rm -f "$STOP_FILE" "$OUT_WAV" "$BOOT_LOG"

log "[render] starting jackd (dummy driver)"
pkill -9 jackd >/dev/null 2>&1
jackd -r -d dummy -r 44100 -p 512 > /tmp/jackd.log 2>&1 &
sleep 2

log "[render] writing boot.scd"
cat > /tmp/boot.scd <<SCD
(
s.options.numBuffers = 1024 * 16;
s.options.memSize = 8192 * 32;
s.options.maxNodes = 1024 * 8;
s.options.numOutputBusChannels = 2;
s.options.numInputBusChannels = 2;
s.waitForBoot({
	~dirt = SuperDirt(2, s);
	~dirt.loadSoundFiles;
	s.sync;
	~dirt.start(57120, [0, 0]);
	"DIRT_READY".postln;
	s.recSampleFormat = \int16;
	s.recHeaderFormat = "wav";
	s.record(path: "$OUT_WAV", numChannels: 2);
	SystemClock.sched(0, {
		if (File.exists("$STOP_FILE")) {
			s.stopRecording;
			"RECORDING_STOPPED".postln;
			SystemClock.sched(1, { 0.exit; });
			nil;
		} {
			1;
		};
	});
	SystemClock.sched($SAFETY_SECONDS, {
		if (File.exists("$STOP_FILE").not) {
			"SAFETY_TIMEOUT".postln;
			File.use("$STOP_FILE", "w", { |f| f.write("timeout") });
		};
		nil;
	});
});
)
SCD

log "[render] booting sclang + SuperDirt"
timeout "$SAFETY_SECONDS" sclang /tmp/boot.scd > "$BOOT_LOG" 2>&1 &
SCLANG_PID=$!

READY=0
for _ in $(seq 1 150); do
  if grep -q "DIRT_READY" "$BOOT_LOG" 2>/dev/null; then
    READY=1
    break
  fi
  if ! kill -0 "$SCLANG_PID" 2>/dev/null; then
    break
  fi
  sleep 0.2
done

cat "$BOOT_LOG" >> "$LOG"

if [ "$READY" -ne 1 ]; then
  log "[render] SuperDirt never became ready"
  kill -9 "$SCLANG_PID" >/dev/null 2>&1
  exit 3
fi

log "[render] building job pattern (cabal build)"
cd /opt/tidal-runner
if ! cabal build >> "$LOG" 2>&1; then
  log "[render] cabal build failed"
  touch "$STOP_FILE"
  wait "$SCLANG_PID"
  exit 4
fi

BIN=$(find dist-newstyle -type f -name tidal-runner -perm -u+x | head -n1)
if [ -z "$BIN" ]; then
  log "[render] could not find built tidal-runner binary"
  touch "$STOP_FILE"
  wait "$SCLANG_PID"
  exit 5
fi

log "[render] running pattern for ${DURATION}s"
if ! timeout "$SAFETY_SECONDS" "$BIN" >> "$LOG" 2>&1; then
  log "[render] tidal-runner exited non-zero"
  touch "$STOP_FILE"
  wait "$SCLANG_PID"
  exit 6
fi

# Main.hs writes the stop file itself after its hush + settle delay; this
# is just a backstop in case it didn't.
touch "$STOP_FILE"
wait "$SCLANG_PID"
cat "$BOOT_LOG" >> "$LOG"

if [ ! -s "$OUT_WAV" ]; then
  log "[render] no output WAV produced"
  exit 7
fi

log "[render] done: $(ls -la "$OUT_WAV")"
exit 0
