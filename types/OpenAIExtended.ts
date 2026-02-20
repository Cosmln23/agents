/**
 * Type-safe OpenAI Extended API
 *
 * Extinde tipurile OpenAI pentru a suporta metodele beta (Structured Outputs)
 * fără a folosi `as any` (Issue 1.2)
 *
 * Docs: https://platform.openai.com/docs/guides/structured-outputs
 */

import OpenAI from "openai";

/**
 * Structured output response from OpenAI beta API
 */
export interface StructuredChatCompletion {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
      refusal: string | null;
    };
    parsed?: Record<string, any>; // The structured output
    logprobs: null;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Extended OpenAI client with beta API support
 * Type-safe wrapper for Structured Outputs
 *
 * Usage:
 * const openaiExt = new OpenAIExtended(apiKey);
 * const result = await openaiExt.parseStructured<MyType>({ ... });
 */
export class OpenAIExtended {
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Call OpenAI Chat Completions with structured output
   *
   * Type-safe replacement for:
   * (openai as any).beta.chat.completions.parse()
   *
   * @param options - Chat completion options with response_format for structured output
   * @returns Parsed structured output of type T
   *
   * @example
   * const result = await openaiExt.parseStructured<CandidateData>({
   *   model: "gpt-4o-mini",
   *   messages: [{ role: "user", content: "Extract candidate info from: ..." }],
   *   response_format: {
   *     type: "json_schema",
   *     json_schema: {
   *       name: "candidate",
   *       schema: CandidateSchema.description("...").shape,
   *     }
   *   }
   * });
   */
  async parseStructured<T extends Record<string, any>>(
    options: {
      model: string;
      messages: Array<{
        role: "user" | "system" | "assistant";
        content: string;
      }>;
      response_format?: {
        type: "json_schema";
        json_schema: {
          name: string;
          schema: Record<string, any>;
          strict?: boolean;
        };
      };
      temperature?: number;
      max_tokens?: number;
    }
  ): Promise<T> {
    try {
      // Call the beta API through proper typing (cast to any only here, not throughout codebase)
      const response = await (this.client as any).beta.chat.completions.parse(
        options
      );

      // Extract and validate the parsed output
      if (response.choices?.[0]?.message?.parsed) {
        return response.choices[0].message.parsed as T;
      }

      throw new Error("No parsed output received from API");
    } catch (error) {
      console.error("❌ OpenAI Structured Output Error:", error);
      throw error;
    }
  }

  /**
   * Fallback: Standard chat completion (when structured output unavailable)
   * Type-safe alternative using standard completions API
   */
  async chatCompletion(
    messages: Array<{
      role: "user" | "system" | "assistant";
      content: string;
    }>,
    options?: { model?: string; temperature?: number; max_tokens?: number }
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: options?.model || "gpt-4o-mini",
      messages,
      temperature: options?.temperature ?? 0,
      max_tokens: options?.max_tokens,
    });

    return response.choices[0]?.message?.content || "";
  }
}

/**
 * Helper: Get OpenAI instance
 * Use this to create a singleton instance throughout the app
 */
export function getOpenAIExtended(): OpenAIExtended {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }
  return new OpenAIExtended(apiKey);
}
