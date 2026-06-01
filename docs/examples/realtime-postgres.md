# Real-time with Postgres LISTEN/NOTIFY

Push notifications to the browser the moment they are created — no polling.

**Pros**: instant delivery, zero extra infra (uses your existing Postgres)  
**Cons**: requires a persistent Node process (not compatible with Vercel serverless functions)  
**Best for**: Railway, Fly.io, Render, VPS, or any long-running Node server

## How it works

1. Your app calls `herald.events.someEvent(payload)` → Herald writes to DB
2. A DB trigger fires `NOTIFY herald_events, '{"userId":"..."}'`
3. Your persistent Node process receives the notification via `LISTEN`
4. It pushes an SSE event to the matching browser connection

## 1. Add the Postgres trigger

```sql
-- Run once — add to your migration
CREATE OR REPLACE FUNCTION herald_notify_insert()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('herald_events', json_build_object('userId', NEW.user_id)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER herald_after_insert
AFTER INSERT ON herald_notifications
FOR EACH ROW EXECUTE FUNCTION herald_notify_insert();
```

## 2. SSE route with LISTEN

```ts
// app/api/herald/stream/route.ts
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function GET(req: Request) {
  const userId = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const client = await pool.connect();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      await client.query("LISTEN herald_events");

      client.on("notification", async (msg) => {
        const payload = JSON.parse(msg.payload ?? "{}");
        if (payload.userId !== userId) return;
        // fetch fresh notifications and push
        const res = await fetch(
          `${process.env.APP_URL}/api/herald/notifications`,
          {
            headers: { cookie: req.headers.get("cookie") ?? "" },
          },
        );
        const data = await res.json();
        send(data);
      });

      req.signal.addEventListener("abort", () => {
        client.query("UNLISTEN herald_events");
        client.release();
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

## 3. Connect from the browser

```tsx
useEffect(() => {
  const es = new EventSource("/api/herald/stream");
  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    setNotifications(data.notifications);
  };
  return () => es.close();
}, []);
```
