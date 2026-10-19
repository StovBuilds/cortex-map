#!/usr/bin/env bash
# Makes e2e/fixtures/voice-session.wav: spoken commands with gaps, for the
# voice e2e block (Chromium plays it as a fake microphone). Uses Piper, a free
# open-source text-to-speech, in a throwaway venv. Not committed (voice model
# licences vary); run this once locally before `run.mjs voice`.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="${TMPDIR:-/tmp}/cg-piper"
mkdir -p "$work" "$here/fixtures"
[ -x "$work/venv/bin/piper" ] || { python3 -m venv "$work/venv"; "$work/venv/bin/pip" install -q piper-tts; }
voice="$work/en_GB-alan-medium.onnx"
for f in en_GB-alan-medium.onnx en_GB-alan-medium.onnx.json; do
  [ -s "$work/$f" ] || curl -4 -sSL -o "$work/$f" "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/$f"
done
i=0
for line in "Fly to engine pipeline." "I really like this map." "Spread the tools cluster." "Reset."; do
  i=$((i+1)); echo "$line" | "$work/venv/bin/piper" -m "$voice" -f "$work/cmd$i.wav" 2>/dev/null
done
python3 - "$work" "$here/fixtures/voice-session.wav" <<'PY'
import sys, wave
work, dest = sys.argv[1], sys.argv[2]
out = wave.open(dest, "wb"); out.setnchannels(1); out.setsampwidth(2); out.setframerate(22050)
sil = lambda s: b"\x00\x00" * int(22050 * s)
out.writeframes(sil(2.0))
for i in range(1, 5):
    w = wave.open(f"{work}/cmd{i}.wav"); out.writeframes(w.readframes(w.getnframes())); out.writeframes(sil(4.0))
out.writeframes(sil(30)); out.close()
print("wrote", dest)
PY
