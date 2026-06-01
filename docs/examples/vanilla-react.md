# Vanilla React hook

No external dependencies. Copy and adapt to your project.

**Pros**: zero deps, full control over state shape and fetch logic  
**Cons**: you manage loading/error states manually, no caching

```tsx
// hooks/use-herald.ts
import { useState, useEffect, useCallback } from "react"

interface Notification {
  id: string
  title: string
  body?: string | null
  href?: string | null
  readAt: Date | null
  createdAt: Date
}

interface UseHeraldOptions {
  /** How often to poll for new notifications, in ms. Default: 30000 */
  pollingInterval?: number
}

export function useHerald(options: UseHeraldOptions = {}) {
  const { pollingInterval = 30_000 } = options

  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading]             = useState(true)

  const unreadCount = notifications.filter((n) => !n.readAt).length

  const refresh = useCallback(async () => {
    const res  = await fetch("/api/herald/notifications")
    const data = await res.json()
    setNotifications(data.notifications)
    setLoading(false)
  }, [])

  const markRead = useCallback(async (id: string) => {
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: new Date() } : n))
    )
    await fetch("/api/herald/read", {
      method: "POST",
      body:   JSON.stringify({ id }),
      headers: { "Content-Type": "application/json" },
    })
  }, [])

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date() })))
    await fetch("/api/herald/read-all", { method: "POST" })
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, pollingInterval)
    return () => clearInterval(interval)
  }, [refresh, pollingInterval])

  return { notifications, unreadCount, loading, markRead, markAllRead, refresh }
}
```

```tsx
// app/api/herald/notifications/route.ts  (Next.js App Router example)
import { herald } from "@/lib/herald"
import { auth }   from "@/lib/auth"

export async function GET() {
  const userId = await auth()
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const notifications = await herald.getNotifications(userId)
  return Response.json({ notifications })
}
```
