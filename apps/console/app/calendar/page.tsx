'use client';

import { useEffect, useState } from 'react';
import { ErrorNote } from '../../components/ui';
import { apiGet, type GhlAppointment } from '../../lib/api';
import { dayKey, formatClock, formatDay } from '../../lib/format';

function upcomingDays(): Date[] {
  const days: Date[] = [];
  const cursor = new Date();
  for (let i = 0; i < 7; i += 1) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export default function CalendarPage() {
  const [events, setEvents] = useState<GhlAppointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = upcomingDays();

  async function load() {
    try {
      const body = await apiGet<{ events: GhlAppointment[] }>('/crm/appointments');
      setEvents(body.events);
      setError(null);
    } catch {
      setError('The calendar could not be loaded from the mock.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="rise">
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <p>Intro calls on the mock calendar. Times are shown in Eastern.</p>
        </div>
      </div>
      {error ? <ErrorNote message={error} onRetry={() => void load()} /> : null}
      <div className="week">
        {days.map((day) => {
          const key = dayKey(day.toISOString());
          const booked = (events ?? []).filter((event) => dayKey(event.startTime) === key);
          return (
            <section key={key} className="card day">
              <h2>{formatDay(day)}</h2>
              {booked.length === 0 ? <p className="open-day">No bookings</p> : null}
              {booked.map((event) => (
                <article key={event.id} className="appt">
                  <strong>{event.title}</strong>
                  <span>{formatClock(event.startTime)} · {event.appointmentStatus}</span>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
