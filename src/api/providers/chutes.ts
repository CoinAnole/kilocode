import { DEEP_SEEK_DEFAULT_TEMPERATURE, chutesDefaultModelId, chutesDefaultModelInfo } from "@roo-code/types"
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import type { ApiHandlerOptions } from "../../shared/api"
import { getModelMaxOutputTokens } from "../../shared/api"
import { XmlMatcher } from "../../utils/xml-matcher"
import { convertToR1Format } from "../transform/r1-format"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"

import { RouterProvider } from "./router-provider"
import { getApiRequestTimeout } from "./utils/timeout-config"

export class ChutesHandler extends RouterProvider implements SingleCompletionHandler {
	// kilocode_change start
	private static readonly KIMI_K2_5_TEE_MODEL_ID = "moonshotai/kimi-k2.5-tee"
	// kilocode_change end

	constructor(options: ApiHandlerOptions) {
		super({
			options,
			name: "chutes",
			baseURL: "https://llm.chutes.ai/v1",
			apiKey: options.chutesApiKey,
			modelId: options.apiModelId,
			defaultModelId: chutesDefaultModelId,
			defaultModelInfo: chutesDefaultModelInfo,
		})
	}

	// kilocode_change start
	private getRequestOptions() {
		return {
			timeout: getApiRequestTimeout(),
		}
	}

	private isKimiK2_5TeeModel(modelId: string): boolean {
		return modelId.toLowerCase() === ChutesHandler.KIMI_K2_5_TEE_MODEL_ID
	}

	private getKimiTemperatureDefault(): number {
		const isReasoningEnabled = this.options.enableReasoningEffort !== false
		return isReasoningEnabled ? 1.0 : 0.6
	}

	private resolveToolChoice(
		modelId: string,
		metadata?: ApiHandlerCreateMessageMetadata,
	): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming["tool_choice"] | undefined {
		if (!metadata?.tools || metadata.tools.length === 0) {
			return metadata?.tool_choice
		}

		// Keep caller-specified tool policy; forcing "required" can trap Kimi in repeated tool calls.
		if (this.isKimiK2_5TeeModel(modelId)) {
			return metadata.tool_choice
		}

		return metadata.tool_choice
	}

	private extractReasoningText(delta: unknown): string | undefined {
		if (!delta || typeof delta !== "object") {
			return undefined
		}

		for (const key of ["reasoning_content", "reasoning"] as const) {
			const value = (delta as Record<string, unknown>)[key]
			if (typeof value === "string" && value.trim()) {
				return value
			}
		}

		return undefined
	}
	// kilocode_change end

	private getCompletionParams(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
		const { id: model, info } = this.getModel()
		// kilocode_change start
		const tool_choice = this.resolveToolChoice(model, metadata)
		// kilocode_change end

		// Centralized cap: clamp to 20% of the context window (unless provider-specific exceptions apply)
		const max_tokens =
			getModelMaxOutputTokens({
				modelId: model,
				model: info,
				settings: this.options,
				format: "openai",
			}) ?? undefined

		const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model,
			max_tokens,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
			...(metadata?.tools && { tools: metadata.tools }),
			...(tool_choice && { tool_choice }),
		}

		// Only add temperature if model supports it
		if (this.supportsTemperature(model)) {
			params.temperature = this.options.modelTemperature ?? info.temperature
		}

		return params
	}

	// kilocode_change start
	private getNonStreamingCompletionParams(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
		const { id: model, info } = this.getModel()
		const tool_choice = this.resolveToolChoice(model, metadata)

		const max_tokens =
			getModelMaxOutputTokens({
				modelId: model,
				model: info,
				settings: this.options,
				format: "openai",
			}) ?? undefined

		const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
			model,
			max_tokens,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			...(metadata?.tools && { tools: metadata.tools }),
			...(tool_choice && { tool_choice }),
		}

		if (this.supportsTemperature(model)) {
			params.temperature = this.options.modelTemperature ?? info.temperature
		}

		return params
	}

	private async *emitKimiReasoningOnlyFallback(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const response = await this.client.chat.completions.create(
			this.getNonStreamingCompletionParams(systemPrompt, messages, metadata),
			this.getRequestOptions(),
		)
		const message = response.choices[0]?.message
		if (!message) {
			return
		}

		if (typeof message.content === "string" && message.content.trim()) {
			yield { type: "text", text: message.content }
		}

		if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
			const toolCallIdsByIndex = new Map<number, string>()
			for (const [index, toolCall] of message.tool_calls.entries()) {
				const toolCallId = this.getToolCallId({ id: toolCall.id, index }, toolCallIdsByIndex)
				if (toolCall.type !== "function") {
					continue
				}
				yield {
					type: "tool_call_partial",
					index,
					id: toolCallId,
					name: toolCall.function.name,
					arguments: toolCall.function.arguments,
				}
				yield { type: "tool_call_end", id: toolCallId }
			}
		}
	}
	// kilocode_change end

	// kilocode_change start
	private getToolCallId(
		toolCall: {
			id?: string
			index?: number
		},
		toolCallIdsByIndex: Map<number, string>,
	): string {
		const toolCallIndex = toolCall.index ?? 0

		if (toolCall.id) {
			toolCallIdsByIndex.set(toolCallIndex, toolCall.id)
			return toolCall.id
		}

		const existingId = toolCallIdsByIndex.get(toolCallIndex)
		if (existingId) {
			return existingId
		}

		const syntheticId = `chutes_tool_call_${toolCallIndex}`
		toolCallIdsByIndex.set(toolCallIndex, syntheticId)
		return syntheticId
	}
	// kilocode_change end

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const model = await this.fetchModel()

		if (model.id.includes("DeepSeek-R1")) {
			const stream = await this.client.chat.completions.create(
				{
					...this.getCompletionParams(systemPrompt, messages, metadata),
					messages: convertToR1Format([{ role: "user", content: systemPrompt }, ...messages]),
				},
				this.getRequestOptions(),
			)

			const matcher = new XmlMatcher(
				"think",
				(chunk) =>
					({
						type: chunk.matched ? "reasoning" : "text",
						text: chunk.data,
					}) as const,
			)
			// kilocode_change start
			const activeToolCallIds = new Set<string>()
			const toolCallIdsByIndex = new Map<number, string>()
			// kilocode_change end

			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta
				// kilocode_change start
				const finishReason = chunk.choices[0]?.finish_reason
				// kilocode_change end

				if (delta?.content) {
					for (const processedChunk of matcher.update(delta.content)) {
						yield processedChunk
					}
				}

				// Emit raw tool call chunks - NativeToolCallParser handles state management
				if (delta && "tool_calls" in delta && Array.isArray(delta.tool_calls)) {
					for (const toolCall of delta.tool_calls) {
						// kilocode_change start
						const toolCallId = this.getToolCallId(toolCall, toolCallIdsByIndex)
						activeToolCallIds.add(toolCallId)
						// kilocode_change end
						yield {
							type: "tool_call_partial",
							index: toolCall.index,
							id: toolCallId,
							name: toolCall.function?.name,
							arguments: toolCall.function?.arguments,
						}
					}
				}
				// kilocode_change start
				if (finishReason === "tool_calls" && activeToolCallIds.size > 0) {
					for (const id of activeToolCallIds) {
						yield { type: "tool_call_end", id }
					}
					activeToolCallIds.clear()
				}
				// kilocode_change end

				if (chunk.usage) {
					yield {
						type: "usage",
						inputTokens: chunk.usage.prompt_tokens || 0,
						outputTokens: chunk.usage.completion_tokens || 0,
					}
				}
			}

			// Process any remaining content
			for (const processedChunk of matcher.final()) {
				yield processedChunk
			}
		} else {
			// For non-DeepSeek-R1 models, use standard OpenAI streaming
			const stream = await this.client.chat.completions.create(
				this.getCompletionParams(systemPrompt, messages, metadata),
				this.getRequestOptions(),
			)
			// kilocode_change start
			const activeToolCallIds = new Set<string>()
			const toolCallIdsByIndex = new Map<number, string>()
			let sawTextContent = false
			let sawToolCalls = false
			let sawReasoning = false
			// kilocode_change end

			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta
				// kilocode_change start
				const finishReason = chunk.choices[0]?.finish_reason
				// kilocode_change end

				if (delta?.content) {
					// kilocode_change start
					sawTextContent = true
					// kilocode_change end
					yield { type: "text", text: delta.content }
				}

				// kilocode_change start
				const reasoningText = this.extractReasoningText(delta)
				if (reasoningText) {
					sawReasoning = true
					yield { type: "reasoning", text: reasoningText }
				}
				// kilocode_change end

				// Emit raw tool call chunks - NativeToolCallParser handles state management
				if (delta && "tool_calls" in delta && Array.isArray(delta.tool_calls)) {
					// kilocode_change start
					sawToolCalls = true
					// kilocode_change end
					for (const toolCall of delta.tool_calls) {
						// kilocode_change start
						const toolCallId = this.getToolCallId(toolCall, toolCallIdsByIndex)
						activeToolCallIds.add(toolCallId)
						// kilocode_change end
						yield {
							type: "tool_call_partial",
							index: toolCall.index,
							id: toolCallId,
							name: toolCall.function?.name,
							arguments: toolCall.function?.arguments,
						}
					}
				}
				// kilocode_change start
				if (finishReason === "tool_calls" && activeToolCallIds.size > 0) {
					for (const id of activeToolCallIds) {
						yield { type: "tool_call_end", id }
					}
					activeToolCallIds.clear()
				}
				// kilocode_change end

				if (chunk.usage) {
					yield {
						type: "usage",
						inputTokens: chunk.usage.prompt_tokens || 0,
						outputTokens: chunk.usage.completion_tokens || 0,
					}
				}
			}

			// kilocode_change start
			const shouldRunReasoningOnlyFallback =
				this.isKimiK2_5TeeModel(model.id) && sawReasoning && !sawTextContent && !sawToolCalls
			if (shouldRunReasoningOnlyFallback) {
				for await (const chunk of this.emitKimiReasoningOnlyFallback(systemPrompt, messages, metadata)) {
					yield chunk
				}
			}
			// kilocode_change end
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const model = await this.fetchModel()
		const { id: modelId, info } = model

		try {
			// Centralized cap: clamp to 20% of the context window (unless provider-specific exceptions apply)
			const max_tokens =
				getModelMaxOutputTokens({
					modelId,
					model: info,
					settings: this.options,
					format: "openai",
				}) ?? undefined

			const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: modelId,
				messages: [{ role: "user", content: prompt }],
				max_tokens,
			}

			// Only add temperature if model supports it
			if (this.supportsTemperature(modelId)) {
				const isDeepSeekR1 = modelId.includes("DeepSeek-R1")
				// kilocode_change start
				const defaultTemperature = isDeepSeekR1
					? DEEP_SEEK_DEFAULT_TEMPERATURE
					: (this.getModel().info.temperature ?? 0.5)
				// kilocode_change end
				requestParams.temperature = this.options.modelTemperature ?? defaultTemperature
			}

			const response = await this.client.chat.completions.create(requestParams, this.getRequestOptions())
			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Chutes completion error: ${error.message}`)
			}
			throw error
		}
	}

	override getModel() {
		const model = super.getModel()
		const configuredModelId = this.options.apiModelId
		// kilocode_change start
		// Keep explicit Chutes model IDs instead of silently switching to the provider default.
		// This prevents hidden model substitution when model lists are stale/unavailable.
		const shouldPreserveExplicitModelId =
			!!configuredModelId &&
			configuredModelId !== this.defaultModelId &&
			model.id === this.defaultModelId &&
			!this.models[configuredModelId]

		const effectiveModelId = shouldPreserveExplicitModelId ? configuredModelId : model.id
		const baseInfo = shouldPreserveExplicitModelId ? this.defaultModelInfo : model.info
		// kilocode_change end
		const isDeepSeekR1 = effectiveModelId.includes("DeepSeek-R1")
		// kilocode_change start
		const isKimiK2_5Tee = this.isKimiK2_5TeeModel(effectiveModelId)
		// kilocode_change end

		return {
			id: effectiveModelId,
			info: {
				...baseInfo,
				temperature: isDeepSeekR1
					? DEEP_SEEK_DEFAULT_TEMPERATURE
					: isKimiK2_5Tee
						? this.getKimiTemperatureDefault()
						: 0.5,
			},
		}
	}
}
