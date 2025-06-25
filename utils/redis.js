import { Redis } from "@upstash/redis";

class RedisService {
  constructor() {
    this.redis = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.initializeRedis();
  }

  initializeRedis() {
    try {
      if (
        !process.env.UPSTASH_REDIS_REST_URL ||
        !process.env.UPSTASH_REDIS_REST_TOKEN
      ) {
        throw new Error(
          "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN environment variables are required"
        );
      }

      this.redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
        retry: {
          retries: 3,
          delay: (attempt) => Math.min(attempt * 50, 500),
        },
      });

      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log("Redis connection initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Redis connection", error);
      this.isConnected = false;
      this.handleReconnect();
    }
  }

  async handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(
        "Max reconnection attempts reached. Redis service disabled."
      );
      return;
    }

    this.reconnectAttempts++;
    console.log(
      `Attempting to reconnect to Redis (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
    );

    setTimeout(() => {
      this.initializeRedis();
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  async healthCheck() {
    try {
      if (!this.isConnected) return false;
      await this.redis.ping();
      return true;
    } catch (error) {
      console.error("Redis health check failed:", error);
      this.isConnected = false;
      this.handleReconnect();
      return false;
    }
  }

  async get(key) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping get operation");
        return null;
      }
      return await this.redis.get(key);
    } catch (error) {
      console.error(`Redis GET error for key ${key}:`, error);
      this.isConnected = false;
      return null;
    }
  }

  async set(key, value, options = {}) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping set operation");
        return false;
      }

      if (options.ex) {
        await this.redis.set(key, value, { ex: options.ex });
      } else if (options.px) {
        await this.redis.set(key, value, { px: options.px });
      } else if (options.nx) {
        await this.redis.set(key, value, { nx: true });
      } else {
        await this.redis.set(key, value);
      }
      return true;
    } catch (error) {
      console.error(`Redis SET error for key ${key}:`, error);
      this.isConnected = false;
      return false;
    }
  }

  async setex(key, seconds, value) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping setex operation");
        return false;
      }
      await this.redis.setex(key, seconds, value);
      return true;
    } catch (error) {
      console.error(`Redis SETEX error for key ${key}:`, error);
      this.isConnected = false;
      return false;
    }
  }

  async getJSON(key) {
    try {
      const data = await this.get(key);
      if (!data) return null;

      if (typeof data === "string") {
        return JSON.parse(data);
      } else if (typeof data === "object") {
        return data;
      }
      return null;
    } catch (error) {
      console.error(`Redis getJSON error for key ${key}:`, error);
      await this.del(key);
      return null;
    }
  }

  async setJSON(key, value, options = {}) {
    try {
      const serialized = JSON.stringify(value);
      return await this.set(key, serialized, options);
    } catch (error) {
      console.error(`Redis setJSON error for key ${key}:`, error);
      return false;
    }
  }

  async del(key) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping delete operation");
        return false;
      }
      await this.redis.del(key);
      return true;
    } catch (error) {
      console.error(`Redis DEL error for key ${key}:`, error);
      this.isConnected = false;
      return false;
    }
  }

  async delPattern(pattern) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping delete pattern operation");
        return false;
      }
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      return true;
    } catch (error) {
      console.error(`Redis DEL pattern error for pattern ${pattern}:`, error);
      return false;
    }
  }

  async exists(key) {
    try {
      if (!this.isConnected) {
        return false;
      }
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      console.error(`Redis EXISTS error for key ${key}:`, error);
      return false;
    }
  }

  async incr(key) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping increment operation");
        return null;
      }
      return await this.redis.incr(key);
    } catch (error) {
      console.error(`Redis INCR error for key ${key}:`, error);
      this.isConnected = false;
      return null;
    }
  }

  async incrby(key, increment) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping incrby operation");
        return null;
      }
      return await this.redis.incrby(key, increment);
    } catch (error) {
      console.error(`Redis INCRBY error for key ${key}:`, error);
      return null;
    }
  }

  async decr(key) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping decrement operation");
        return null;
      }
      return await this.redis.decr(key);
    } catch (error) {
      console.error(`Redis DECR error for key ${key}:`, error);
      return null;
    }
  }

  async expire(key, seconds) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping expire operation");
        return false;
      }
      await this.redis.expire(key, seconds);
      return true;
    } catch (error) {
      console.error(`Redis EXPIRE error for key ${key}:`, error);
      return false;
    }
  }

  async expireat(key, timestamp) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping expireat operation");
        return false;
      }
      await this.redis.expireat(key, timestamp);
      return true;
    } catch (error) {
      console.error(`Redis EXPIREAT error for key ${key}:`, error);
      return false;
    }
  }

  async hget(key, field) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping hget operation");
        return null;
      }
      return await this.redis.hget(key, field);
    } catch (error) {
      console.error(`Redis HGET error for key ${key}, field ${field}:`, error);
      return null;
    }
  }

  async hset(key, field, value) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping hset operation");
        return false;
      }
      await this.redis.hset(key, { [field]: value });
      return true;
    } catch (error) {
      console.error(`Redis HSET error for key ${key}, field ${field}:`, error);
      return false;
    }
  }

  async hmset(key, obj) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping hmset operation");
        return false;
      }
      await this.redis.hset(key, obj);
      return true;
    } catch (error) {
      console.error(`Redis HMSET error for key ${key}:`, error);
      return false;
    }
  }

  async hgetall(key) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping hgetall operation");
        return {};
      }
      return await this.redis.hgetall(key);
    } catch (error) {
      console.error(`Redis HGETALL error for key ${key}:`, error);
      return {};
    }
  }

  async hdel(key, field) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping hdel operation");
        return false;
      }
      await this.redis.hdel(key, field);
      return true;
    } catch (error) {
      console.error(`Redis HDEL error for key ${key}, field ${field}:`, error);
      return false;
    }
  }

  async hexists(key, field) {
    try {
      if (!this.isConnected) {
        return false;
      }
      const result = await this.redis.hexists(key, field);
      return result === 1;
    } catch (error) {
      console.error(
        `Redis HEXISTS error for key ${key}, field ${field}:`,
        error
      );
      return false;
    }
  }

  async sadd(key, ...members) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping sadd operation");
        return false;
      }
      await this.redis.sadd(key, ...members);
      return true;
    } catch (error) {
      console.error(`Redis SADD error for key ${key}:`, error);
      return false;
    }
  }

  async srem(key, ...members) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping srem operation");
        return false;
      }
      await this.redis.srem(key, ...members);
      return true;
    } catch (error) {
      console.error(`Redis SREM error for key ${key}:`, error);
      return false;
    }
  }

  async smembers(key) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping smembers operation");
        return [];
      }
      return await this.redis.smembers(key);
    } catch (error) {
      console.error(`Redis SMEMBERS error for key ${key}:`, error);
      return [];
    }
  }

  async sismember(key, member) {
    try {
      if (!this.isConnected) {
        return false;
      }
      const result = await this.redis.sismember(key, member);
      return result === 1;
    } catch (error) {
      console.error(
        `Redis SISMEMBER error for key ${key}, member ${member}:`,
        error
      );
      return false;
    }
  }

  async scard(key) {
    try {
      if (!this.isConnected) {
        return 0;
      }
      return await this.redis.scard(key);
    } catch (error) {
      console.error(`Redis SCARD error for key ${key}:`, error);
      return 0;
    }
  }

  async sunion(...keys) {
    try {
      if (!this.isConnected) {
        return [];
      }
      return await this.redis.sunion(...keys);
    } catch (error) {
      console.error(`Redis SUNION error for keys ${keys.join(", ")}:`, error);
      return [];
    }
  }

  async sinter(...keys) {
    try {
      if (!this.isConnected) {
        return [];
      }
      return await this.redis.sinter(...keys);
    } catch (error) {
      console.error(`Redis SINTER error for keys ${keys.join(", ")}:`, error);
      return [];
    }
  }

  async lpush(key, ...values) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping lpush operation");
        return false;
      }
      await this.redis.lpush(key, ...values);
      return true;
    } catch (error) {
      console.error(`Redis LPUSH error for key ${key}:`, error);
      return false;
    }
  }

  async rpush(key, ...values) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping rpush operation");
        return false;
      }
      await this.redis.rpush(key, ...values);
      return true;
    } catch (error) {
      console.error(`Redis RPUSH error for key ${key}:`, error);
      return false;
    }
  }

  async lpop(key) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping lpop operation");
        return null;
      }
      return await this.redis.lpop(key);
    } catch (error) {
      console.error(`Redis LPOP error for key ${key}:`, error);
      return null;
    }
  }

  async rpop(key) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping rpop operation");
        return null;
      }
      return await this.redis.rpop(key);
    } catch (error) {
      console.error(`Redis RPOP error for key ${key}:`, error);
      return null;
    }
  }

  async lrange(key, start, stop) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping lrange operation");
        return [];
      }
      return await this.redis.lrange(key, start, stop);
    } catch (error) {
      console.error(`Redis LRANGE error for key ${key}:`, error);
      return [];
    }
  }

  async llen(key) {
    try {
      if (!this.isConnected) {
        return 0;
      }
      return await this.redis.llen(key);
    } catch (error) {
      console.error(`Redis LLEN error for key ${key}:`, error);
      return 0;
    }
  }

  async ltrim(key, start, stop) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping ltrim operation");
        return false;
      }
      await this.redis.ltrim(key, start, stop);
      return true;
    } catch (error) {
      console.error(`Redis LTRIM error for key ${key}:`, error);
      return false;
    }
  }

  async zadd(key, score, member, ...args) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping zadd operation");
        return false;
      }
      await this.redis.zadd(key, { score, member }, ...args);
      return true;
    } catch (error) {
      console.error(`Redis ZADD error for key ${key}:`, error);
      return false;
    }
  }

  async zrem(key, ...members) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping zrem operation");
        return false;
      }
      await this.redis.zrem(key, ...members);
      return true;
    } catch (error) {
      console.error(`Redis ZREM error for key ${key}:`, error);
      return false;
    }
  }

  async zremrangebyscore(key, min, max) {
    try {
      if (!this.isConnected) {
        console.warn(
          "Redis not connected, skipping zremrangebyscore operation"
        );
        return false;
      }
      await this.redis.zremrangebyscore(key, min, max);
      return true;
    } catch (error) {
      console.error(`Redis ZREMRANGEBYSCORE error for key ${key}:`, error);
      return false;
    }
  }

  async zrange(key, start, stop, options = {}) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping zrange operation");
        return [];
      }
      return await this.redis.zrange(key, start, stop, options);
    } catch (error) {
      console.error(`Redis ZRANGE error for key ${key}:`, error);
      return [];
    }
  }

  async zrevrange(key, start, stop, options = {}) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping zrevrange operation");
        return [];
      }
      return await this.redis.zrevrange(key, start, stop, options);
    } catch (error) {
      console.error(`Redis ZREVRANGE error for key ${key}:`, error);
      return [];
    }
  }

  async zcard(key) {
    try {
      if (!this.isConnected) {
        return 0;
      }
      return await this.redis.zcard(key);
    } catch (error) {
      console.error(`Redis ZCARD error for key ${key}:`, error);
      return 0;
    }
  }

  async zscore(key, member) {
    try {
      if (!this.isConnected) {
        return null;
      }
      return await this.redis.zscore(key, member);
    } catch (error) {
      console.error(
        `Redis ZSCORE error for key ${key}, member ${member}:`,
        error
      );
      return null;
    }
  }

  async zrank(key, member) {
    try {
      if (!this.isConnected) {
        return null;
      }
      return await this.redis.zrank(key, member);
    } catch (error) {
      console.error(
        `Redis ZRANK error for key ${key}, member ${member}:`,
        error
      );
      return null;
    }
  }

  async ttl(key) {
    try {
      if (!this.isConnected) {
        return -1;
      }
      return await this.redis.ttl(key);
    } catch (error) {
      console.error(`Redis TTL error for key ${key}:`, error);
      return -1;
    }
  }

  async pttl(key) {
    try {
      if (!this.isConnected) {
        return -1;
      }
      return await this.redis.pttl(key);
    } catch (error) {
      console.error(`Redis PTTL error for key ${key}:`, error);
      return -1;
    }
  }

  async flushall() {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping flushall operation");
        return false;
      }
      await this.redis.flushall();
      return true;
    } catch (error) {
      console.error("Redis FLUSHALL error:", error);
      return false;
    }
  }

  async keys(pattern) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping keys operation");
        return [];
      }
      return await this.redis.keys(pattern);
    } catch (error) {
      console.error(`Redis KEYS error for pattern ${pattern}:`, error);
      return [];
    }
  }

  async scan(cursor = 0, options = {}) {
    try {
      if (!this.isConnected) {
        return { cursor: 0, keys: [] };
      }
      return await this.redis.scan(cursor, options);
    } catch (error) {
      console.error(`Redis SCAN error:`, error);
      return { cursor: 0, keys: [] };
    }
  }

  async pipeline() {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, pipeline not available");
        return null;
      }
      return this.redis.pipeline();
    } catch (error) {
      console.error("Redis PIPELINE error:", error);
      return null;
    }
  }

  async multi() {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, multi not available");
        return null;
      }
      return this.redis.multi();
    } catch (error) {
      console.error("Redis MULTI error:", error);
      return null;
    }
  }

  async eval(script, keys = [], args = []) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping eval operation");
        return null;
      }
      return await this.redis.eval(script, keys, args);
    } catch (error) {
      console.error("Redis EVAL error:", error);
      return null;
    }
  }

  async mget(...keys) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping mget operation");
        return [];
      }
      return await this.redis.mget(...keys);
    } catch (error) {
      console.error(`Redis MGET error for keys ${keys.join(", ")}:`, error);
      return [];
    }
  }

  async mset(obj) {
    try {
      if (!this.isConnected) {
        console.warn("Redis not connected, skipping mset operation");
        return false;
      }
      await this.redis.mset(obj);
      return true;
    } catch (error) {
      console.error("Redis MSET error:", error);
      return false;
    }
  }

  async setCache(key, data, ttl = 3600) {
    return await this.setJSON(key, data, { ex: ttl });
  }

  async getCache(key) {
    return await this.getJSON(key);
  }

  async invalidateCache(pattern) {
    return await this.delPattern(pattern);
  }

  async acquireLock(key, ttl = 60, retries = 3) {
    const lockKey = `lock:${key}`;
    const lockValue = `${Date.now()}-${Math.random()}`;

    for (let i = 0; i < retries; i++) {
      const acquired = await this.set(lockKey, lockValue, {
        nx: true,
        ex: ttl,
      });
      if (acquired) {
        return {
          acquired: true,
          lockValue,
          release: () => this.releaseLock(lockKey, lockValue),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (i + 1)));
    }

    return { acquired: false, lockValue: null, release: () => false };
  }

  async releaseLock(lockKey, lockValue) {
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;
    return await this.eval(script, [lockKey], [lockValue]);
  }

  async rateLimitCheck(key, limit, window) {
    try {
      const current = await this.redis.get(key);
      const count = current ? parseInt(current) : 0;

      if (count >= limit) {
        const ttl = await this.redis.ttl(key);
        return {
          allowed: false,
          remaining: 0,
          resetTime: ttl > 0 ? ttl : window,
        };
      }

      if (count === 0) {
        await this.redis.setex(key, window, 1);
      } else {
        await this.redis.incr(key);
      }

      return {
        allowed: true,
        remaining: Math.max(0, limit - count - 1),
        resetTime: window,
      };
    } catch (error) {
      console.error("Rate limit check failed:", error);
      return {
        allowed: true,
        remaining: limit - 1,
        resetTime: window,
      };
    }
  }

  async addToQueue(queueName, item, priority = 0) {
    const queueKey = `queue:${queueName}`;
    const itemData = JSON.stringify({ ...item, timestamp: Date.now() });
    return await this.zadd(queueKey, priority, itemData);
  }

  async getFromQueue(queueName, count = 1) {
    const queueKey = `queue:${queueName}`;
    const items = await this.zrevrange(queueKey, 0, count - 1);

    if (items.length > 0) {
      await this.zrem(queueKey, ...items);
      return items.map((item) => JSON.parse(item));
    }

    return [];
  }

  async getQueueLength(queueName) {
    const queueKey = `queue:${queueName}`;
    return await this.zcard(queueKey);
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      url: process.env.UPSTASH_REDIS_REST_URL ? "configured" : "not configured",
      token: process.env.UPSTASH_REDIS_REST_TOKEN
        ? "configured"
        : "not configured",
    };
  }
}

const redisService = new RedisService();

setInterval(async () => {
  await redisService.healthCheck();
}, 30000);

export default redisService;
