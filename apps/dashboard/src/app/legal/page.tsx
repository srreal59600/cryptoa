'use client';

import { Card } from '@/components/ui';
import { useI18n, type MessageKey } from '@/lib/i18n';

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? 'WhaleRadarWRABot';

// The date the wording below was last changed; shown so members can tell which
// version of the terms they agreed to.
const UPDATED = '2026-08-19';

const SECTIONS: { title: MessageKey; body: MessageKey }[] = [
  { title: 'legal.riskTitle', body: 'legal.riskBody' },
  { title: 'legal.termsTitle', body: 'legal.termsBody' },
  { title: 'legal.privacyTitle', body: 'legal.privacyBody' },
  { title: 'legal.paymentTitle', body: 'legal.paymentBody' },
];

export default function LegalPage() {
  const { t } = useI18n();
  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('legal.title')}</h1>
        <p className="text-sm text-slate-400">{t('legal.updated', { date: UPDATED })}</p>
      </header>

      {SECTIONS.map((section) => (
        <Card key={section.title}>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
            {t(section.title)}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">{t(section.body)}</p>
        </Card>
      ))}

      <Card>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
          {t('legal.contactTitle')}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          {t('legal.contactBody', { bot: `@${BOT}` })}
        </p>
      </Card>
    </div>
  );
}
