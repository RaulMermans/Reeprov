export type LLMProvider = "openai" | "anthropic";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMGenerateInput {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LLMGenerateResult {
  text: string;
  provider: LLMProvider;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export type LLMClientResult =
  | {
      ok: true;
      result: LLMGenerateResult;
    }
  | {
      ok: false;
      provider: LLMProvider | null;
      model?: string;
      disabled: boolean;
      error: string;
    };
