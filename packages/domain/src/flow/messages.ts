export function firstTouchSms(business: string, firstName: string, interest?: string): string {
  const name = firstName.trim() || 'there';
  const topic = interest ? ` about ${interest}` : '';
  return `Hi ${name}, it's ${business}. We got your request${topic}. A few times are open this week. Reply if one works, or pick a slot and we'll lock it in.`;
}

export function firstTouchEmail(business: string, firstName: string, interest?: string): { subject: string; text: string; html: string } {
  const name = firstName.trim() || 'there';
  const topic = interest ? ` about ${interest}` : '';
  const subject = 'We got your request';
  const text = `Hi ${name}, it's ${business}. We got your note${topic}. Open times are in the text we just sent. Pick one and the calendar is yours.`;
  const html = `<p>${text}</p>`;
  return { subject, text, html };
}

export function missedCallSms(business: string, firstName: string): string {
  const name = firstName.trim() || 'there';
  return `Hi ${name}, sorry we missed you. It's ${business}. If you still want to talk, reply with a time that works.`;
}
