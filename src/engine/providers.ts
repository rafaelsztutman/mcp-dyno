/**
 * Model-provider registry. mcp-dyno drives a server with whatever model the user
 * names; this maps a "<provider>/<model>" spec to how we reach it.
 *
 * Back-compat: a bare model id (no slash) resolves to Anthropic, so existing
 * `claude-sonnet-4-6` configs keep working. OpenRouter ids legitimately contain a
 * slash (e.g. `openrouter/anthropic/claude-3.5-sonnet`), so we split on the FIRST
 * slash only: provider = before it, model id = everything after.
 */

export type ProviderKind = "anthropic" | "openai-compat";

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  /** OpenAI-compatible chat-completions base URL (no trailing slash). Undefined for native Anthropic. */
  baseURL?: string;
  /** Env var holding the API key. */
  apiKeyEnv: string;
  /**
   * Byte→token tariff for the channel decomposition estimate. Tokenizers differ
   * across families, so this is the per-provider knob that keeps context-bloat
   * estimates honest (the usage totals themselves are exact from each API).
   */
  bytesPerToken: number;
  /**
   * OpenAI deprecated `max_tokens` in favor of `max_completion_tokens` on its own
   * endpoint; most OpenAI-compatible providers (Groq, Together, OpenRouter, Google)
   * still expect `max_tokens`. We default per provider and fall back on a 400.
   */
  tokenField?: "max_tokens" | "max_completion_tokens";
}

const PROVIDERS: Record<string, ProviderConfig> = {
  anthropic: {
    id: "anthropic",
    kind: "anthropic",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    bytesPerToken: 4,
  },
  openai: {
    id: "openai",
    kind: "openai-compat",
    baseURL: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    bytesPerToken: 4,
    tokenField: "max_completion_tokens",
  },
  openrouter: {
    id: "openrouter",
    kind: "openai-compat",
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    bytesPerToken: 4,
    tokenField: "max_tokens",
  },
  google: {
    id: "google",
    kind: "openai-compat",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyEnv: "GEMINI_API_KEY",
    bytesPerToken: 4,
    tokenField: "max_tokens",
  },
  groq: {
    id: "groq",
    kind: "openai-compat",
    baseURL: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    bytesPerToken: 4,
    tokenField: "max_tokens",
  },
  together: {
    id: "together",
    kind: "openai-compat",
    baseURL: "https://api.together.xyz/v1",
    apiKeyEnv: "TOGETHER_API_KEY",
    bytesPerToken: 4,
    tokenField: "max_tokens",
  },
};

export const KNOWN_PROVIDERS = Object.keys(PROVIDERS);

export interface ResolvedModel {
  provider: ProviderConfig;
  /** Bare model id passed to the underlying API (provider prefix stripped). */
  model: string;
  /** Original spec, e.g. "openai/gpt-4o-mini". */
  spec: string;
}

/** Resolve "<provider>/<model>" → provider + bare id. No slash ⇒ Anthropic (back-compat). */
export function resolveModel(spec: string): ResolvedModel {
  const slash = spec.indexOf("/");
  if (slash === -1) {
    return { provider: PROVIDERS.anthropic!, model: spec, spec };
  }
  const prefix = spec.slice(0, slash);
  const provider = PROVIDERS[prefix];
  if (!provider) {
    throw new Error(
      `Unknown model provider "${prefix}" in "${spec}". Known providers: ${KNOWN_PROVIDERS.join(", ")}. ` +
        `Use "<provider>/<model>" (e.g. openai/gpt-4o-mini) or a bare Claude id (e.g. claude-sonnet-4-6).`,
    );
  }
  return { provider, model: spec.slice(slash + 1), spec };
}

export function apiKeyFor(provider: ProviderConfig): string {
  const key = process.env[provider.apiKeyEnv];
  if (!key) throw new Error(`${provider.apiKeyEnv} is not set (required to drive with provider "${provider.id}").`);
  return key;
}

/** Base URL, with an env override (e.g. OPENAI_BASE_URL) for proxies / local endpoints. */
export function baseUrlFor(provider: ProviderConfig): string {
  const override = process.env[`${provider.id.toUpperCase()}_BASE_URL`];
  const base = override ?? provider.baseURL;
  if (!base) throw new Error(`No base URL configured for provider "${provider.id}".`);
  return base.replace(/\/+$/, "");
}
