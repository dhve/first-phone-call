import type { Tool } from '../types';
import { createNetworkTools, type NetworkToolOptions } from './network';
import { createFilesystemTools } from './filesystem';
import {
  createClipboardTools,
  createLocationTools,
  createNotificationTools,
  createContactsTools,
  createCalendarTools,
} from './device';

export { createNetworkTools, type NetworkToolOptions } from './network';
export { createFilesystemTools } from './filesystem';
export {
  createClipboardTools,
  createLocationTools,
  createNotificationTools,
  createContactsTools,
  createCalendarTools,
} from './device';

export interface BuiltinToolsOptions {
  network?: NetworkToolOptions | false;
  filesystem?: { baseDir?: string } | false;
  clipboard?: boolean;
  location?: boolean;
  notifications?: boolean;
  contacts?: boolean;
  calendar?: boolean;
}

/**
 * Convenience factory that assembles the selected batteries-included tools.
 * Each group lazily requires its Expo module, so only enable the groups whose
 * modules you've installed.
 *
 * @example
 * const tools = createBuiltinTools({ network: {}, clipboard: true });
 */
export function createBuiltinTools(options: BuiltinToolsOptions = {}): Tool[] {
  const tools: Tool[] = [];
  if (options.network !== false) tools.push(...createNetworkTools(options.network ?? {}));
  if (options.filesystem !== false) tools.push(...createFilesystemTools(options.filesystem || {}));
  if (options.clipboard) tools.push(...createClipboardTools());
  if (options.location) tools.push(...createLocationTools());
  if (options.notifications) tools.push(...createNotificationTools());
  if (options.contacts) tools.push(...createContactsTools());
  if (options.calendar) tools.push(...createCalendarTools());
  return tools;
}
