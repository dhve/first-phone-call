import { defineTool } from '../defineTool';
import type { Tool } from '../types';

/**
 * Device-action tools. Each group lazily requires its Expo module so apps only
 * need to install the ones they actually use. All of these prompt the OS for
 * the relevant permission on first use.
 */

/** Clipboard read/write via `expo-clipboard`. */
export function createClipboardTools(): Tool[] {
  const Clipboard = require('expo-clipboard');
  return [
    defineTool({
      name: 'get_clipboard',
      description: 'Read the current text contents of the device clipboard.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      execute: async () => ({ text: await Clipboard.getStringAsync() }),
    }),
    defineTool<{ text: string }>({
      name: 'set_clipboard',
      description: 'Copy text to the device clipboard.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string', description: 'Text to copy' } },
        required: ['text'],
      },
      execute: async ({ text }) => {
        await Clipboard.setStringAsync(text);
        return { ok: true };
      },
    }),
  ];
}

/** Current GPS location via `expo-location`. */
export function createLocationTools(): Tool[] {
  const Location = require('expo-location');
  return [
    defineTool({
      name: 'get_current_location',
      description: 'Get the device current GPS coordinates (latitude/longitude).',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      execute: async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') throw new Error('Location permission denied');
        const pos = await Location.getCurrentPositionAsync({});
        return {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
      },
    }),
  ];
}

/** Local notifications via `expo-notifications`. */
export function createNotificationTools(): Tool[] {
  const Notifications = require('expo-notifications');
  return [
    defineTool<{ title: string; body: string; seconds?: number }>({
      name: 'schedule_notification',
      description: 'Schedule a local notification/reminder after a delay.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'Notification title' },
          body: { type: 'string', description: 'Notification body text' },
          seconds: { type: 'number', description: 'Delay in seconds, default 5' },
        },
        required: ['title', 'body'],
      },
      execute: async ({ title, body, seconds = 5 }) => {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') throw new Error('Notification permission denied');
        const id = await Notifications.scheduleNotificationAsync({
          content: { title, body },
          trigger: { seconds: Math.max(1, seconds) },
        });
        return { id, firesInSeconds: Math.max(1, seconds) };
      },
    }),
  ];
}

/** Contact lookup via `expo-contacts`. */
export function createContactsTools(): Tool[] {
  const Contacts = require('expo-contacts');
  return [
    defineTool<{ query: string }>({
      name: 'search_contacts',
      description: 'Search the device contacts by name. Returns names and phone numbers.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { query: { type: 'string', description: 'Name to search for' } },
        required: ['query'],
      },
      execute: async ({ query }) => {
        const { status } = await Contacts.requestPermissionsAsync();
        if (status !== 'granted') throw new Error('Contacts permission denied');
        const { data } = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.PhoneNumbers],
          name: query,
        });
        return {
          matches: data.slice(0, 10).map((c: any) => ({
            name: c.name,
            phones: (c.phoneNumbers ?? []).map((p: any) => p.number),
          })),
        };
      },
    }),
  ];
}

/** Calendar read/create via `expo-calendar`. */
export function createCalendarTools(): Tool[] {
  const Calendar = require('expo-calendar');

  const ensurePermission = async () => {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') throw new Error('Calendar permission denied');
  };
  const defaultCalendarId = async (): Promise<string> => {
    const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const writable = cals.find((c: any) => c.allowsModifications) ?? cals[0];
    if (!writable) throw new Error('No writable calendar found');
    return writable.id;
  };

  return [
    defineTool<{ daysAhead?: number }>({
      name: 'list_calendar_events',
      description: 'List upcoming calendar events within the next N days (default 7).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { daysAhead: { type: 'number', description: 'Days ahead to look' } },
      },
      execute: async ({ daysAhead = 7 }) => {
        await ensurePermission();
        const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
        const now = new Date();
        const end = new Date(now.getTime() + daysAhead * 86400000);
        const events = await Calendar.getEventsAsync(cals.map((c: any) => c.id), now, end);
        return {
          events: events.slice(0, 20).map((e: any) => ({
            title: e.title,
            startDate: e.startDate,
            endDate: e.endDate,
            location: e.location,
          })),
        };
      },
    }),
    defineTool<{ title: string; startISO: string; endISO?: string; notes?: string }>({
      name: 'create_calendar_event',
      description: 'Create a calendar event. Times must be ISO 8601 strings.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'Event title' },
          startISO: { type: 'string', description: 'Start time, ISO 8601' },
          endISO: { type: 'string', description: 'End time, ISO 8601 (default +1h)' },
          notes: { type: 'string', description: 'Optional notes' },
        },
        required: ['title', 'startISO'],
      },
      execute: async ({ title, startISO, endISO, notes }) => {
        await ensurePermission();
        const start = new Date(startISO);
        const end = endISO ? new Date(endISO) : new Date(start.getTime() + 3600000);
        const id = await Calendar.createEventAsync(await defaultCalendarId(), {
          title,
          startDate: start,
          endDate: end,
          notes,
        });
        return { id, title, start: start.toISOString(), end: end.toISOString() };
      },
    }),
  ];
}
