import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis };

function createRedis() {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not configured");
  }
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  });
}

export function getRedis() {
  const redis = globalForRedis.redis ?? createRedis();
  if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;
  return redis;
}

export async function withRedisLock<T>(
  key: string,
  ttlMs: number,
  work: (assertHeld: () => Promise<void>) => Promise<T>,
): Promise<T | null> {
  const redis = getRedis();
  const token = crypto.randomUUID();
  const acquired = await redis.set(key, token, "PX", ttlMs, "NX");
  if (!acquired) return null;

  let lost = false;
  const renew = async () => {
    const renewed = await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
      1,
      key,
      token,
      ttlMs,
    );
    if (Number(renewed) !== 1) lost = true;
  };
  const assertHeld = async () => {
    if (lost) throw new Error("REDIS_LOCK_LOST");
    const current = await redis.get(key);
    if (current !== token) {
      lost = true;
      throw new Error("REDIS_LOCK_LOST");
    }
  };
  const timer = setInterval(() => {
    void renew().catch(() => {
      lost = true;
    });
  }, Math.max(1_000, Math.floor(ttlMs / 3)));
  timer.unref();

  try {
    const result = await work(assertHeld);
    await assertHeld();
    return result;
  } finally {
    clearInterval(timer);
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      token,
    ).catch(() => undefined);
  }
}
