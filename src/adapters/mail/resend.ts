// ============================================================
// herald — src/adapters/mail/resend.ts
// Resend mail adapter
// Requires: npm install resend
// ============================================================

import type { HeraldMailAdapter } from "../../types/index.js"

export function createResendAdapter(apiKey: string): HeraldMailAdapter {
  return {
    async send(input) {
      try {
        const { Resend } = await import("resend").catch(() => {
          throw new Error('[herald] "resend" not installed. Run: npm install resend')
        })
        const resend = new Resend(apiKey)
        const { data, error } = await resend.emails.send({
          from:    input.from,
          to:      input.to,
          subject: input.subject,
          html:    input.html,
          text:    input.text,
        })
        if (error) return { error: error.message }
        return { id: data?.id }
      } catch (err: any) {
        return { error: err?.message ?? "Resend error" }
      }
    },
  }
}
