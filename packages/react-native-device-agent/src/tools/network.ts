import { defineTool } from '../defineTool';
import type { Tool } from '../types';

export interface NetworkToolOptions {
  /** Cap on response body characters fed back to the model. Default 4000. */
  maxChars?: number;
  /** Optional allow-list of hostnames the agent may reach. */
  allowedHosts?: string[];
}

/**
 * An HTTP fetch tool so the agent can reach web APIs. Uses the RN global
 * `fetch`, so it has no native dependency.
 */
export function createNetworkTools(options: NetworkToolOptions = {}): Tool[] {
  const maxChars = options.maxChars ?? 4000;

  const httpRequest = defineTool<{
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }>({
    name: 'http_request',
    description:
      'Make an HTTP request to a URL and return the response status and body. ' +
      'Use for calling web APIs or fetching public data.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL including https://' },
        method: { type: 'string', description: 'HTTP method, default GET', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
        headers: { type: 'object', description: 'Optional request headers' },
        body: { type: 'string', description: 'Optional request body (string)' },
      },
      required: ['url'],
    },
    execute: async ({ url, method = 'GET', headers, body }, ctx) => {
      if (options.allowedHosts?.length) {
        const host = safeHost(url);
        if (!host || !options.allowedHosts.includes(host)) {
          throw new Error(`Host "${host}" is not in the allow-list`);
        }
      }
      const res = await fetch(url, { method, headers, body, signal: ctx.signal });
      const text = await res.text();
      return {
        status: res.status,
        ok: res.ok,
        body: text.length > maxChars ? text.slice(0, maxChars) + '…[truncated]' : text,
      };
    },
  });

  return [httpRequest];
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
