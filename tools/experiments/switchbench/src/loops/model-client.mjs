/**
 * model-client.mjs — SwitchBench A/B 架构共用的模型客户端（openai-completions 协议）。
 *
 * 冻结模型（EXPERIMENT.md §10）：deepseek-v4-flash-0731 @ jiyuan-lvdong
 * (https://tokenrhythm.studio/v1)。凭据从仓库根 .env 的 APIKEY 读取
 * （或环境变量 JIYUAN_LVDONG_API_KEY），不入库、不打印。
 *
 * 职责：chat completions + tools 的线格式、usage/cache 记账、瞬态错误有限重试。
 * 失败语义（Let It Fail）：重试耗尽后抛错，由调用方如实记 run 失败，绝不伪造成功。
 */
import { readFileSync } from 'node:fs'

export const FROZEN_MODEL = 'deepseek-v4-flash-0731'
export const FROZEN_BASE_URL = 'https://tokenrhythm.studio/v1'

export function loadApiKey() {
  if (process.env['JIYUAN_LVDONG_API_KEY']) return process.env['JIYUAN_LVDONG_API_KEY']
  const envText = readFileSync(new URL('../../../../../.env', import.meta.url), 'utf8')
  const match = envText.match(/APIKEY\s*=\s*(\S+)/)
  if (match === null) throw new Error('no API key: set JIYUAN_LVDONG_API_KEY or put APIKEY=... in repo-root .env')
  return match[1]
}

export class ModelClient {
  /**
   * @param {object} opts
   * @param {(event: object) => void} [opts.onEvent] 事件sink（请求/响应记账，供指标采集）
   * @param {(payload: object) => void} [opts.onRequestPayload] 每次请求的消息载荷存档回调
   * @param {string} [opts.apiKey]
   */
  constructor({ onEvent, onRequestPayload, apiKey } = {}) {
    this.apiKey = apiKey ?? loadApiKey()
    this.onEvent = onEvent ?? (() => {})
    this.onRequestPayload = onRequestPayload
    /** 累计 usage（input = prompt_tokens，含缓存命中部分）。 */
    this.usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0, retries: 0, errors: 0 }
  }

  /**
   * 发起一次 chat completion。
   * @returns {Promise<{message: object, usage: object, raw: object, roundTripMs: number}>}
   */
  async chat({ messages, tools, maxTokens = 8192, temperature, seed, timeoutMs = 180_000 }) {
    const body = {
      model: FROZEN_MODEL,
      messages,
      max_tokens: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(seed !== undefined ? { seed } : {}),
      ...(tools !== undefined && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    }
    // 请求载荷存档（估计器校准用：估计值 vs 真实 usage）。存的是消息数组，
    // 不含 tools schema（离线重建同样不含，误差项一致，校准比才可比）。
    this.onRequestPayload?.({ messages: messages.map((message) => ({ ...message })) })
    const started = Date.now()
    let lastError
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetch(`${FROZEN_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        const text = await response.text()
        if (!response.ok) {
          const err = new Error(`model http ${response.status}: ${text.slice(-400)}`)
          err.transient = response.status === 429 || response.status >= 500
          throw err
        }
        const json = JSON.parse(text)
        const choice = json.choices?.[0]
        if (choice === undefined) throw new Error(`model response has no choices: ${text.slice(-200)}`)
        const usage = json.usage ?? {}
        this.usage.requests += 1
        this.usage.inputTokens += usage.prompt_tokens ?? 0
        this.usage.outputTokens += usage.completion_tokens ?? 0
        this.usage.cachedTokens += usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0
        const roundTripMs = Date.now() - started
        this.onEvent({
          type: 'llm-response',
          roundTripMs,
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
          cachedTokens: usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0,
          finishReason: choice.finish_reason ?? null,
        })
        return {
          message: choice.message,
          usage,
          raw: json,
          roundTripMs,
        }
      } catch (error) {
        lastError = error
        const transient = error.transient === true || error.name === 'AbortError' || error.name === 'TypeError'
        if (!transient || attempt === 2) {
          this.usage.errors += 1
          this.onEvent({ type: 'llm-error', error: String(error?.message ?? error) })
          throw error
        }
        this.usage.retries += 1
        this.onEvent({ type: 'llm-retry', attempt: attempt + 1, error: String(error?.message ?? error) })
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError
  }
}
