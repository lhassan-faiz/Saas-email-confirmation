function canUsePinoPretty(): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  try {
    require.resolve("pino-pretty");
    return true;
  } catch {
    return false;
  }
}

export const loggerConfig = {
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  ...(canUsePinoPretty()
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
};
