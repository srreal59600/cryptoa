import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';

import { loadConfig } from './config';
import { Database } from './db';
import { AlertDispatcher } from './dispatcher';
import { amount, esc, short, usd } from './format';

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
        '/watch `<address>` — track a token or wallet',
        '/unwatch `<address>` · /list',
        '/threshold `<usd>` — alert size for DMs',
        '/mute · /unmute · /status',
        '/vip — upgrade for real\\-time alerts',
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

  bot.command('watch', async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    const parts = ctx.message.text.split(/\s+/);
    const address = parts[1];
    const chainId = Number(parts[2] ?? 1);
    if (!address?.startsWith('0x')) {
      await ctx.reply('Usage: /watch <0x address> [chain_id]');
      return;
    }
    await db.addWatch(user.telegram_id, chainId, address.length === 42 ? 'wallet' : 'token', address);
    await ctx.reply(`Watching ${short(address)} on chain ${chainId}. You will get every alert involving it.`);
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
    await ctx.reply(items.map((i) => `• [${i.kind}] ${i.address} (chain ${i.chain_id})`).join('\n'));
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
