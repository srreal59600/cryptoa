import Redis from 'ioredis';
import { Telegraf } from 'telegraf';

import type { BotConfig } from './config';
import type { Database } from './db';
import { renderAlert } from './format';
import type { Alert } from './types';

const ALERT_CHANNEL = 'whaleradar:alerts';

/**
 * Consumes alerts published by the Go listener and fans them out:
 *  - VIP channel + VIP direct messages: instantly
 *  - Free channel: only very large alerts, after a delay
 */
export class AlertDispatcher {
  private readonly sub: Redis;

  constructor(
    private readonly bot: Telegraf,
    private readonly db: Database,
    private readonly cfg: BotConfig,
  ) {
    this.sub = new Redis(cfg.redisUrl, { maxRetriesPerRequest: null });
  }

  async start(): Promise<void> {
    await this.sub.subscribe(ALERT_CHANNEL);
    this.sub.on('message', (_channel, payload) => {
      let alert: Alert;
      try {
        alert = JSON.parse(payload) as Alert;
      } catch (err) {
        console.error('dropping malformed alert', err);
        return;
      }
      void this.handle(alert).catch((err) => console.error('alert dispatch failed', err));
    });
    console.log(`alert dispatcher subscribed to ${ALERT_CHANNEL}`);
  }

  async stop(): Promise<void> {
    await this.sub.quit();
  }

  private async handle(alert: Alert): Promise<void> {
    const vipText = renderAlert(alert, { dashboardUrl: this.cfg.dashboardUrl, tier: 'vip' });

    if (this.cfg.vipChannelId) {
      await this.send(this.cfg.vipChannelId, vipText);
    }
    await this.fanoutToVipUsers(alert, vipText);

    if (this.cfg.freeChannelId && alert.amount_usd >= this.cfg.freeChannelUsd) {
      const freeText = renderAlert(alert, { dashboardUrl: this.cfg.dashboardUrl, tier: 'free' });
      setTimeout(() => {
        void this.send(this.cfg.freeChannelId!, freeText);
      }, this.cfg.freeDelaySeconds * 1000);
    }
  }

  private async fanoutToVipUsers(alert: Alert, text: string): Promise<void> {
    const [users, watchIndex] = await Promise.all([this.db.activeVipUsers(), this.db.watchIndex()]);
    const involved = [alert.token, alert.from, alert.to]
      .filter(Boolean)
      .map((a) => a.toLowerCase());

    for (const user of users) {
      const watched = watchIndex.get(Number(user.telegram_id));
      const isWatched = watched ? involved.some((a) => watched.has(a)) : false;
      const chains = user.chains ?? [];

      if (!isWatched) {
        if (alert.amount_usd < Number(user.min_usd)) continue;
        if (chains.length > 0 && !chains.includes(alert.chain_id)) continue;
      }
      // delivered_alerts doubles as the de-duplication guard across restarts.
      if (!(await this.db.recordDelivery(alert.id, Number(user.telegram_id)))) continue;

      await this.send(String(user.telegram_id), text);
      // Stay well below Telegram's ~30 messages/second limit.
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }

  private async send(chatId: string, text: string): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(chatId, text, {
        parse_mode: 'MarkdownV2',
        link_preview_options: { is_disabled: true },
      });
    } catch (err) {
      console.error(`sending to ${chatId} failed`, err);
    }
  }
}
