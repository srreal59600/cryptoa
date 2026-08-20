import { Context, Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import type { Message, Update } from 'telegraf/types';

import { loadConfig } from './config';
import { Database } from './db';
import { AlertDispatcher } from './dispatcher';
import { amount, esc, pct, short, usd } from './format';

/** Context of a text command handler, where ctx.message is always present. */
type CommandContext = Context<Update.MessageUpdate<Message.TextMessage>>;

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  56: 'BNB Chain',
  137: 'Polygon',
  42161: 'Arbitrum',
};

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = new Database(cfg.postgresDsn);
  const bot = new Telegraf(cfg.token);

  const isAdmin = (id?: number): boolean => !!id && cfg.adminIds.includes(id);

  const isVip = (user: { tier: string; vip_expires_at: Date | null }): boolean =>
    user.tier === 'vip' && (!user.vip_expires_at || new Date(user.vip_expires_at) > new Date());

  const ensureUser = async (ctx: { from?: { id: number; username?: string; first_name?: string } }) => {
    if (!ctx.from) return null;
    return db.upsertUser(ctx.from.id, ctx.from.username, ctx.from.first_name, cfg.defaultMinUsd);
  };

  bot.start(async (ctx) => {
    const user = await ensureUser(ctx);
    await ctx.replyWithMarkdownV2(
      [
        '🐋 *WhaleRadar* — multi\\-chain whale & smart money tracker',
        '',
        `Tracking *Ethereum*, *BNB Chain*, *Polygon* and *Arbitrum* for transfers above ${esc(usd(cfg.defaultMinUsd))}\\.`,
        '',
        `Your plan: *${esc((user?.tier ?? 'free').toUpperCase())}*`,
        '',
        '*Commands*',
        '/top — highest accumulation scores',
        '/token `<address|symbol>` — token breakdown',
        '/wallet `<address>` — recent whale activity',
        '/track `<address> <isim>` — VIP: hesabı takma adla takip et, hareketlerinde DM at',
        '/untrack `<address>` · /list · /nick `<address> <isim>`',
        '/whales — takip edilen dev hesaplar',
        '/pnl `<address>` — cüzdanın son 30 günlük tahmini sonucu',
        '/threshold `<usd>` — alert size for DMs',
        '/perf — how past signals performed',
        '/smart — smart money wallet leaderboard',
        '/mute · /unmute · /status',
        '/vip — upgrade for real\\-time alerts',
        '/delete — verilerini sil',
      ].join('\n'),
    );
  });

  bot.help((ctx) => ctx.reply('Use /start to see every command.'));

  bot.command('status', async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    const stats = await db.platformStats();
    const expires = user.vip_expires_at ? new Date(user.vip_expires_at).toISOString().slice(0, 10) : '—';
    await ctx.replyWithMarkdownV2(
      [
        '*Your subscription*',
        `Plan: *${esc(user.tier.toUpperCase())}* \\(expires: ${esc(expires)}\\)`,
        `DM threshold: ${esc(usd(Number(user.min_usd)))}`,
        `Alerts: ${user.muted ? 'muted' : 'active'}`,
        '',
        '*Platform \\(24h\\)*',
        `Whale transfers: ${esc(stats.transfers_24h)}`,
        `Tracked volume: ${esc(usd(Number(stats.volume_24h)))}`,
        `New pools: ${esc(stats.pools_24h)}`,
      ].join('\n'),
    );
  });

  bot.command('top', async (ctx) => {
    await ensureUser(ctx);
    const rows = await db.topScores(10);
    if (rows.length === 0) {
      await ctx.reply('No scores computed yet — the engine needs 24h of data.');
      return;
    }
    const lines = rows.map((r, i) => {
      const symbol = r.symbol || short(r.token);
      return `${i + 1}\\. *${esc(symbol)}* \\(${esc(CHAIN_NAMES[Number(r.chain_id)] ?? r.chain_id)}\\) — score *${esc(Number(r.score).toFixed(1))}*, net ${esc(usd(Number(r.net_accum_usd)))}`;
    });
    await ctx.replyWithMarkdownV2(['📊 *Top accumulation scores \\(24h\\)*', '', ...lines].join('\n'));
  });

  bot.command('token', async (ctx) => {
    await ensureUser(ctx);
    const [, query] = ctx.message.text.split(/\s+/);
    if (!query) {
      await ctx.reply('Usage: /token <address|symbol>');
      return;
    }
    const row = await db.tokenSummary(query);
    if (!row) {
      await ctx.reply('No data for that token yet.');
      return;
    }
    await ctx.replyWithMarkdownV2(
      [
        `*${esc(row.symbol || short(row.token))}* on ${esc(CHAIN_NAMES[Number(row.chain_id)] ?? row.chain_id)}`,
        '',
        `Accumulation score: *${esc(Number(row.score).toFixed(1))}/100*`,
        `24h DEX buys: ${esc(usd(Number(row.dex_buy_usd)))}`,
        `24h DEX sells: ${esc(usd(Number(row.dex_sell_usd)))}`,
        `24h CEX outflow: ${esc(usd(Number(row.cex_outflow_usd)))}`,
        `24h CEX inflow: ${esc(usd(Number(row.cex_inflow_usd)))}`,
        `Net accumulation: ${esc(usd(Number(row.net_accum_usd)))}`,
        `Whale transactions: ${esc(row.whale_tx_count)}`,
      ].join('\n'),
    );
  });

  bot.command('wallet', async (ctx) => {
    await ensureUser(ctx);
    const [, address] = ctx.message.text.split(/\s+/);
    if (!address?.startsWith('0x')) {
      await ctx.reply('Usage: /wallet <0x address>');
      return;
    }
    const rows = await db.walletActivity(address);
    if (rows.length === 0) {
      await ctx.reply('No whale-sized activity recorded for that wallet.');
      return;
    }
    const lines = rows.map(
      (r) =>
        `• ${esc(new Date(r.seen_at).toISOString().slice(0, 16).replace('T', ' '))} — ${esc(r.direction)} ${esc(usd(Number(r.amount_usd)))} ${esc(r.token_symbol)}`,
    );
    await ctx.replyWithMarkdownV2([`👛 *${esc(short(address))}* recent activity`, '', ...lines].join('\n'));
  });

  /**
   * Personal tracking is a paid feature: /track <address> [nickname…]
   * [chain_id]. The nickname is private to the user and is used as the header
   * of every DM about that address. /watch is the old name of the command.
   */
  const track = async (ctx: CommandContext) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    if (!isVip(user)) {
      await ctx.reply('Kişisel takip VIP üyelere açık. /vip ile üyelik alabilirsin.');
      return;
    }
    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    const address = parts.shift();
    if (!address?.startsWith('0x')) {
      await ctx.reply('Kullanım: /track <0x adres> <takma ad> [chain_id]');
      return;
    }
    let chainId = 1;
    if (parts.length > 0 && /^\d+$/.test(parts[parts.length - 1])) {
      chainId = Number(parts.pop());
    }
    const alias = parts.join(' ').slice(0, 64);

    await db.addWatch(
      user.telegram_id,
      chainId,
      address.length === 42 ? 'wallet' : 'token',
      address,
      alias,
    );
    await ctx.reply(
      `Takipte: ${alias || short(address)} (${short(address)}, chain ${chainId}). Bu hesabın her hareketinde sana DM atacağım.`,
    );
  };

  bot.command('track', track);
  bot.command('watch', track);

  bot.command('nick', async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    const [, address, ...rest] = ctx.message.text.trim().split(/\s+/);
    const alias = rest.join(' ').slice(0, 64);
    if (!address?.startsWith('0x') || !alias) {
      await ctx.reply('Kullanım: /nick <0x adres> <takma ad>');
      return;
    }
    const ok = await db.setWatchLabel(user.telegram_id, address, alias);
    await ctx.reply(ok ? `Takma ad kaydedildi: ${alias}` : 'Bu adres takip listende değil.');
  });

  bot.command('whales', async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    if (!isVip(user)) {
      await ctx.reply('Dev hesap listesi VIP üyelere açık. /vip');
      return;
    }
    const rows = await db.whaleAccounts(10);
    if (rows.length === 0) {
      await ctx.reply('Henüz eşiği aşan hesap yok — liste 15 dakikada bir yenileniyor.');
      return;
    }
    const lines = rows.map(
      (r, i) =>
        `${i + 1}\\. \`${esc(short(String(r.address)))}\` \\(${esc(CHAIN_NAMES[Number(r.chain_id)] ?? r.chain_id)}\\) — hacim ${esc(usd(Number(r.volume_usd)))}, 30g ${esc(usd(Number(r.pnl_usd)))} \\(${esc(pct(Number(r.pnl_pct), true))}\\)`,
    );
    await ctx.replyWithMarkdownV2(
      ['🐋 *Takipteki dev hesaplar*', '', ...lines, '', esc('Takip için: /track <adres> <takma ad>')].join('\n'),
    );
  });

  bot.command('pnl', async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    if (!isVip(user)) {
      await ctx.reply('Cüzdan kâr/zarar analizi VIP üyelere açık. /vip');
      return;
    }
    const [, address] = ctx.message.text.trim().split(/\s+/);
    if (!address?.startsWith('0x')) {
      await ctx.reply('Kullanım: /pnl <0x adres>');
      return;
    }
    const row = await db.walletPnl(address, 30);
    const cost = Number(row?.cost_usd ?? 0);
    if (cost <= 0) {
      await ctx.reply('Bu cüzdan için son 30 günde fiyatlanabilen alım kaydı yok.');
      return;
    }
    const value = Number(row.value_usd);
    const diff = value - cost;
    await ctx.replyWithMarkdownV2(
      [
        `📈 *${esc(short(address))}* — son 30 gün`,
        '',
        `Alım maliyeti: ${esc(usd(cost))}`,
        `Güncel değer: ${esc(usd(value))}`,
        `Tahmini sonuç: *${esc(usd(diff))}* \\(${esc(pct(diff / cost, true))}\\)`,
        `İşlem: ${esc(row.buys)} alım · ${esc(row.tokens)} token`,
        '',
        esc('Girişlerin güncel fiyata göre değerlemesidir; satışlar, köprüler ve gas hesaba katılmaz. Yatırım tavsiyesi değildir.'),
      ].join('\n'),
    );
  });

  bot.command('untrack', async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    const [, address] = ctx.message.text.split(/\s+/);
    if (!address) {
      await ctx.reply('Kullanım: /untrack <0x adres>');
      return;
    }
    const removed = await db.removeWatch(user.telegram_id, address);
    await ctx.reply(removed > 0 ? 'Takipten çıkarıldı.' : 'Bu adres takip listende değil.');
  });

  bot.command('unwatch', async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    const [, address] = ctx.message.text.split(/\s+/);
    if (!address) {
      await ctx.reply('Usage: /unwatch <0x address>');
      return;
    }
    const removed = await db.removeWatch(user.telegram_id, address);
    await ctx.reply(removed > 0 ? 'Removed from your watchlist.' : 'That address was not on your watchlist.');
  });

  bot.command('list', async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    const items = await db.listWatch(user.telegram_id);
    if (items.length === 0) {
      await ctx.reply('Your watchlist is empty. Add one with /watch <address>.');
      return;
    }
    await ctx.reply(
      items
        .map((i) => `• ${i.label || '(isimsiz)'} — ${i.address} [${i.kind}, chain ${i.chain_id}]`)
        .join('\n'),
    );
  });

  bot.command('threshold', async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    const [, raw] = ctx.message.text.split(/\s+/);
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 50_000) {
      await ctx.reply('Usage: /threshold <usd>. Minimum is 50000 (the engine discards anything smaller).');
      return;
    }
    await db.setMinUsd(user.telegram_id, value);
    await ctx.reply(`DM threshold set to ${usd(value)}.`);
  });

  bot.command('mute', async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    await db.setMuted(user.telegram_id, true);
    await ctx.reply('Alerts muted. Use /unmute to resume.');
  });

  bot.command('unmute', async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    await db.setMuted(user.telegram_id, false);
    await ctx.reply('Alerts resumed.');
  });

  bot.command('delete', async (ctx) => {
    const id = ctx.from?.id;
    if (!id) return;
    const [, confirm] = ctx.message.text.split(/\s+/);
    if (confirm !== 'CONFIRM') {
      await ctx.reply(
        'This erases your WhaleRadar profile, watchlist and web sessions. Send /delete CONFIRM to proceed.',
      );
      return;
    }
    await db.deleteUser(id);
    await ctx.reply('Your data has been deleted. Send /start if you ever want to come back.');
  });

  bot.command('vip', async (ctx) => {
    await ensureUser(ctx);
    await ctx.replyWithMarkdownV2(
      [
        '💎 *WhaleRadar VIP*',
        '',
        '• Real\\-time alerts \\(free channel is delayed\\)',
        `• Custom size threshold from ${esc(usd(50_000))}`,
        '• Unlimited watchlist for tokens and wallets',
        '• Accumulation score signals and DEX listing alerts',
        '',
        `Price: *${esc(usd(cfg.vipPriceUsd))} / month*`,
        cfg.vipPaymentAddress
          ? `Pay in USDT/USDC to \`${esc(cfg.vipPaymentAddress)}\` then send /paid \`<tx hash>\``
          : esc('Payment address is not configured yet — contact an admin.'),
      ].join('\n'),
    );
  });

  bot.command('paid', async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    const [, txHash] = ctx.message.text.split(/\s+/);
    if (!txHash?.startsWith('0x')) {
      await ctx.reply('Usage: /paid <transaction hash>');
      return;
    }
    await db.createPayment(user.telegram_id, 'vip_monthly', cfg.vipPriceUsd, txHash);
    await ctx.reply('Payment submitted. An admin will confirm it shortly.');
    for (const adminId of cfg.adminIds) {
      await bot.telegram.sendMessage(
        adminId,
        `Payment claim from ${user.telegram_id} (@${user.username ?? '-'}): ${txHash}`,
      );
    }
  });

  bot.command('perf', async (ctx) => {
    await ensureUser(ctx);
    const rows = await db.performance(30);
    const tracked = rows.find((r) => r.horizon === '1h')?.samples ?? 0;
    if (tracked === 0) {
      await ctx.reply('No settled signals yet — the first results appear one hour after the first alert.');
      return;
    }
    const lines = rows.map(
      (r) =>
        `*${esc(r.horizon)}* — ${esc(r.samples)} signals · win rate ${esc(pct(Number(r.win_rate)))} · avg ${esc(pct(Number(r.avg_return), true))}`,
    );
    await ctx.replyWithMarkdownV2(
      [
        '📈 *Signal track record \\(last 30 days\\)*',
        '',
        ...lines,
        '',
        esc('Measured from the alert price to the observed price after each holding period. Past results are not a promise of future returns.'),
      ].join('\n'),
    );
  });

  bot.command('smart', async (ctx) => {
    await ensureUser(ctx);
    const rows = await db.smartWallets(10);
    if (rows.length === 0) {
      await ctx.reply('No wallet track records yet — scoring needs a few days of history.');
      return;
    }
    const lines = rows.map(
      (r, i) =>
        `${i + 1}\\. \`${esc(short(r.address))}\` \\(${esc(CHAIN_NAMES[Number(r.chain_id)] ?? r.chain_id)}\\) — score *${esc(Number(r.score).toFixed(0))}*, ${esc(r.trades)} trades, avg ${esc(pct(Number(r.avg_ret_24h), true))}`,
    );
    await ctx.replyWithMarkdownV2(['🧠 *Smart money leaderboard \\(24h forward returns\\)*', '', ...lines].join('\n'));
  });

  bot.command('myid', (ctx) => ctx.reply(`Your Telegram ID: ${ctx.from?.id}`));

  // --- admin commands ---
  bot.command('grant', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    const [, rawId, rawDays] = ctx.message.text.split(/\s+/);
    const targetId = Number(rawId);
    const days = Number(rawDays ?? 30);
    if (!Number.isFinite(targetId)) {
      await ctx.reply('Usage: /grant <telegram_id> [days]');
      return;
    }
    await db.setTier(targetId, 'vip', days);
    await ctx.reply(`Granted VIP to ${targetId} for ${days} days.`);
    await bot.telegram.sendMessage(targetId, `💎 VIP activated for ${days} days. Welcome aboard!`).catch(() => undefined);
  });

  bot.command('revoke', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    const [, rawId] = ctx.message.text.split(/\s+/);
    const targetId = Number(rawId);
    if (!Number.isFinite(targetId)) {
      await ctx.reply('Usage: /revoke <telegram_id>');
      return;
    }
    await db.setTier(targetId, 'free');
    await ctx.reply(`Revoked VIP for ${targetId}.`);
  });

  bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    const text = ctx.message.text.replace(/^\/broadcast\s*/, '');
    if (!text) {
      await ctx.reply('Usage: /broadcast <message>');
      return;
    }
    const ids = await db.allUserIds();
    let sent = 0;
    for (const id of ids) {
      try {
        await bot.telegram.sendMessage(id, text);
        sent += 1;
      } catch {
        // user blocked the bot
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await ctx.reply(`Broadcast delivered to ${sent}/${ids.length} users.`);
  });

  bot.command('stats', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    const s = await db.platformStats();
    await ctx.reply(
      [
        `Transfers 24h: ${s.transfers_24h}`,
        `Volume 24h: ${usd(Number(s.volume_24h))}`,
        `New pools 24h: ${s.pools_24h}`,
        `Users: ${s.users} (VIP: ${s.vip_users})`,
      ].join('\n'),
    );
  });

  bot.on(message('text'), async (ctx) => {
    await ensureUser(ctx);
    if (ctx.message.text.startsWith('/')) return;
    if (ctx.message.text.trim().startsWith('0x')) {
      const address = ctx.message.text.trim();
      const rows = await db.walletActivity(address, 5);
      if (rows.length > 0) {
        await ctx.reply(
          rows
            .map((r) => `${r.direction} ${usd(Number(r.amount_usd))} ${r.token_symbol} — ${amount(Number(r.amount_usd))}`)
            .join('\n'),
        );
        return;
      }
    }
    await ctx.reply('Unknown input. Use /start to see the command list.');
  });

  const dispatcher = new AlertDispatcher(bot, db, cfg);
  await dispatcher.start();
  await bot.launch();
  console.log('whaleradar bot started');

  const shutdown = async (signal: string) => {
    console.log(`received ${signal}, shutting down`);
    bot.stop(signal);
    await dispatcher.stop();
    await db.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('bot failed to start', err);
  process.exit(1);
});
