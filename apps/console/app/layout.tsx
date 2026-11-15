import type { ReactNode } from 'react';
import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/geist-mono/wght.css';
import { Shell } from '../components/Shell';
import './globals.css';

export const metadata = {
  title: 'Northwind · operator console',
  description: 'Watch a lead move from the form to a booked call.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#content">
          Skip to content
        </a>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
