// ============================================================
// herald — src/adapters/mail/nodemailer.ts
// Nodemailer adapter (SMTP and any Nodemailer transport)
// Requires: npm install nodemailer
// ============================================================

import type { HeraldMailAdapter } from "../../types/index.js"

// Loose type — accepts any Nodemailer transporter without requiring
// nodemailer as a compile-time dependency
export interface NodemailerTransport {
  sendMail(opts: {
    from?:    string
    to:       string
    subject:  string
    html:     string
    text?:    string
  }): Promise<{ messageId?: string }>
}

/**
 * @example
 * import nodemailer from "nodemailer"
 *
 * const transport = nodemailer.createTransport({
 *   host: "smtp.example.com",
 *   port: 587,
 *   auth: { user: "...", pass: "..." },
 * })
 *
 * createNodemailerAdapter(transport)
 */
export function createNodemailerAdapter(
  transport: NodemailerTransport
): HeraldMailAdapter {
  return {
    async send(input) {
      try {
        const info = await transport.sendMail({
          from:    input.from,
          to:      input.to,
          subject: input.subject,
          html:    input.html,
          text:    input.text,
        })
        return { id: info.messageId }
      } catch (err: any) {
        return { error: err?.message ?? "Nodemailer error" }
      }
    },
  }
}
