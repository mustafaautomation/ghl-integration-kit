const titles: Record<string, string> = {
  received: 'Lead received',
  verified: 'Signature checked',
  upserted: 'Contact saved',
  sms_sent: 'First text sent',
  email_sent: 'Email sent',
  opportunity_created: 'Opportunity opened',
  slots_offered: 'Times offered',
  booked: 'Appointment booked',
  stage_moved: 'Moved to Booked',
  deduped: 'Already in the pipeline',
  text_back: 'Text-back sent',
};

export function eventTitle(type: string): string {
  return titles[type] ?? type.replaceAll('_', ' ');
}

export function eventNote(event: { type: string; detail: Record<string, unknown> }): string {
  if (event.type === 'verified' && typeof event.detail.algorithm === 'string') {
    return event.detail.algorithm === 'hmac-sha256' ? 'HMAC matched the raw body' : 'Public key matched the raw body';
  }
  if (event.type === 'upserted') return event.detail.isNew ? 'New contact in the location' : 'Matched an existing contact';
  if (event.type === 'slots_offered' && Array.isArray(event.detail.slots)) return `${event.detail.slots.length} open times on the intro calendar`;
  if (event.type === 'deduped' && typeof event.detail.note === 'string') return event.detail.note;
  if (event.type === 'booked' && typeof event.detail.startTime === 'string') return formatSlot(event.detail.startTime);
  if (event.type === 'stage_moved') return 'Pipeline stage is now Booked';
  if (event.type === 'sms_sent' || event.type === 'text_back') return 'Sent through the conversations API';
  if (event.type === 'email_sent') return 'Subject: We got your request';
  if (event.type === 'opportunity_created') return 'Opened in New';
  if (event.type === 'received') return 'Waiting on the queue';
  return '';
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatSlot(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(date);
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(date);
}

export function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  }).format(date);
}

export function dayKey(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/New_York',
  }).format(date);
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    received: 'Received',
    processing: 'Working',
    offered: 'Times offered',
    booked: 'Booked',
    deduped: 'Already open',
    text_back: 'Text sent',
    failed: 'Failed',
    completed: 'Done',
    pending: 'Waiting',
    active: 'Running',
    dead: 'Dead letter',
  };
  return labels[status] ?? status;
}

export function statusTone(status: string): 'good' | 'warn' | 'bad' | 'info' | 'neutral' {
  if (status === 'booked' || status === 'completed') return 'good';
  if (status === 'offered' || status === 'pending' || status === 'deduped') return 'warn';
  if (status === 'failed' || status === 'dead') return 'bad';
  if (status === 'text_back' || status === 'processing' || status === 'active' || status === 'received') return 'info';
  return 'neutral';
}

export function sourceLabel(source: string): string {
  if (source === 'meta') return 'Meta Lead Ads';
  if (source === 'website_form') return 'Website form';
  if (source === 'missed_call') return 'Missed call';
  return source;
}
