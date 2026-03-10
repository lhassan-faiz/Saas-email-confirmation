import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { config } from "../config";
import { TrialType } from "../types/trial";

interface VerificationEmailPayload {
  to: string;
  firstName: string;
  otp: string;
  expiresAt: Date;
}

interface CredentialsEmailPayload {
  to: string;
  firstName: string;
  trialType: TrialType;
  username: string;
  password: string;
  host: string;
  playlistUrl: string | null;
  expiresAt: Date;
}

interface HeaderAttachment {
  filename: string;
  path: string;
  cid: string;
}

export class EmailService {
  private readonly headerImageCid = "livetvbox-header";
  private readonly supportEmail = "Contact@livetvbox.de";

  private readonly transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: config.smtpUser
      ? {
          user: config.smtpUser,
          pass: config.smtpPass,
        }
      : undefined,
  });

  async sendVerificationEmail(payload: VerificationEmailPayload): Promise<void> {
    const expiresText = this.formatDate(payload.expiresAt);
    const attachment = this.getHeaderImageAttachment();

    const htmlBody = `
      <p style="margin:0 0 16px 0;color:#2f2a45;font-size:15px;line-height:1.6;">
        Hallo ${this.escape(payload.firstName)},
      </p>
      <p style="margin:0 0 12px 0;color:#2f2a45;font-size:15px;line-height:1.6;">
        Ihr Bestaetigungscode lautet:
      </p>
      <div style="margin:0 0 16px 0;padding:14px;border-radius:10px;background:#f5f0ff;border:1px solid #e2d7ff;text-align:center;">
        <span style="font-size:32px;letter-spacing:5px;font-weight:700;color:#5f2eea;">${this.escape(payload.otp)}</span>
      </div>
      <p style="margin:0 0 16px 0;color:#2f2a45;font-size:14px;line-height:1.6;">
        Der Code ist gueltig bis <strong>${this.escape(expiresText)}</strong>.
      </p>
      <p style="margin:16px 0 0 0;color:#6a6780;font-size:13px;line-height:1.6;">
        Bei Fragen kontaktieren Sie uns unter
        <a href="mailto:${this.supportEmail}" style="color:#6d3cf6;text-decoration:none;">${this.supportEmail}</a>.
      </p>
    `;

    await this.transporter.sendMail({
      from: config.smtpFrom,
      to: payload.to,
      subject: "Bitte bestaetigen Sie Ihre E-Mail",
      text: [
        `Hallo ${payload.firstName},`,
        "",
        `Ihr Bestaetigungscode lautet: ${payload.otp}`,
        `Der Code ist gueltig bis: ${expiresText}`,
        "",
        "Mit freundlichen Gruessen,",
        "LiveTvBox Team",
      ].join("\n"),
      html: this.wrapTemplate("", "Bitte bestaetigen Sie Ihre E-Mail", htmlBody, Boolean(attachment)),
      attachments: attachment ? [attachment] : undefined,
    });
  }

  async sendCredentialsEmail(payload: CredentialsEmailPayload): Promise<void> {
    const expiresText = this.formatDate(payload.expiresAt);
    const attachment = this.getHeaderImageAttachment();
    const isM3u = payload.trialType === "m3u";
    const typeText = isM3u ? "M3U Playlist" : "MAG Device";

    const lines = [
      `Hallo ${payload.firstName},`,
      "",
      "Ihre IPTV-Testdaten sind bereit:",
      `Typ: ${typeText}`,
      isM3u ? `Benutzername: ${payload.username}` : `MAC Adresse: ${payload.username}`,
      isM3u ? `Passwort: ${payload.password}` : "Parent password: 0000",
      isM3u ? `Server / Portal: ${payload.host}` : `Portal URL: ${payload.host}`,
      isM3u && payload.playlistUrl ? `M3U URL: ${payload.playlistUrl}` : null,
      `Ablaufdatum: ${expiresText}`,
      "",
      "Mit freundlichen Gruessen,",
      "LiveTvBox Team",
    ].filter(Boolean) as string[];

    const rows: Array<{ label: string; value: string; link?: string }> = isM3u
      ? [
          { label: "Typ", value: typeText },
          { label: "Benutzername", value: payload.username },
          { label: "Passwort", value: payload.password },
          { label: "Server / Portal", value: payload.host, link: this.ensureHttp(payload.host) },
          { label: "Ablaufdatum", value: expiresText },
          ...(payload.playlistUrl ? [{ label: "M3U URL", value: payload.playlistUrl, link: payload.playlistUrl }] : []),
        ]
      : [
          { label: "Type", value: "MAG Device" },
          { label: "MAC Address", value: payload.username },
          { label: "Portal URL", value: payload.host, link: this.ensureHttp(payload.host) },
          { label: "Parent password", value: "0000" },
          { label: "Ablaufdatum", value: expiresText },
        ];

    const tableRows = rows
      .map((row) => {
        const value = row.link
          ? `<a href="${row.link}" style="color:#6d3cf6;text-decoration:none;word-break:break-all;">${this.escape(row.value)}</a>`
          : this.escape(row.value);
        return `
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #ece6ff;font-weight:600;color:#2f2a45;width:170px;">${this.escape(row.label)}</td>
            <td style="padding:10px 0;border-bottom:1px solid #ece6ff;color:#2f2a45;">${value}</td>
          </tr>
        `;
      })
      .join("");

    const htmlBody = `
      <p style="margin:0 0 14px 0;color:#2f2a45;font-size:15px;line-height:1.6;">
        Hallo ${this.escape(payload.firstName)},<br />
        Ihre IPTV-Testdaten sind jetzt aktiv.
      </p>
      <h3 style="margin:0 0 10px 0;color:#5f2eea;">${isM3u ? "Xtream Codes Zugang" : "Ihre Testinformationen"}</h3>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-bottom:20px;">
        ${tableRows}
      </table>
      <div style="margin:8px 0 18px 0;">
        <a href="mailto:${this.supportEmail}" style="display:inline-block;background:#6d3cf6;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:7px;font-weight:600;">
          Support kontaktieren
        </a>
      </div>
      <p style="margin:0;color:#6a6780;font-size:13px;line-height:1.6;">
        Viel Spass mit Ihrem kostenlosen Test!<br />
        Mit freundlichen Gruessen,<br />
        <strong>LiveTvBox Team</strong>
      </p>
    `;

    await this.transporter.sendMail({
      from: config.smtpFrom,
      to: payload.to,
      subject: "Ihre IPTV-Testdaten sind bereit",
      text: lines.join("\n"),
      html: this.wrapTemplate("LiveTvBox", "Ihre IPTV Testdetails", htmlBody, Boolean(attachment)),
      attachments: attachment ? [attachment] : undefined,
    });
  }

  private wrapTemplate(title: string, subtitle: string, bodyHtml: string, hasHeaderImage: boolean): string {
    const hasTitle = title.trim().length > 0;
    const subtitleFontSize = hasTitle ? "15px" : "30px";
    const subtitleWeight = hasTitle ? "500" : "800";

    return `
      <!doctype html>
      <html>
        <body style="margin:0;padding:0;background:#efedf7;font-family:Arial,Helvetica,sans-serif;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:24px 0;background:#efedf7;">
            <tr>
              <td align="center">
                <table role="presentation" cellpadding="0" cellspacing="0" width="640" style="max-width:640px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;">
                  <tr>
                    <td style="padding:${hasHeaderImage ? "0" : "26px 28px"};background:linear-gradient(130deg,#190f49,#6d3cf6);color:#ffffff;">
                      ${
                        hasHeaderImage
                          ? `<img src="cid:${this.headerImageCid}" alt="${this.escape(title || subtitle)}" style="display:block;width:100%;max-width:640px;height:auto;" />`
                          : `<div style="font-size:34px;font-weight:800;letter-spacing:1px;">${this.escape(title)}</div><div style="margin-top:6px;font-size:15px;opacity:.95;">${this.escape(subtitle)}</div>`
                      }
                    </td>
                  </tr>
                  ${
                    hasHeaderImage
                      ? `<tr><td style="padding:16px 28px 0 28px;background:#ffffff;">${
                          hasTitle
                            ? `<div style="font-size:30px;font-weight:800;letter-spacing:0.4px;color:#2b1a73;">${this.escape(title)}</div>`
                            : ""
                        }<div style="margin-top:${hasTitle ? "6px" : "2px"};font-size:${subtitleFontSize};font-weight:${subtitleWeight};color:#2b1a73;">${this.escape(subtitle)}</div></td></tr>`
                      : ""
                  }
                  <tr>
                    <td style="padding:28px;">
                      ${bodyHtml}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:14px 28px;background:#f7f3ff;color:#7b739f;font-size:12px;">
                      (c) ${new Date().getFullYear()} LiveTvBox. Alle Rechte vorbehalten.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;
  }

  private getHeaderImageAttachment(): HeaderAttachment | undefined {
    const candidates = [
      path.resolve(process.cwd(), "src/assets/livetvbox_singanture.png"),
      path.resolve(process.cwd(), "dist/assets/livetvbox_singanture.png"),
      path.resolve(__dirname, "../assets/livetvbox_singanture.png"),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return {
          filename: "livetvbox-header.png",
          path: candidate,
          cid: this.headerImageCid,
        };
      }
    }

    return undefined;
  }

  private ensureHttp(value: string): string {
    if (/^https?:\/\//i.test(value)) {
      return value;
    }
    return `http://${value}`;
  }

  private formatDate(value: Date): string {
    return new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
      hour12: false,
      timeZone: "Europe/Berlin",
    }).format(value);
  }

  private escape(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
