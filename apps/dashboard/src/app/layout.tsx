import type { Metadata } from 'next';
import Link from 'next/link';

import './globals.css';

export const metadata: Metadata = {
  title: 'WhaleRadar — Multi-Chain Whale & Smart Money Tracker',
  description: 'Real-time whale transfers, DEX listings and accumulation scoring across Ethereum, BNB Chain, Polygon and Arbitrum.',
};

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/transfers', label: 'Whale Feed' },
  { href: '/tokens', label: 'Accumulation' },
  { href: '/pools', label: 'New Pools' },
  { href: '/admin', label: 'Admin' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <div className="flex min-h-screen">
          <aside className="hidden w-60 shrink-0 border-r border-slate-800 bg-slate-900/50 p-6 lg:block">
            <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
              <span aria-hidden>🐋</span> WhaleRadar
            </Link>
            <p className="mt-1 text-xs text-slate-500">Multi-chain smart money</p>
            <nav className="mt-8 space-y-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800 hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>

          <div className="flex-1">
            <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4 lg:hidden">
              <Link href="/" className="font-semibold">🐋 WhaleRadar</Link>
              <nav className="flex gap-3 text-xs text-slate-400">
                {NAV.map((item) => (
                  <Link key={item.href} href={item.href} className="hover:text-white">
                    {item.label}
                  </Link>
                ))}
              </nav>
            </header>
            <main className="p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
