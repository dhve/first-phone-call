/**
 * react-native-device-agent
 *
 * On-device LLM agent harness for React Native. Register plain JS functions as
 * tools and let a locally-running llama.rn model call them.
 */

export { Agent } from './agent';
export type { AgentOptions, RunOptions } from './agent';

export { LlamaEngine } from './llama';
export type { LlamaLoadOptions, ChatOptions, ChatResult } from './llama';

export { ToolRegistry } from './toolRegistry';
export { defineTool } from './defineTool';

export {
  createBuiltinTools,
  createNetworkTools,
  createFilesystemTools,
  createClipboardTools,
  createLocationTools,
  createNotificationTools,
  createContactsTools,
  createCalendarTools,
} from './tools';
export type { BuiltinToolsOptions } from './tools';
export type { NetworkToolOptions } from './tools/network';

export type {
  Tool,
  ToolSpec,
  ToolCall,
  ToolContext,
  ChatMessage,
  ChatRole,
  JSONSchema,
  JSONSchemaProperty,
  AgentEvent,
  AgentEventHandler,
} from './types';
