import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pokemon Showdown Replay Summarizer',
  description:
    'Paste a Pokemon Showdown replay link to get a compact, sprite-based turn summary ready for Google Docs.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
