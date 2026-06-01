# Real-time with Redis pub/sub

**Pros**: works with serverless (Upstash Redis has HTTP mode), fast, widely supported  
**Cons**: requires Redis (Upstash free tier works fine)  
**Best for**: projects already using Redis, or serverless with Upstash

## How it works

1. After a generated event method sends, publish a message to a Redis channel
2. Your SSE route subscribes to that channel and pushes to the browser

## 1. Publish after send

```ts
// lib/herald.ts
import { Redis } from "ioredis";
import { createPrismaAdapter } from "herald/adapters/prisma";
import { heraldApp } from "./herald-app";
import { orderCompleted, commentMentioned } from "./events";

const redis = new Redis(process.env.REDIS_URL!);

export const herald = heraldApp.create({
  db: createPrismaAdapter(prisma),
  events: { orderCompleted, commentMentioned },
  hooks: {
    onDelivered: async (delivery) => {
      await redis.publish(
        `herald:${delivery.userId}`,
        JSON.stringify({ deliveryId: delivery.id }),
      );
    },
  },
});
```

Send through the generated methods, for example `herald.events.orderCompleted(payload)`. The hook above publishes after Herald marks the delivery as accepted.

## 2. SSE route

```ts
// app/api/herald/stream/route.ts
import { Redis } from "ioredis";
import { auth } from "@/lib/auth";
import { herald } from "@/lib/herald";

export async function GET(req: Request) {
  const userId = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const sub = new Redis(process.env.REDIS_URL!);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      await sub.subscribe(`herald:${userId}`);

      sub.on("message", async (_channel, _msg) => {
        const notifications = await herald.getUnreadNotifications(userId);
        send({ notifications });
      });

      req.signal.addEventListener("abort", () => {
        sub.unsubscribe();
        sub.quit();
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

## Upstash (serverless-friendly)

Upstash Redis works over HTTP — no persistent connection needed.  
Use `@upstash/redis` + `@upstash/qstash` as the trigger instead of a long-lived subscriber.
See: https://upstash.com/docs/redis/features/pubsub
