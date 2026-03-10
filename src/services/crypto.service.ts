import crypto from "node:crypto";
import { config } from "../config";
import { AppError } from "../utils/errors";

interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export class CryptoService {
  private readonly key: Buffer;

  constructor() {
    this.key = this.parseKey(config.encryptionKey);
  }

  encrypt(plaintext: string): EncryptedPayload {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
    };
  }

  decrypt(payload: EncryptedPayload): string {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(payload.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }

  private parseKey(raw: string): Buffer {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return Buffer.from(raw, "hex");
    }

    const base64 = Buffer.from(raw, "base64");
    if (base64.length === 32) {
      return base64;
    }

    const utf8 = Buffer.from(raw, "utf8");
    if (utf8.length === 32) {
      return utf8;
    }

    throw new AppError(
      500,
      "Invalid ENCRYPTION_KEY. Use 32-byte raw string, 64-char hex, or base64-encoded 32-byte key.",
      "INVALID_ENCRYPTION_KEY",
    );
  }
}

