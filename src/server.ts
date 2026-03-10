import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config";
import { pool } from "./db/pool";
import { trialRoutes } from "./routes/trial.routes";
import { AppError } from "./utils/errors";
import { loggerConfig } from "./utils/logger";
import { createRedisConnection } from "./utils/redis";

const redisForRateLimit = createRedisConnection();

const app = Fastify({
  logger: loggerConfig,
  trustProxy: config.trustProxy,
});

app.register(helmet, {
  contentSecurityPolicy: false,
});

app.register(cors, {
  origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(",").map((s) => s.trim()),
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

app.register(rateLimit, {
  max: config.rateLimitMax,
  timeWindow: config.rateLimitWindow,
  redis: redisForRateLimit,
  skipOnError: false,
});

app.get("/health", async () => ({ ok: true, uptime: process.uptime() }));

app.register(async (trialScope) => {
  trialScope.register(trialRoutes, { prefix: "/api/trial" });
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof AppError) {
    reply.code(error.statusCode).send({
      error: error.code,
      message: error.message,
    });
    return;
  }

  if ((error as { validation?: unknown }).validation) {
    const validationMessage = error instanceof Error ? error.message : "Invalid request payload";
    reply.code(400).send({
      error: "VALIDATION_ERROR",
      message: validationMessage,
    });
    return;
  }

  app.log.error({ err: error }, "Unhandled error");
  reply.code(500).send({
    error: "INTERNAL_SERVER_ERROR",
    message: "Internal server error",
  });
});

app.setNotFoundHandler((_req, reply) => {
  reply.code(404).send({
    error: "NOT_FOUND",
    message: "Route not found",
  });
});

async function start(): Promise<void> {
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    app.log.info(`Server listening on port ${config.port}`);
  } catch (error) {
    app.log.error(error, "Failed to start server");
    process.exit(1);
  }
}

async function shutdown(): Promise<void> {
  await app.close();
  await redisForRateLimit.quit();
  await pool.end();
}

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});

void start();
