#!/usr/bin/env bash
# Pre-demo check. Run this before you present, not during.
#
#   ./smoke.sh              relay on localhost
#   RELAY=http://10.198.223.53:8787 ./smoke.sh
#
# Exits non-zero on the first failure, so you know to stop and look.

set -u
RELAY="${RELAY:-http://localhost:8787}"
fail() { echo "  ✗ $1"; exit 1; }
ok()   { echo "  ✓ $1"; }

echo "relay: $RELAY"
echo

echo "1. relay alive"
[ "$(curl -s -m 3 "$RELAY/health")" = '{"ok":true}' ] || fail "no /health — is the relay running?"
ok "health"

echo "2. agent card"
curl -s -m 3 "$RELAY/agent-card" | grep -q '"skills"' || fail "card missing skills"
ok "card serves skills"

echo "3. both phones registered"
# A phone shows up here only once its model is loaded and it is polling.
lanes=$(curl -s -m 3 "$RELAY/log" \
  | tr ',' '\n' | grep -c 'AGENT REGISTERED' || true)
if [ "$lanes" -lt 2 ]; then
  echo "  ! only $lanes registration(s) in the log."
  echo "    Both apps must be open, foregrounded, and past model load."
fi

echo "4. live call to each lane (this runs real on-device inference)"
for lane in a b; do
  start=$SECONDS
  body=$(curl -s -m 90 -X POST "$RELAY/run" \
    -H 'Content-Type: application/json' \
    -d "{\"message\":\"Say READY and nothing else.\",\"from\":\"smoke\",\"to\":\"$lane\"}")
  took=$((SECONDS - start))
  case "$body" in
    *'"reply"'*) ok "lane $lane answered in ${took}s — $body" ;;
    *) fail "lane $lane did not answer (${took}s): ${body:-no response}" ;;
  esac
done

echo
echo "All green. Both phones are listening and answering."

# --- audio call smoke: one synthesized turn, end to end -----------------------
echo
echo "TTS turn (writes /tmp/smoke-turn.wav; play it to hear lane A's voice):"
curl -s "$BASE/tts?text=Smoke%20test%3A%20this%20is%20the%20relay%20speaking&lane=a" \
  -o /tmp/smoke-turn.wav && file /tmp/smoke-turn.wav
