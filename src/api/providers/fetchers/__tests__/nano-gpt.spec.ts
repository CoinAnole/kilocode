// kilocode_change - new file
import { TOOL_PROTOCOL } from "@roo-code/types"

import { parseNanoGptModel, type NanoGptModel } from "../nano-gpt"

const createNanoGptModel = (id: string): NanoGptModel => ({
	id,
	object: "model",
	created: 0,
	owned_by: "test",
	name: id,
	description: "test model",
	context_length: 128_000,
	capabilities: { vision: false },
	pricing: { prompt: 0.1, completion: 0.2, currency: "USD", unit: "M" },
})

describe("parseNanoGptModel native tool support", () => {
	it("enables native tools for Kimi K2.5 thinking IDs only", () => {
		const kimiModelIds = ["moonshotai/kimi-k2.5:thinking", "TEE/kimi-k2.5-thinking"]

		for (const id of kimiModelIds) {
			const parsed = parseNanoGptModel({ model: createNanoGptModel(id) })
			expect(parsed.supportsNativeTools).toBe(true)
			expect(parsed.defaultToolProtocol).toBe(TOOL_PROTOCOL.NATIVE)
		}
	})

	it("does not enable native tools for other Nano-GPT models", () => {
		const nonWhitelistedIds = ["moonshotai/kimi-k2.5", "TEE/kimi-k2.5", "openai/gpt-4o-mini"]

		for (const id of nonWhitelistedIds) {
			const parsed = parseNanoGptModel({ model: createNanoGptModel(id) })
			expect(parsed.supportsNativeTools).toBeUndefined()
			expect(parsed.defaultToolProtocol).toBeUndefined()
		}
	})
})
