# Host39 Agent - phone hosting app

The Host39 phone agent: hosts your personal A2A agent card on the device. A
local LLM (Qwen2.5-1.5B-Instruct Q4_K_M via [llama.rn](https://github.com/mybigday/llama.rn))
answers `message/send` requests that arrive over the Host39 relay, using only
a small, explicitly registered tool set scoped to an on-device knowledge
folder.

This is an Expo app that needs a **custom dev build** (llama.rn and the local
`host39-native` module are native; it won't run in Expo Go). Android is the
primary target.

## What's inside

- `src/hosting/hostingService.ts` - the controller: one shared engine while
  hosting is on, a mutex so exactly one completion runs at a time, request
  gating (offline / busy / thermal / low battery / model not loaded), and a
  fresh `Agent` per request (`maxSteps` 4, temperature 0.3, capped output).
- `src/relay/envelope.ts` - typed relay envelopes (hello/ready, ping/pong,
  request/response/error), mirroring the server's protocol in `server/src`.
- `modules/host39-native` - local Expo module (Kotlin): Android Keystore
  ES256 signing, streaming SHA-256, device health, and the foreground service
  that owns the relay WebSocket (START_STICKY, exponential backoff, heartbeat
  pongs, single-use tokens requested from JS).
- `src/screens` - sign in, card editor, hosting toggle + status panel
  (model / card / signed publication / relay / NANDA / public resolution).

Model downloads are verified against the official SHA-256 (hardcoded in
[`src/config.ts`](src/config.ts) from the Hugging Face API) and deleted on
mismatch. Tokens live in `expo-secure-store`; cards, settings, knowledge
files, and the outcome-only audit log live under the document directory.

## Run it

From the monorepo root, install once:

```sh
npm install
```

Then build & launch on Android (regenerates native dirs on first run):

```sh
npm run android
```

Sign in against a running Host39 server (default `http://10.0.2.2:3000`
reaches your machine from the emulator; override on the sign-in screen),
create a card, download the model, register the device key, then flip the
hosting toggle.

## Notes

- **Node**: RN 0.85/Expo 56 want Node 20.19+/22.13+/24.3+.
- Regenerating native projects: `npx expo prebuild --clean`. Permissions and
  the foreground service come from `app.json` plus the local module's
  manifest, so they survive prebuilds.
- This is a monorepo: [`metro.config.js`](metro.config.js) lets Metro resolve
  the local package and hoisted deps.
