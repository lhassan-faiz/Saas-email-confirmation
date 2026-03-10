import Fastify from "fastify";
import { z } from "zod";

const app = Fastify({ logger: true });

const baseSchema = z.object({
  action: z.string(),
  type: z.string(),
  api_key: z.string().min(1),
});

const userCreateSchema = baseSchema.extend({
  action: z.literal("user"),
  type: z.literal("create"),
  package_id: z.string().min(1),
  template_id: z.string().optional(),
  note: z.string().optional(),
  country: z.string().optional(),
});

const magCreateSchema = baseSchema.extend({
  action: z.literal("mag"),
  type: z.literal("create"),
  mac: z.string().min(1),
  package_id: z.string().min(1),
  template_id: z.string().optional(),
  note: z.string().optional(),
  country: z.string().optional(),
});

const listSchema = baseSchema.extend({
  action: z.enum(["templates", "packages"]),
  type: z.literal("list"),
});

function randomCred(size = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < size; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

app.get("/", async (request, reply) => {
  const query = request.query as Record<string, string | undefined>;
  const base = baseSchema.safeParse(query);
  if (!base.success) {
    return reply.code(400).send([{ status: false, message: "invalid query or api_key" }]);
  }

  const list = listSchema.safeParse(query);
  if (list.success) {
    if (list.data.action === "templates") {
      return reply.send([
        { status: true, id: "1", title: "LITE" },
        { status: true, id: "2", title: "ARABIC" },
      ]);
    }

    return reply.send([
      { id: "1", name: "PACK TEST 24H", credits: "0", duration: "24", duration_in: "hours", connections: "1" },
      { id: "2", name: "PACK 1M", credits: "1", duration: "1", duration_in: "months", connections: "1" },
    ]);
  }

  const userCreate = userCreateSchema.safeParse(query);
  if (userCreate.success) {
    const username = randomCred(8);
    const password = randomCred(8);
    const dns = "mock.drm-cloud.local";
    const port = "8080";

    return reply.send([
      {
        status: true,
        message: "Add Line success",
        note: userCreate.data.note ?? "",
        country: userCreate.data.country ?? "ALL",
        user_id: "1",
        username,
        password,
        dns,
        port,
        url: `http://${dns}:${port}/get.php?username=${username}&password=${password}&type=m3u_plus&output=ts`,
      },
    ]);
  }

  const magCreate = magCreateSchema.safeParse(query);
  if (magCreate.success) {
    return reply.send([
      {
        status: true,
        message: "Add Mag success",
        user_id: "1",
        note: magCreate.data.note ?? "",
        country: magCreate.data.country ?? "ALL",
        mac: magCreate.data.mac,
        portal: "http://mock.drm-cloud.local:8080/c",
      },
    ]);
  }

  return reply.code(400).send([{ status: false, message: "unsupported action/type" }]);
});

const port = Number(process.env.MOCK_IPTV_PORT ?? 4000);

app
  .listen({ host: "0.0.0.0", port })
  .then(() => {
    app.log.info(`Mock DRM API listening on ${port}`);
  })
  .catch((error) => {
    app.log.error(error, "Failed to start mock DRM API");
    process.exit(1);
  });

