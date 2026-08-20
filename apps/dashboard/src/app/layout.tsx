import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthBadge, AuthProvider } from '@/components/auth';
import { LegalFooter, LocaleSwitcher, MobileNav, SidebarNav, Tagline } from '@/components/nav';
import { I18nProvider } from '@/lib/i18n';

import './globals.css';

export const metadata: Metadata = {
  title: 'WhaleRadar — Multi-Chain Whale & Smart Money Tracker',
  description: 'Real-time whale transfers, DEX listings and accumulation scoring across Ethereum, BNB Chain, Polygon and Arbitrum.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <I18nProvider>
        <AuthProvider>
        <div className="flex min-h-screen">
          <aside className="hidden w-60 shrink-0 border-r border-slate-800 bg-slate-900/50 p-6 lg:block">
            <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
              <span aria-hidden>🐋</span> WhaleRadar
            </Link>
            <Tagline />
            <SidebarNav />
          </aside>

          <div className="flex-1">
            <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <Link href="/" className="font-semibold lg:hidden">🐋 WhaleRadar</Link>
              <MobileNav />
              <div className="ml-auto flex items-center gap-3">
                <LocaleSwitcher />
                <AuthBadge />
              </div>
            </header>
            <main className="p-6">{children}</main>
            <LegalFooter />
          </div>
        </div>
        </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
