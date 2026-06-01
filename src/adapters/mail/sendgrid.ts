// ============================================================
// herald — src/adapters/mail/sendgrid.ts
// SendGrid mail adapter
// Requires: npm install @sendgrid/mail
// ============================================================

import type { HeraldMailAdapter } from "../../types/index.js"

export function createSendGridAdapter(apiKey: string): HeraldMailAdapter {
  return {
    async send(input) {
      try {
        const sgMail = await import("@sendgrid/mail").catch(() => {
          throw new Error('[herald] "@sendgrid/mail" not installed. Run: npm install @sendgrid/mail')
        })
        sgMail.default.setApiKey(apiKey)
        const [response] = await sgMail.default.send({
          from:    input.from,
          to:      input.to,
          subject: input.subject,
          html:    input.html,
          text:    input.text,
        })
        const messageId = (response?.headers as any)?.["x-message-id"]
        return { id: messageId }
      } catch (err: any) {
        return { error: err?.message ?? "SendGrid error" }
      }
    },
  }
}
