export interface RateLimitResult {
  readonly allowed: boolean;
  readonly reason: string | null;
  readonly remainingGlobal: number;
  readonly remainingUser: number;
}

export interface RateLimiter {
  consume(userKey: string, nowDate?: Date): Promise<RateLimitResult>;
}

export interface KvStoreLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

const ONE_DAY_PLUS_BUFFER_SECONDS = 60 * 60 * 26;

export class KvDailyRateLimiter implements RateLimiter {
  constructor(
    private readonly kv: KvStoreLike,
    private readonly globalLimit: number,
    private readonly perUserLimit: number,
  ) {}

  async consume(userKey: string, nowDate = new Date()): Promise<RateLimitResult> {
    const dayKey = nowDate.toISOString().slice(0, 10);
    const globalKey = `rl:global:${dayKey}`;
    const userCounterKey = `rl:user:${userKey}:${dayKey}`;

    const [globalRaw, userRaw] = await Promise.all([
      this.kv.get(globalKey),
      this.kv.get(userCounterKey),
    ]);

    const globalCount = Number.parseInt(globalRaw ?? "0", 10) || 0;
    const userCount = Number.parseInt(userRaw ?? "0", 10) || 0;

    if (globalCount >= this.globalLimit) {
      return {
        allowed: false,
        reason: "今日全站查詢額度已達上限，請明日再試。",
        remainingGlobal: 0,
        remainingUser: Math.max(this.perUserLimit - userCount, 0),
      };
    }

    if (userCount >= this.perUserLimit) {
      return {
        allowed: false,
        reason: "今日個人查詢額度已達上限，請明日再試。",
        remainingGlobal: Math.max(this.globalLimit - globalCount, 0),
        remainingUser: 0,
      };
    }

    await Promise.all([
      this.kv.put(globalKey, String(globalCount + 1), {
        expirationTtl: ONE_DAY_PLUS_BUFFER_SECONDS,
      }),
      this.kv.put(userCounterKey, String(userCount + 1), {
        expirationTtl: ONE_DAY_PLUS_BUFFER_SECONDS,
      }),
    ]);

    return {
      allowed: true,
      reason: null,
      remainingGlobal: Math.max(this.globalLimit - (globalCount + 1), 0),
      remainingUser: Math.max(this.perUserLimit - (userCount + 1), 0),
    };
  }
}
