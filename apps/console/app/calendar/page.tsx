'use client';

import { useEffect, useState } from 'react';
import { ErrorNote, Skeleton } from '../../components/ui';
import { apiBase, apiGet, type GhlAppointment, type Offer } from '../../lib/api';
import { dayKey, formatClock, formatDay } from '../../lib/format';

const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17];

function upcomingDays(): Date[] {
  const days: Date[] = [];
  const cursor = new Date();
  for (let i = 0; i < 7; i += 1) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function hourInNewYork(iso: string): number {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  return Number(hour);
}

export default function CalendarPage() {
  const [events, setEvents] = useState<GhlAppointment[] | null>(null);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<string | null>(null);
  const days = upcomingDays();

  async function load() {
    try {
      const [appointments, open] = await Promise.all([
        apiGet<{ events: GhlAppointment[] }>('/crm/appointments'),
        apiGet<{ offers: Offer[] }>('/offers'),
      ]);
      setEvents(appointments.events);
      setOffers(open.offers);
      setError(null);
    } catch {
      setError('The calendar could not be loaded from the mock.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function book(offer: Offer) {
    setBooking(offer.startTime);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/leads/${offer.leadId}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startTime: offer.startTime }),
      });
      if (!res.ok) throw new Error('book failed');
      await load();
    } catch {
      setError('That time did not book. Refresh and try another slot.');
    } finally {
      setBooking(null);
    }
  }

  return (
    <div className="rise">
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <p>Intro calls on the mock calendar. Open slots can be booked from the grid. Times are Eastern.</p>
        </div>
      </div>
      {error ? <ErrorNote message={error} onRetry={() => void load()} /> : null}
      {events === null ? <Skeleton rows={6} /> : null}
      <div className="card table-wrap week-grid" tabIndex={0} aria-label="Week calendar">
        <table className="table week-table">
          <caption className="sr-only">Week of intro calls</caption>
          <thead>
            <tr>
              <th>Time</th>
              {days.map((day) => (
                <th key={dayKey(day.toISOString())}>{formatDay(day)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.map((hour) => (
              <tr key={hour}>
                <th scope="row">{formatHour(hour)}</th>
                {days.map((day) => {
                  const key = dayKey(day.toISOString());
                  const booked = (events ?? []).filter((event) => dayKey(event.startTime) === key && hourInNewYork(event.startTime) === hour);
                  const open = (offers ?? []).filter((offer) => dayKey(offer.startTime) === key && hourInNewYork(offer.startTime) === hour);
                  return (
                    <td key={key}>
                      {booked.map((event) => (
                        <article key={event.id} className="appt">
                          <strong>{event.title}</strong>
                          <span>{formatClock(event.startTime)} · {event.appointmentStatus}</span>
                        </article>
                      ))}
                      {open.map((offer) => (
                        <button
                          key={`${offer.leadId}-${offer.startTime}`}
                          className="btn btn-slot"
                          type="button"
                          disabled={booking !== null}
                          onClick={() => void book(offer)}
                        >
                          {booking === offer.startTime ? 'Booking…' : `Book ${formatClock(offer.startTime)}`}
                          <span className="node-hint">{offer.name}</span>
                        </button>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {events && events.length === 0 && offers && offers.length === 0 ? (
        <p className="muted">Nothing is on the calendar yet. Send a test lead, then book one of the open times.</p>
      ) : null}
    </div>
  );
}

function formatHour(hour: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${suffix}`;
}
