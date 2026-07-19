# react-native-device-agent

On-device LLM **agent harness** for React Native. Register plain JavaScript
functions as tools and let a locally-running [llama.rn](https://github.com/mybigday/llama.rn)
model call them — fully offline, no API keys.

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

// 2. Register tools — built-ins plus your own.
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
`final`, …) so a UI can render the loop live.

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

Each group lazily requires its Expo module — only enable groups whose modules
you've installed.

## Status

Early. The package currently ships TypeScript source (`main` → `src/index.ts`)
and is consumed via the workspace; a `react-native-builder-bob` build will be
added before publishing to npm.
