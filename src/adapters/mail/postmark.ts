// ============================================================
// herald — src/adapters/mail/postmark.ts
// Postmark mail adapter (uses Postmark REST API directly)
// No additional dependencies required.
// ============================================================

import type { HeraldMailAdapter } from "../../types/index.js"

export function createPostmarkAdapter(serverToken: string): HeraldMailAdapter {
  return {
    async send(input) {
      try {
        const res = await fetch("https://api.postmarkapp.com/email", {
          method: "POST",
          headers: {
            "Accept":                   "application/json",
            "Content-Type":             "application/json",
            "X-Postmark-Server-Token":  serverToken,
          },
          body: JSON.stringify({
            From:          input.from,
            To:            input.to,
            Subject:       input.subject,
            HtmlBody:      input.html,
            TextBody:      input.text,
            MessageStream: "outbound",
          }),
        })
        const data = await res.json() as { MessageID?: string; Message?: string }
        if (!res.ok) return { error: data.Message ?? `Postmark error: ${res.status}` }
        return { id: data.MessageID }
      } catch (err: any) {
        return { error: err?.message ?? "Postmark error" }
      }
    },
  }
}
