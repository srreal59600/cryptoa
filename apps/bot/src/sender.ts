import type { Telegraf } from 'telegraf';

interface Queued {
  text: string;
  /** Higher wins when the queue overflows (we use the alert's USD size). */
  priority: number;
}

interface SenderOptions {
  /** Minimum spacing between two messages to the same chat. */
  intervalMs: number;
  /** Queue depth per chat; the smallest alerts are dropped beyond it. */
  maxQueue: number;
}

interface RetryAfterError {
  parameters?: { retry_after?: number };
}

function retryAfterSeconds(err: unknown): number | undefined {
  const params = (err as RetryAfterError | undefined)?.parameters;
  return typeof params?.retry_after === 'number' ? params.retry_after : undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Telegram allows roughly 20 messages per minute into a channel, while a busy
 * chain minute can produce far more whale alerts. Messages are therefore
 * queued per chat, paced, and — if the backlog grows — the smallest alerts are
 * dropped so the largest ones still go out promptly.
 */
export class RateLimitedSender {
  private readonly queues = new Map<string, Queued[]>();
  private readonly draining = new Set<string>();

  constructor(
    private readonly bot: Telegraf,
    private readonly opts: SenderOptions,
  ) {}

  enqueue(chatId: string, text: string, priority = 0): void {
    const queue = this.queues.get(chatId) ?? [];
    queue.push({ text, priority });
    queue.sort((a, b) => b.priority - a.priority);
    if (queue.length > this.opts.maxQueue) {
      const dropped = queue.length - this.opts.maxQueue;
      queue.length = this.opts.maxQueue;
      console.warn(`dropped ${dropped} low-value alert(s) for ${chatId}: queue saturated`);
    }
    this.queues.set(chatId, queue);
    void this.drain(chatId);
  }

  /** Sends immediately, bypassing the queue (command replies, admin DMs). */
  async sendNow(chatId: string, text: string): Promise<void> {
    await this.deliver(chatId, text);
  }

  private async drain(chatId: string): Promise<void> {
    if (this.draining.has(chatId)) return;
    this.draining.add(chatId);
    try {
      for (;;) {
        const queue = this.queues.get(chatId);
        const next = queue?.shift();
        if (!next) break;
        await this.deliver(chatId, next.text);
        await sleep(this.opts.intervalMs);
      }
    } finally {
      this.draining.delete(chatId);
    }
  }

  private async deliver(chatId: string, text: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.bot.telegram.sendMessage(chatId, text, {
          parse_mode: 'MarkdownV2',
          link_preview_options: { is_disabled: true },
        });
        return;
      } catch (err) {
        const wait = retryAfterSeconds(err);
        if (wait === undefined) {
          console.error(`sending to ${chatId} failed`, err);
          return;
        }
        await sleep((wait + 1) * 1000);
      }
    }
    console.error(`giving up on ${chatId} after repeated rate limits`);
  }
}
