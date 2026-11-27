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
  private pending: Promise<unknown> = Promise.resolve();
  private activeDayKey: string | null = null;
  private readonly localCounts = new Map<string, number>();

  constructor(
    private readonly kv: KvStoreLike,
    private readonly globalLimit: number,
    private readonly perUserLimit: number,
  ) {}

  consume(userKey: string, nowDate = new Date()): Promise<RateLimitResult> {
    const run = this.pending.then(
      () => this.consumeSerialized(userKey, nowDate),
      () => this.consumeSerialized(userKey, nowDate),
    );
    this.pending = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async consumeSerialized(userKey: string, nowDate: Date): Promise<RateLimitResult> {
    const dayKey = nowDate.toISOString().slice(0, 10);
    if (this.activeDayKey !== dayKey) {
      this.activeDayKey = dayKey;
      this.localCounts.clear();
    }

    const globalKey = `rl:global:${dayKey}`;
    const userCounterKey = `rl:user:${userKey}:${dayKey}`;

    const [globalRaw, userRaw] = await Promise.all([
      this.kv.get(globalKey),
      this.kv.get(userCounterKey),
    ]);

    const kvGlobalCount = Number.parseInt(globalRaw ?? "0", 10) || 0;
    const kvUserCount = Number.parseInt(userRaw ?? "0", 10) || 0;
    const globalCount = Math.max(kvGlobalCount, this.localCounts.get(globalKey) ?? 0);
    const userCount = Math.max(kvUserCount, this.localCounts.get(userCounterKey) ?? 0);

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

    const nextGlobal = globalCount + 1;
    const nextUser = userCount + 1;
    this.localCounts.set(globalKey, nextGlobal);
    this.localCounts.set(userCounterKey, nextUser);

    await Promise.all([
      this.kv.put(globalKey, String(nextGlobal), {
        expirationTtl: ONE_DAY_PLUS_BUFFER_SECONDS,
      }),
      this.kv.put(userCounterKey, String(nextUser), {
        expirationTtl: ONE_DAY_PLUS_BUFFER_SECONDS,
      }),
    ]);

    return {
      allowed: true,
      reason: null,
      remainingGlobal: Math.max(this.globalLimit - nextGlobal, 0),
      remainingUser: Math.max(this.perUserLimit - nextUser, 0),
    };
  }
}
