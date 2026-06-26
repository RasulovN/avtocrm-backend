import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.EMAIL_HOST,
      port: env.EMAIL_PORT,
      secure: env.EMAIL_PORT === 465,
      requireTLS: env.EMAIL_USE_TLS,
      auth: { user: env.EMAIL_HOST_USER, pass: env.EMAIL_HOST_PASSWORD },
    });
  }
  return transporter;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}): Promise<void> {
  await getTransporter().sendMail({
    from: env.DEFAULT_FROM_EMAIL,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}
