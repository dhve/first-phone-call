# Device Agent — demo app

A chat assistant whose LLM runs **entirely on-device** (via
[llama.rn](https://github.com/mybigday/llama.rn)) and can call tools mid-
conversation, powered by the local
[`react-native-device-agent`](../packages/react-native-device-agent) package.

This is an Expo app that needs a **custom dev build** (llama.rn is native — it
won't run in Expo Go).

## Run it

From the monorepo root, install once:

```sh
npm install
```

Then build & launch (native dirs are already generated via `expo prebuild`):

```sh
# iOS (simulator or device)
npm run ios          # = npx expo run:ios   from example/

# Android (emulator or device)
npm run android
```

On first launch, tap **Download & load model** — it pulls a ~1.1 GB GGUF
(Qwen2.5-1.5B-Instruct) into the app sandbox, then runs offline. Change the
model in [`src/config.ts`](src/config.ts).

## Try these

- “Copy ‘hello world’ to my clipboard, then read it back.”
- “What time is it, and remind me in 30 seconds to stretch.”
- “Save a note called todo.txt with three ideas, then list my files.”

Tool calls and their results render inline so you can watch the agent loop.

## Notes

- **Node**: RN 0.85/Expo 56 want Node 20.19+/22.13+/24.3+. You're on Node 23,
  which works here but is unsupported upstream — consider switching if you hit
  odd build/Metro errors.
- Regenerating native projects: `npx expo prebuild --clean` (then `pod install`
  via `npx pod-install`). Permissions, iOS 16.4 target, and the llama.rn
  ProGuard rule all come from [`app.json`](app.json), so they survive prebuilds.
- This is a monorepo: [`metro.config.js`](metro.config.js) lets Metro resolve
  the local package and hoisted deps.
