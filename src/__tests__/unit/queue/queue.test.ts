import { describe, it, expect, vi } from "vitest";
import {
	createSyncDriver,
	createQueue,
	calculateBackoff,
	createDbDriver,
} from "../../../queue/index.js";
import type { HeraldQueueAdapter } from "../../../types/index.js";

describe("sync driver — enqueue runs processor in-band", () => {
	it("processor is called with the exact job before enqueue resolves", async () => {
		const driver = createSyncDriver();
		const processor = vi.fn().mockResolvedValue(undefined);
		await driver.start!(processor);

		const job = { deliveryId: "d1", payload: { foo: "bar" } };
		await driver.enqueue(job);

		expect(processor).toHaveBeenCalledOnce();
		expect(processor).toHaveBeenCalledWith(job);
	});
});

describe("sync driver — enqueue without start throws", () => {
	it("enqueue before start throws an error", async () => {
		const driver = createSyncDriver();
		const job = { deliveryId: "d1", payload: {} };
		await expect(driver.enqueue(job)).rejects.toThrow();
	});
});

describe("createQueue", () => {
	it("driver: 'sync' returns a driver with enqueue method", () => {
		const driver = createQueue({ driver: "sync" });
		expect(typeof driver.enqueue).toBe("function");
		expect(driver.capabilities).toMatchObject({
			durable: false,
			delayedJobs: false,
			cancellation: false,
			nativeRetries: false,
		});
	});

	it("driver: 'adapter' wraps a public queue adapter and normalizes job ids", async () => {
		const processor = vi.fn().mockResolvedValue(undefined);
		const adapter: HeraldQueueAdapter = {
			name: "test-queue",
			capabilities: {
				durable: true,
				delayedJobs: true,
				cancellation: true,
				nativeRetries: true,
			},
			enqueue: vi.fn().mockResolvedValue({ jobId: "job_1" }),
			start: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn().mockResolvedValue(undefined),
			cancelJobs: vi.fn().mockResolvedValue(undefined),
		};
		const driver = createQueue({ driver: "adapter", adapter });
		await driver.start?.(processor);
		const jobId = await driver.enqueue({
			deliveryId: "del_1",
			scheduledAt: new Date("2030-01-01T00:00:00Z"),
		});
		await driver.cancelJobs?.(["job_1"]);
		await driver.stop?.();

		expect(driver.capabilities).toBe(adapter.capabilities);
		expect(adapter.start).toHaveBeenCalledWith(processor);
		expect(adapter.enqueue).toHaveBeenCalledWith({
			deliveryId: "del_1",
			scheduledAt: new Date("2030-01-01T00:00:00Z"),
		});
		expect(jobId).toBe("job_1");
		expect(adapter.cancelJobs).toHaveBeenCalledWith(["job_1"]);
		expect(adapter.stop).toHaveBeenCalledOnce();
	});
});

describe("db driver — enqueue with scheduledAt forwards startAfter to boss.send", () => {
	it("3.7 enqueue({ deliveryId, scheduledAt }) calls boss.send with startAfter and no payload field", async () => {
		const mockBoss = {
			send: vi.fn().mockResolvedValue("job_id"),
			start: vi.fn().mockResolvedValue(undefined),
			work: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn().mockResolvedValue(undefined),
		};

		const driver = createDbDriver(
			{ connectionString: "postgresql://localhost/test" },
			mockBoss,
		);
		await driver.start!(async () => {});

		const scheduledAt = new Date("2030-01-01T10:00:00Z");
		await driver.enqueue({ deliveryId: "del_1", scheduledAt });

		// Job data should have only deliveryId — no payload
		expect(mockBoss.send).toHaveBeenCalledWith(
			"herald:delivery",
			{ deliveryId: "del_1" },
			expect.objectContaining({ startAfter: scheduledAt }),
		);
		const jobData = mockBoss.send.mock.calls[0]![1];
		expect(jobData).not.toHaveProperty("payload");
	});

	it("3.8 enqueue({ deliveryId, payload }) without scheduledAt: boss.send has no startAfter, full payload present", async () => {
		const mockBoss = {
			send: vi.fn().mockResolvedValue("job_id"),
			start: vi.fn().mockResolvedValue(undefined),
			work: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn().mockResolvedValue(undefined),
		};

		const driver = createDbDriver(
			{ connectionString: "postgresql://localhost/test" },
			mockBoss,
		);
		await driver.start!(async () => {});

		const payload = { orderId: "o1", userId: "u1" };
		await driver.enqueue({ deliveryId: "del_2", payload });

		const callArgs = mockBoss.send.mock.calls[0]!;
		expect(callArgs[1]).toMatchObject({ deliveryId: "del_2", payload });
		// No startAfter in options
		expect(callArgs[2]).not.toHaveProperty("startAfter");
	});

	it("worker rethrows processor errors so pg-boss can retry the job", async () => {
		let workHandler:
			| ((jobs: Array<{ data: { deliveryId: string } }>) => Promise<void>)
			| undefined;
		const mockBoss = {
			send: vi.fn().mockResolvedValue("job_id"),
			start: vi.fn().mockResolvedValue(undefined),
			work: vi.fn(async (_queue, _options, handler) => {
				workHandler = handler;
			}),
			stop: vi.fn().mockResolvedValue(undefined),
		};
		const error = new Error("delivery failed");
		const processor = vi.fn().mockRejectedValue(error);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		try {
			const driver = createDbDriver(
				{ connectionString: "postgresql://localhost/test" },
				mockBoss,
			);
			await driver.start!(processor);

			await expect(
				workHandler!([{ data: { deliveryId: "del_3" } }]),
			).rejects.toThrow(error);
			expect(processor).toHaveBeenCalledWith({ deliveryId: "del_3" });
			expect(consoleError).toHaveBeenCalledWith("[herald] job failed:", error);
		} finally {
			consoleError.mockRestore();
		}
	});
});

describe("calculateBackoff strategies", () => {
	it("exponential, attempt=1, base=1000 → 1000", () => {
		expect(calculateBackoff(1, "exponential", 1000)).toBe(1000);
	});

	it("exponential, attempt=3, base=1000 → 4000", () => {
		expect(calculateBackoff(3, "exponential", 1000)).toBe(4000);
	});

	it("linear, attempt=3, base=1000 → 3000", () => {
		expect(calculateBackoff(3, "linear", 1000)).toBe(3000);
	});

	it("fixed, attempt=3, base=1000 → 1000", () => {
		expect(calculateBackoff(3, "fixed", 1000)).toBe(1000);
	});

	it("fixed, attempt=1, base=500 → 500", () => {
		expect(calculateBackoff(1, "fixed", 500)).toBe(500);
	});
});
