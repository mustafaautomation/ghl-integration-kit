import { randomBytes } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

export const LEADCONNECTOR_VERSION = '2021-07-28';
export const LEADCONNECTOR_BASE_URL = 'https://services.leadconnectorhq.com';
export const OAUTH_AUTHORIZE_URL = 'https://marketplace.gohighlevel.com/oauth/chooselocation';

export const DEFAULT_SCOPES = [
  'contacts.readonly',
  'contacts.write',
  'opportunities.readonly',
  'opportunities.write',
  'conversations.readonly',
  'conversations.write',
  'conversations/message.readonly',
  'conversations/message.write',
  'calendars.readonly',
  'calendars.write',
  'calendars/events.readonly',
  'calendars/events.write',
  'locations.readonly',
  'locations/customFields.readonly',
  'locations/customFields.write',
  'locations/tags.readonly',
  'locations/tags.write',
] as const;

export const DEMO_ENCRYPTION_KEY_B64 = 'ZGVtby1vbmx5LWtleS1ub3QtZm9yLWxpdmUtdXNlISE=';
