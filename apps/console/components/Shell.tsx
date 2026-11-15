'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const links = [
  { href: '/', label: 'Overview' },
  { href: '/leads', label: 'Leads' },
  { href: '/webhooks', label: 'Webhooks' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/opportunities', label: 'Opportunities' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/queue', label: 'Queue' },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="mark" aria-hidden="true">
            N
          </span>
          <span>
            <strong>Northwind</strong>
            <small>Operator console</small>
          </span>
        </Link>
        <nav aria-label="Primary">
          {links.map((link) => {
            const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
            return (
              <Link key={link.href} href={link.href} aria-current={active ? 'page' : undefined}>
                {link.label}
              </Link>
            );
          })}
        </nav>
        <p className="side-note">Mock GHL · synthetic data</p>
      </aside>
      <main className="main" id="content">
        {children}
      </main>
    </div>
  );
}
