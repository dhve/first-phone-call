import { useCallback, useRef, useState } from 'react';
import {
  Agent,
  LlamaEngine,
  ToolRegistry,
  defineTool,
  createBuiltinTools,
} from 'react-native-device-agent';
import { MODEL, REMOTE_SYSTEM_PROMPT, SYSTEM_PROMPT, stripThinking } from './config';
import { ensureModel } from './modelManager';

export type Status = 'idle' | 'downloading' | 'loading' | 'ready' | 'thinking' | 'error';

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
}

let _id = 0;
const nextId = () => `m${++_id}`;

export function useAgent() {
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const agentRef = useRef<Agent | null>(null);
  /**
   * Separate agent for messages arriving from other agents. It shares the
   * engine (the expensive part) but keeps its own history, so a remote call
   * never appears in — or contaminates — the local user's conversation.
   */
  const remoteAgentRef = useRef<Agent | null>(null);

  const append = useCallback((role: UIMessage['role'], text: string) => {
    const id = nextId();
    setMessages((prev) => [...prev, { id, role, text }]);
    return id;
  }, []);

  const updateText = useCallback((id: string, text: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text } : m)));
  }, []);

  /** Download the model (if needed), load it, and build the agent. */
  const initialize = useCallback(async () => {
    try {
      setError(null);
      setStatus('downloading');
      const uri = await ensureModel((f) => setProgress(f));

      setStatus('loading');
      const engine = await LlamaEngine.load({ model: uri, n_ctx: MODEL.nCtx });

      // Built-in tools + one custom tool to show the registration API.
      const registry = new ToolRegistry([
        ...createBuiltinTools({
          network: {},
          filesystem: {},
          clipboard: true,
          notifications: true,
          contacts: true,
          calendar: true,
          location: true,
        }),
        defineTool({
          name: 'get_current_time',
          description: 'Get the current date and time on the device.',
          parameters: { type: 'object', properties: {} },
          execute: () => ({ iso: new Date().toISOString() }),
        }),
      ]);

      agentRef.current = new Agent({
        engine,
        registry,
        systemPrompt: SYSTEM_PROMPT,
      });
      remoteAgentRef.current = new Agent({
        engine,
        registry,
        systemPrompt: REMOTE_SYSTEM_PROMPT,
      });
      setStatus('ready');
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  }, []);

  /** Send a user turn and stream the agent's response + tool activity. */
  const send = useCallback(
    async (text: string) => {
      const agent = agentRef.current;
      if (!agent || status === 'thinking') return;

      append('user', text);
      setStatus('thinking');

      let streamId: string | null = null;
      let streamed = '';

      try {
        await agent.send(text, {
          onEvent: (e) => {
            switch (e.type) {
              case 'step':
                streamId = null;
                streamed = '';
                break;
              case 'token':
                if (!streamId) streamId = append('assistant', '');
                streamed += e.text;
                updateText(streamId, streamed);
                break;
              case 'assistant_message':
                // If the step only produced tool calls, drop the empty bubble.
                if (e.toolCalls?.length && streamId && !streamed.trim()) {
                  const id = streamId;
                  setMessages((prev) => prev.filter((m) => m.id !== id));
                  streamId = null;
                }
                break;
              case 'tool_call': {
                const args = e.call.function.arguments || '{}';
                append('tool', `🛠️  ${e.call.function.name}(${args})`);
                break;
              }
              case 'tool_result': {
                const body = e.error
                  ? `⚠️  ${e.error}`
                  : `↳ ${JSON.stringify(e.result)}`;
                append('tool', body);
                break;
              }
              case 'final':
                if (!streamId) append('assistant', e.content);
                else updateText(streamId, e.content);
                break;
            }
          },
        });
      } catch (e) {
        append('tool', `⚠️  ${(e as Error).message}`);
      } finally {
        setStatus('ready');
      }
    },
    [status, append, updateText],
  );

  /**
   * Answer a message that arrived from another agent via the relay.
   *
   * Each call starts from a clean history: these are one-shot agent-to-agent
   * exchanges, and carrying context across callers would both leak one
   * caller's conversation into another's and overflow the 4k window.
   */
  const answerRemote = useCallback(async (text: string): Promise<string> => {
    const agent = remoteAgentRef.current;
    if (!agent) throw new Error('model not loaded yet');
    agent.reset();
    const raw = await agent.send(text);
    return stripThinking(raw) || '(no reply)';
  }, []);

  /** Append a line to the transcript from outside the chat flow. */
  const appendLine = useCallback(
    (role: UIMessage['role'], text: string) => append(role, text),
    [append],
  );

  /** True once the model is loaded and not mid-generation. */
  const idle = status === 'ready';

  return {
    status,
    progress,
    error,
    messages,
    initialize,
    send,
    answerRemote,
    appendLine,
    idle,
  };
}
