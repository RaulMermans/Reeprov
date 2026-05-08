import type { LLMProvider } from "@/lib/llm/types";

export const featureFlags = {
  get llmAuditorsEnabled() {
    return process.env.ENABLE_LLM_AUDITORS === "true";
  },
};

export function getLLMAuditorStatus() {
  const provider = providerFromEnv();

  return {
    enabled: featureFlags.llmAuditorsEnabled,
    providerConfigured: provider ? isProviderConfigured(provider) : false,
    provider,
  };
}

export function providerFromEnv(): LLMProvider | null {
  const provider = (process.env.LLM_PROVIDER ?? "openai").toLowerCase();

  if (provider === "openai" || provider === "anthropic") {
    return provider;
  }

  return null;
}

export function isProviderConfigured(provider: LLMProvider) {
  if (provider === "openai") {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  if (provider === "anthropic") {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  return false;
}
