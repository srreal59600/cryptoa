'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { api, type Me } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Card } from '@/components/ui';

interface AuthState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  me: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch {
      setMe({ authenticated: false, vip: false });
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <AuthContext.Provider value={{ me, loading, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/** Header control showing the signed-in Telegram user and VIP state. */
export function AuthBadge() {
  const { t } = useI18n();
  const { me, loading, logout } = useAuth();
  if (loading) return null;

  if (!me?.authenticated) {
    return (
      <Link href="/login" className="rounded-md bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400">
        {t('auth.login')}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={me.vip ? 'text-amber-300' : 'text-slate-400'}>
        {me.username ? `@${me.username}` : me.telegram_id} · {me.vip ? 'VIP' : 'Free'}
      </span>
      {!me.vip ? (
        <Link href="/vip" className="rounded-md bg-amber-500 px-3 py-1.5 font-medium text-slate-900 hover:bg-amber-400">
          {t('auth.becomeVip')}
        </Link>
      ) : null}
      <button onClick={() => void logout()} className="text-slate-500 hover:text-slate-300">
        {t('auth.logout')}
      </button>
    </div>
  );
}

/** Wraps premium content; renders sign-in or upgrade prompts instead. */
export function VipGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { me, loading } = useAuth();
  if (loading) return <p className="text-sm text-slate-500">{t('auth.loading')}</p>;

  if (!me?.authenticated) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-slate-100">{t('auth.memberOnly')}</h2>
        <p className="mt-2 text-sm text-slate-400">{t('auth.memberOnlyBody')}</p>
        <Link
          href="/login"
          className="mt-4 inline-block rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400"
        >
          {t('auth.telegramLogin')}
        </Link>
      </Card>
    );
  }

  if (!me.vip) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-slate-100">{t('auth.vipRequired')}</h2>
        <p className="mt-2 text-sm text-slate-400">{t('auth.vipRequiredBody')}</p>
        <Link
          href="/vip"
          className="mt-4 inline-block rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-400"
        >
          {t('auth.viewPlan')}
        </Link>
      </Card>
    );
  }

  return <>{children}</>;
}
