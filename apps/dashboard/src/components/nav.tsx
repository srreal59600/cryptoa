'use client';

import Link from 'next/link';

import { LOCALES, useI18n, type MessageKey } from '@/lib/i18n';

const NAV: { href: string; key: MessageKey }[] = [
  { href: '/', key: 'nav.overview' },
  { href: '/transfers', key: 'nav.transfers' },
  { href: '/tokens', key: 'nav.tokens' },
  { href: '/pools', key: 'nav.pools' },
  { href: '/analytics', key: 'nav.analytics' },
  { href: '/performance', key: 'nav.performance' },
  { href: '/whales', key: 'nav.whales' },
  { href: '/vip', key: 'nav.vip' },
  { href: '/admin', key: 'nav.admin' },
  { href: '/legal', key: 'nav.legal' },
];

export function SidebarNav() {
  const { t } = useI18n();
  return (
    <nav className="mt-8 space-y-1">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="block rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800 hover:text-white"
        >
          {t(item.key)}
        </Link>
      ))}
    </nav>
  );
}

export function MobileNav() {
  const { t } = useI18n();
  return (
    <nav className="flex gap-3 text-xs text-slate-400 lg:hidden">
      {NAV.map((item) => (
        <Link key={item.href} href={item.href} className="hover:text-white">
          {t(item.key)}
        </Link>
      ))}
    </nav>
  );
}

// Disclaimer sits in the footer of every page: the product ships financial
// context, so the "not advice" line has to be visible everywhere.
export function LegalFooter() {
  const { t } = useI18n();
  return (
    <footer className="border-t border-slate-800 px-6 py-4 text-xs text-slate-500">
      <span>{t('legal.footer')}</span>{' '}
      <Link href="/legal" className="text-slate-400 underline hover:text-slate-200">
        {t('legal.title')}
      </Link>
    </footer>
  );
}

export function Tagline() {
  const { t } = useI18n();
  return <p className="mt-1 text-xs text-slate-500">{t('brand.tagline')}</p>;
}

export function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();
  return (
    <div className="flex overflow-hidden rounded-md border border-slate-700 text-xs">
      {LOCALES.map((option) => (
        <button
          key={option.code}
          onClick={() => setLocale(option.code)}
          aria-pressed={locale === option.code}
          className={`px-2 py-1 transition ${
            locale === option.code ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
