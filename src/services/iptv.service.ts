import axios from "axios";
import { z } from "zod";
import { config } from "../config";
import { TrialType } from "../types/trial";
import { AppError } from "../utils/errors";

const internalProvisionSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  host: z.string().min(1),
  playlistUrl: z.string().url().optional().nullable(),
  expiresAt: z.date().nullable(),
});

const m3uCreateResponseSchema = z.object({
  status: z.union([z.boolean(), z.string()]),
  message: z.string().optional(),
  note: z.string().optional(),
  country: z.string().optional(),
  user_id: z.union([z.string(), z.number()]).optional(),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  dns: z.string().min(1).optional(),
  port: z.union([z.string(), z.number()]).optional(),
  url: z.string().url().optional(),
});

const magCreateResponseSchema = z.object({
  status: z.union([z.boolean(), z.string()]),
  message: z.string().optional(),
  user_id: z.union([z.string(), z.number()]).optional(),
  note: z.string().optional(),
  country: z.string().optional(),
  mac: z.string().optional(),
  portal: z.string().min(1).optional(),
});

const m3uCreateSuccessSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  dns: z.string().min(1),
  port: z.union([z.string(), z.number()]),
  url: z.string().url(),
});

const magCreateSuccessSchema = z.object({
  mac: z.string().optional(),
  portal: z.string().min(1),
});

interface ProvisionTrialInput {
  email: string;
  trialType: TrialType;
  macAddress: string | null;
}

export class IptvService {
  private readonly client = axios.create({
    baseURL: config.iptvApiBaseUrl,
    timeout: 10000,
  });

  async createTrial(payload: ProvisionTrialInput): Promise<z.infer<typeof internalProvisionSchema>> {
    if (!config.iptvApiKey) {
      throw new AppError(500, "IPTV_API_KEY is missing", "IPTV_AUTH_CONFIG_MISSING");
    }
    const note = `${config.iptvNotePrefix} | ${payload.email}`;
    const commonParams: Record<string, string> = {
      type: "create",
      package_id: String(config.iptvPackageId),
      note,
      country: config.iptvCountry,
      api_key: config.iptvApiKey,
    };
    if (config.iptvTemplateId > 0) {
      commonParams.template_id = String(config.iptvTemplateId);
    }

    try {
      if (payload.trialType === "m3u") {
        const raw = await this.callProvider({
          action: "user",
          ...commonParams,
        });
        const data = m3uCreateResponseSchema.parse(raw);
        if (!this.isTruthyStatus(data.status)) {
          throw new AppError(
            502,
            `Failed to provision trial with IPTV provider${data.message ? `: ${data.message}` : ""}`,
            "IPTV_PROVISION_FAILED",
          );
        }

        const success = m3uCreateSuccessSchema.parse(data);
        const host = this.normalizeHttpUrl(`${success.dns}:${String(success.port)}`);
        return internalProvisionSchema.parse({
          username: success.username,
          password: success.password,
          host,
          playlistUrl: success.url,
          expiresAt: new Date(Date.now() + config.iptvTrialDurationHours * 60 * 60 * 1000),
        });
      }

      if (!payload.macAddress) {
        throw new AppError(400, "macAddress is required for MAG trials", "INVALID_MAG_PAYLOAD");
      }

      const raw = await this.callProvider({
        action: "mag",
        mac: payload.macAddress.toUpperCase(),
        ...commonParams,
      });
      const data = magCreateResponseSchema.parse(raw);
      if (!this.isTruthyStatus(data.status)) {
        throw new AppError(
          502,
          `Failed to provision trial with IPTV provider${data.message ? `: ${data.message}` : ""}`,
          "IPTV_PROVISION_FAILED",
        );
      }

      const success = magCreateSuccessSchema.parse(data);
      return internalProvisionSchema.parse({
        username: success.mac ?? payload.macAddress.toUpperCase(),
        password: "N/A",
        host: this.normalizeHttpUrl(success.portal),
        playlistUrl: null,
        expiresAt: new Date(Date.now() + config.iptvTrialDurationHours * 60 * 60 * 1000),
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const providerMessage = this.extractProviderErrorMessage(error.response?.data);
        throw new AppError(
          502,
          `Failed to provision trial with IPTV provider${
            status ? ` (status ${status}${providerMessage ? `: ${providerMessage}` : ""})` : ""
          }`,
          "IPTV_PROVISION_FAILED",
        );
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(502, "Failed to provision trial with IPTV provider", "IPTV_PROVISION_FAILED");
    }
  }

  private async callProvider(params: Record<string, string>): Promise<unknown> {
    const response = await this.client.get("", {
      params,
      headers: {
        Accept: "application/json",
      },
    });
    if (Array.isArray(response.data)) {
      if (response.data.length === 0) {
        throw new AppError(502, "Provider returned empty response", "IPTV_INVALID_RESPONSE");
      }
      return response.data[0];
    }
    if (response.data && typeof response.data === "object") {
      return response.data;
    }
    throw new AppError(502, "Provider returned invalid response format", "IPTV_INVALID_RESPONSE");
  }

  private normalizeHttpUrl(value: string): string {
    if (/^https?:\/\//i.test(value)) {
      return value;
    }
    return `http://${value}`;
  }

  private isTruthyStatus(status: string | boolean): boolean {
    if (typeof status === "boolean") return status;
    return status.toLowerCase() === "true";
  }

  private extractProviderErrorMessage(data: unknown): string | undefined {
    if (typeof data === "string") {
      return data;
    }
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0] as { message?: unknown } | undefined;
      if (first && typeof first.message === "string") {
        return first.message;
      }
    }
    if (data && typeof data === "object") {
      const maybeMessage = (data as { message?: unknown }).message;
      if (typeof maybeMessage === "string") {
        return maybeMessage;
      }
    }
    return undefined;
  }
}
