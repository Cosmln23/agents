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
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
      defaultHeaders: {
        "User-Agent": "openai-node/6.0.0"
      }
    });
  }

  /**
   * Parse structured data from OpenAI API
   * Uses standard API with JSON response parsing (fallback-first approach)
   *
   * @param options - Chat completion options
   * @returns Parsed structured output of type T
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
      timeout?: number;
    }
  ): Promise<T> {
    try {
      const timeout = options.timeout || 30000;

      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`OpenAI API timeout (${timeout}ms exceeded)`)
            ),
          timeout
        )
      );

      // Use standard chat completions API
      const apiCall = this.client.chat.completions.create({
        model: options.model,
        messages: options.messages,
        temperature: options.temperature ?? 0,
        max_tokens: options.max_tokens,
      });

      const response = await Promise.race([apiCall, timeoutPromise]);

      // Extract content from response
      const content = response.choices?.[0]?.message?.content || "";

      if (!content) {
        throw new Error("Empty response from API");
      }

      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error(`No JSON found in response: ${content.substring(0, 100)}`);
      }

      return JSON.parse(jsonMatch[0]) as T;
    } catch (error) {
      console.error("❌ OpenAI Parse Error:", error);
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
