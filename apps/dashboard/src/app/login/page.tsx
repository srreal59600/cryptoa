'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/components/auth';
import { Card } from '@/components/ui';
import { TELEGRAM_BOT, api, type TelegramAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramAuth) => void;
  }
}

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { me, refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.onTelegramAuth = (user) => {
      api
        .loginTelegram(user)
        .then(refresh)
        .then(() => router.push('/vip'))
        .catch((err: Error) => setError(err.message));
    };

    if (!TELEGRAM_BOT || !holder.current || holder.current.childElementCount > 0) return;
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', TELEGRAM_BOT);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    holder.current.appendChild(script);
  }, [refresh, router]);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Card>
        <h1 className="text-xl font-semibold text-slate-100">{t('login.title')}</h1>
        <p className="mt-2 text-sm text-slate-400">{t('login.body')}</p>

        <div ref={holder} className="mt-6 min-h-[48px]" />

        {!TELEGRAM_BOT ? (
          <p className="mt-2 text-sm text-amber-300">{t('login.noBot')}</p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-rose-400">{error}</p> : null}
        {me?.authenticated ? (
          <p className="mt-3 text-sm text-emerald-300">
            {t('login.signedIn', {
              user: me.username ? `@${me.username}` : String(me.telegram_id ?? ''),
              tier: me.vip ? 'VIP' : 'Free',
            })}
          </p>
        ) : null}
      </Card>

      <p className="text-xs text-slate-500">{t('login.domainNote')}</p>
    </div>
  );
}
