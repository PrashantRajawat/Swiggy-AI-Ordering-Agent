import { LlmClient } from "../ai/llm";
import { Preferences } from "../models/user";

const REQUIRED_FIELDS: Array<keyof Preferences> = [
  "budget",
  "quantity",
  "premium",
  "dislikes",
  "deliveryTimeWeight",
  "flavors",
];

export class ConversationManager {
  constructor(private readonly llm: LlmClient) {}

  getMissingFields(prefs: Partial<Preferences>): Array<keyof Preferences> {
    return REQUIRED_FIELDS.filter((field) => prefs[field] === undefined || prefs[field] === null);
  }

  async getFollowUpQuestions(prefs: Partial<Preferences>): Promise<string[]> {
    const missing = this.getMissingFields(prefs).map(String);
    return this.llm.generateFollowUps(prefs as Record<string, unknown>, missing);
  }
}
