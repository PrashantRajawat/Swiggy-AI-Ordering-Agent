import OpenAI from "openai";
import { extractDishQuery, resolveDishQuery } from "../recommendation/relevance";
import { z } from "zod";
import {
  FOLLOW_UP_PROMPT,
  INTENT_EXTRACTION_PROMPT,
  SYSTEM_INTENT_PROMPT,
} from "./prompts";
import { parseBudgetFromText, parseQuantityFromText } from "../utils/parser";

const intentSchema = z.object({
  dishQuery: z.string().trim().min(1).nullable().default(null),
  flavors: z.array(z.string()).default([]),
  dislikes: z.array(z.string()).default([]),
  premium: z.boolean().nullable().default(null),
  budget: z.number().nullable().default(null),
  quantity: z.number().nullable().default(null),
});

export type IntentExtraction = z.infer<typeof intentSchema>;

export class LlmClient {
  private client: OpenAI | null;
  private model: string;

  constructor() {
    const key = process.env.OPENAI_API_KEY;
    this.client = key ? new OpenAI({ apiKey: key }) : null;
    this.model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async extractIntent(message: string): Promise<IntentExtraction> {
    const fallback = this.fallbackIntent(message);
    if (!this.client) return fallback;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_INTENT_PROMPT },
          { role: "user", content: `${INTENT_EXTRACTION_PROMPT}\nUser input: ${message}` },
        ],
        response_format: { type: "json_object" },
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
      const parsed = intentSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return fallback;

      return {
        ...parsed.data,
        dishQuery: resolveDishQuery(message, parsed.data.dishQuery),
        budget: parsed.data.budget ?? fallback.budget,
        quantity: parsed.data.quantity ?? fallback.quantity,
      };
    } catch {
      return fallback;
    }
  }

  async generateFollowUps(known: Record<string, unknown>, missing: string[]): Promise<string[]> {
    if (missing.length === 0) return [];
    if (!this.client) return this.defaultFollowUps(missing);

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_INTENT_PROMPT },
          {
            role: "user",
            content: `${FOLLOW_UP_PROMPT}\nKnown: ${JSON.stringify(known)}\nMissing: ${JSON.stringify(missing)}\nReturn JSON: {"questions": string[]}`,
          },
        ],
        response_format: { type: "json_object" },
      });
      const raw = response.choices[0]?.message?.content ?? "{}";
      const obj = JSON.parse(raw) as { questions?: string[] };
      const questions = Array.isArray(obj.questions) ? obj.questions : [];
      return questions.slice(0, 3).filter((q) => typeof q === "string" && q.length > 0);
    } catch {
      return this.defaultFollowUps(missing);
    }
  }

  private fallbackIntent(message: string): IntentExtraction {
    const lower = message.toLowerCase();
    const flavors: string[] = [];

    if (/chocolate|cocoa|nutella|brownie|rich/.test(lower)) {
      flavors.push("chocolate", "brownie", "nutella");
    }
    if (/healthy|low calorie|less sugar|protein/.test(lower)) {
      flavors.push("less sugar", "high protein");
    }

    const dislikes = Array.from(lower.matchAll(/no\s+([a-z]+)/g)).map((m) => m[1]);

    return {
      dishQuery: extractDishQuery(message),
      flavors: Array.from(new Set(flavors)),
      dislikes,
      premium: /premium|best quality/.test(lower) ? true : null,
      budget: parseBudgetFromText(message) ?? null,
      quantity: parseQuantityFromText(message) ?? null,
    };
  }

  private defaultFollowUps(missing: string[]): string[] {
    const map: Record<string, string> = {
      budget: "What is your budget in INR?",
      quantity: "How many people are ordering?",
      premium: "Do you prefer premium quality or maximum quantity?",
      dislikes: "Any ingredients or flavors to avoid?",
    };
    return missing.map((key) => map[key] ?? `Please provide ${key}.`).slice(0, 3);
  }
}
