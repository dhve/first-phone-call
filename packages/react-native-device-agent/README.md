# react-native-device-agent

On-device LLM **agent harness** for React Native. Register plain JavaScript
functions as tools and let a locally-running [llama.rn](https://github.com/mybigday/llama.rn)
model call them: fully offline, no API keys.

```ts
import {
  Agent,
  LlamaEngine,
  ToolRegistry,
  defineTool,
  createBuiltinTools,
} from 'react-native-device-agent';

// 1. Load a GGUF model on-device.
const engine = await LlamaEngine.load({ model: 'file:///path/to/model.gguf' });

// 2. Register tools: built-ins plus your own.
const registry = new ToolRegistry([
  ...createBuiltinTools({ network: {}, clipboard: true }),
  defineTool({
    name: 'get_battery',
    description: 'Get the current battery level (0-1).',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ level: await Battery.getBatteryLevelAsync() }),
  }),
]);

// 3. Run the agent loop.
const agent = new Agent({ engine, registry });
const reply = await agent.send('Copy "hello" to my clipboard, then confirm.', {
  onEvent: (e) => console.log(e),
});
```

## How it works

`Agent.send()` drives a **think → call-tool → observe → repeat** loop:

1. The model is given the conversation plus your tool specs (OpenAI-style),
   using llama.rn's jinja chat template so its native tool-calling format is
   parsed automatically.
2. If it emits tool calls, the `ToolRegistry` validates arguments and runs each
   tool; results are fed back as `tool` messages.
3. The loop repeats until the model answers with no tool calls (or `maxSteps`).

Every step emits an `AgentEvent` (`token`, `tool_call`, `tool_result`,
`final`, `cancelled`, `max_steps`, …) so a UI can render the loop live.

## Cancellation

Pass an `AbortSignal` to `send()` to cancel a run at any point, including in
the middle of an active completion (the engine calls llama.rn's
`stopCompletion` under the hood). The run emits a terminal `cancelled` event
and rejects with an `AbortError`:

```ts
const controller = new AbortController();
const reply = agent.send('summarize my week', { signal: controller.signal });
// later, e.g. from a Cancel button:
controller.abort();
```

## Validation and limits

Tool-call arguments are validated against each tool's JSON Schema with Ajv
(compiled once at registration). Invalid arguments never throw out of the
loop; the model receives a structured `{ "error": ... }` tool result and can
retry.

`Agent` limits, all configurable via `AgentOptions`:

| Option | Default | Meaning |
| --- | --- | --- |
| `maxSteps` | 8 | Tool-call/think iterations per run; emits `max_steps` when hit |
| `maxTokens` | 512 | Per-completion generation cap (llama.rn `n_predict`) |
| `contextTokens` | engine `n_ctx` | Prompt budget; oldest turns are trimmed to `contextTokens - maxTokens` before each completion, and the run fails predictably if the current turn alone cannot fit |
| `charsPerToken` | 4 | Heuristic used to estimate prompt size |
| `maxToolResultChars` | 8000 | Serialized tool results larger than this are cut and given an explicit `[truncated: ...]` marker |

## Built-in tools

| Group | Tools | Module needed |
| --- | --- | --- |
| `network` | `http_request` | none (global fetch) |
| `filesystem` | `read_file`, `write_file`, `list_files` | `expo-file-system` |
| `clipboard` | `get_clipboard`, `set_clipboard` | `expo-clipboard` |
| `location` | `get_current_location` | `expo-location` |
| `notifications` | `schedule_notification` | `expo-notifications` |
| `contacts` | `search_contacts` | `expo-contacts` |
| `calendar` | `list_calendar_events`, `create_calendar_event` | `expo-calendar` |

Each group lazily requires its Expo module, so only enable groups whose modules
you've installed.

## Status

Early. The package currently ships TypeScript source (`main` → `src/index.ts`)
and is consumed via the workspace; a `react-native-builder-bob` build will be
added before publishing to npm.
