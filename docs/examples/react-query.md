# React Query (TanStack Query)

**Pros**: caching, background refetch, devtools, deduplication out of the box  
**Cons**: requires `@tanstack/react-query` in your project

```tsx
// hooks/use-herald.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

const QUERY_KEY = ["herald", "notifications"]

async function fetchNotifications() {
  const res  = await fetch("/api/herald/notifications")
  const data = await res.json()
  return data.notifications as Notification[]
}

export function useHerald() {
  const queryClient = useQueryClient()

  const { data: notifications = [], isLoading } = useQuery({
    queryKey:        QUERY_KEY,
    queryFn:         fetchNotifications,
    refetchInterval: 30_000,
  })

  const unreadCount = notifications.filter((n) => !n.readAt).length

  const markRead = useMutation({
    mutationFn: (id: string) =>
      fetch("/api/herald/read", {
        method:  "POST",
        body:    JSON.stringify({ id }),
        headers: { "Content-Type": "application/json" },
      }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY })
      const previous = queryClient.getQueryData(QUERY_KEY)
      queryClient.setQueryData(QUERY_KEY, (old: Notification[]) =>
        old.map((n) => (n.id === id ? { ...n, readAt: new Date() } : n))
      )
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      queryClient.setQueryData(QUERY_KEY, ctx?.previous)
    },
  })

  const markAllRead = useMutation({
    mutationFn: () => fetch("/api/herald/read-all", { method: "POST" }),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  })

  return {
    notifications,
    unreadCount,
    isLoading,
    markRead:    (id: string) => markRead.mutate(id),
    markAllRead: () => markAllRead.mutate(),
  }
}
```
