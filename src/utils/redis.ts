import IORedis from "ioredis";
import { config } from "../config";

export function createRedisConnection(): IORedis {
  return new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
  });
}

