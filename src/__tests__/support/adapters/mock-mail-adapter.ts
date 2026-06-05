import { vi } from "vitest";
import type {
	HeraldMailAdapter,
	SendEmailInput,
	SendEmailResult,
} from "../../../types/index.js";

type SendFn = (input: SendEmailInput) => Promise<SendEmailResult>;

export interface MockMailAdapter extends HeraldMailAdapter {
	send: ReturnType<typeof vi.fn<SendFn>>;
}

export function createMockMailAdapter(): MockMailAdapter {
	return {
		send: vi.fn<SendFn>().mockResolvedValue({ id: "msg_mock" }),
	};
}
