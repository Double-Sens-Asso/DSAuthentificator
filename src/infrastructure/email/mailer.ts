// deno-lint-ignore-file no-import-prefix no-unversioned-import
import nodemailer from "npm:nodemailer";
import { CONFIG } from "../../config/config.ts";
import { renderEmail } from "./template.ts";

const transporter = nodemailer.createTransport({
  host: CONFIG.SMTP_HOST,
  port: CONFIG.SMTP_PORT,
  secure: false,
  auth: {
    user: CONFIG.SMTP_USER,
    pass: CONFIG.SMTP_PASS,
  },
});

export interface SendResult {
  ok: boolean;
  error?: string;
}

/** Envoie le code de vérification OTP par e-mail (SMTP). */
export async function sendVerificationCode(email: string, code: string): Promise<SendResult> {
  const ttlMinutes = Math.round(CONFIG.OTP_TTL_SECONDS / 60);
  try {
    await transporter.sendMail({
      from: `"Bot Adhésion" <${CONFIG.SMTP_FROM}>`,
      to: email,
      subject: "🔐 Ton code de vérification Discord",
      text: `Voici ton code : ${code}. Valable ${ttlMinutes} minutes.`,
      html: renderEmail(code, ttlMinutes),
    });
    console.log(`📧 Email envoyé à ${email}`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("❌ Erreur envoi email :", e);
    return { ok: false, error: msg };
  }
}
