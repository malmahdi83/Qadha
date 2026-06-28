import type { Metadata } from 'next';
import './globals.css';
import { AppProvider } from '@/lib/context';
import Header from '@/components/Header';

export const metadata: Metadata = {
  title: 'Qadha — Bilingual AI Interview & Presentation Coach',
  description: 'Practice interviews and presentations with AI-powered feedback in Arabic and English.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body>
        <AppProvider>
          <Header />
          <main>{children}</main>
        </AppProvider>
      </body>
    </html>
  );
}
