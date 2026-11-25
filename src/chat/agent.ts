import OpenAI from "openai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { ToolOrchestrator } from "../agent/toolOrchestrator";
import { SwiggyMcpClient } from "../mcp/client";
import { extractDishQuery, dishRelevance } from "../recommendation/relevance";
import { generateCombinations } from "../recommendation/combinations";
import { bestCouponForSubtotal } from "../recommendation/coupon";
import { parseBudgetFromText, parseQuantityFromText } from "../utils/parser";
import { ChatState, ChatMessage, Profile } from "./store";

const turnSchema = z.object({
  dishes: z.array(z.string().min(1)).max(5).optional(), budget: z.number().positive().max(100000).optional(),
  quantity: z.number().int().min(1).max(6).optional(), diet: z.enum(["any", "vegetarian", "vegan"]).optional(),
  dislikes: z.array(z.string()).max(20).optional(), allergies: z.array(z.string()).max(20).optional(),
  premium: z.boolean().optional(), faster: z.boolean().optional(), restaurants: z.array(z.string()).max(10).optional(),
  anything: z.boolean().optional(), cheaper: z.boolean().optional(), addressChange: z.boolean().optional(),
});
export interface FoodCard {
  id: string; restaurant: string; rating?: number; eta?: number; items: { name: string; quantity: number; unitPrice: number; requiresCustomization: boolean }[];
  subtotal: number; deliveryFee: number; total: number; savings: number; coupon?: string; estimate: boolean; overBudget: boolean;
}
export interface TurnResult { state: ChatState; text: string; cards: FoodCard[]; suggestions: string[]; remember: Partial<Profile> }
export class ChatAgent {
  private readonly ai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000, maxRetries: 0 }) : undefined;
  private readonly model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  constructor(private readonly client: SwiggyMcpClient) {}

  async resolve(message: string, previous: ChatState, history: ChatMessage[], addressId?: string, onState?: (state: ChatState) => void): Promise<TurnResult> {
    const lower = message.toLowerCase();
    let turn: z.infer<typeof turnSchema> = {};
    const budget = /cheaper|lower.*budget/i.test(message) ? undefined : parseBudgetFromText(message);
    if (budget) turn.budget = budget;
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const wordQuantity = lower.match(/\bfor\s+(one|two|three|four|five|six)\b/);
    const quantity = parseQuantityFromText(message) ?? (wordQuantity ? words[wordQuantity[1]] : undefined);
    if (quantity && quantity <= 6) turn.quantity = quantity;
    if (/vegetarian|\bveg\b/.test(lower) && !/non[ -]?veg/.test(lower)) turn.diet = "vegetarian";
    if (/\bvegan\b/.test(lower)) turn.diet = "vegan";
    if (/non[ -]?veg|any diet|no dietary/.test(lower)) turn.diet = "any";
    const avoid = [...lower.matchAll(/(?:no|without|avoid)\s+([a-z]+)(?![a-z])/g)].map(m => m[1]).filter(w => !["preference", "restrictions", "dietary"].includes(w));
    if (avoid.length) turn.dislikes = [...new Set([...previous.dislikes, ...avoid])];
    const allergy = lower.match(/allerg(?:ic to|y to|ies?:?)\s+([a-z]+(?:\s+and\s+[a-z]+)?)/);
    if (allergy) turn.allergies = [...new Set([...previous.allergies, ...allergy[1].split(/\s+and\s+/)])];
    turn.anything = /anything|you choose|surprise me|whatever/.test(lower);
    turn.cheaper = /cheaper|less expensive|lower cost/.test(lower);
    turn.faster = /faster|quick|fast delivery/.test(lower) || previous.faster;
    turn.addressChange = /change.*address|deliver.*(?:elsewhere|another address)/.test(lower);
    const restaurantMatch = message.match(/\b(?:from|at)\s+(.+?)(?=,|\s+(?:under|below|for|with)\b|$)/i);
    if (restaurantMatch) turn.restaurants = restaurantMatch[1].split(/\s+or\s+/i).map(name => name.trim());
    if (/try another dish/i.test(message)) turn.dishes = [];
    const isRefinement = /^(?:under|below|₹|rs\b|for\b|no\b|without\b|avoid\b|cheaper|faster|same|retry last search|from\b|only from|search again|show cheaper|find faster|try another dish|anything|you choose|surprise|whatever|yes|okay|ok\b|increase|raise|vegetarian|vegan|non.veg|i am allergic|i'm allergic|allerg|change.*address)/i.test(message.trim());
    if ((!isRefinement || /\b(?:pizza|waffles?|burger|biryani|naan|butter chicken|pasta|rolls?|dosa|salad|sandwich|brownie)\b/i.test(message) && !/^(?:no|without|avoid)\b/i.test(message)) && !/^(hi|hello|hey)[!. ]*$/i.test(message.trim())) {
      const dishes = message.replace(/[,;]?\s*(?:i am |i\'m )?allerg(?:ic to|y to|ies?:?)\s+[a-z]+(?:\s+and\s+[a-z]+)?/gi, " ").replace(/\bfor\s+(?:one|two|three|four|five|six)\b/gi, " ").replace(/^try\s+/i, "").replace(/\b(?:today|tonight|this time|this order|for now|vegetarian|vegan)\b/gi, " ").split(/\s+(?:with|and|plus)\s+|\s*\+\s*/i).map(extractDishQuery).filter(Boolean);
      if (dishes.length) turn.dishes = dishes.slice(0, 5);
    }
    if (this.ai) {
      try {
        const completion = await this.ai.chat.completions.create({ model: this.model, temperature: 0, response_format: { type: "json_object" }, messages: [
          { role: "system", content: `You extract updates for a food-ordering conversation. Return JSON with ONLY changed fields: dishes (array of separate dish searches, e.g. ["butter chicken","naan"]), budget (INR number), quantity (1-6 menu items, default unchanged), diet (any/vegetarian/vegan), dislikes (full merged list), allergies (full merged list), premium (bool), faster (bool), restaurants (array), anything (bool), cheaper (bool), addressChange (bool). Preserve explicit proteins. Refinements like cheaper or no chicken must preserve existing dishes unless a replacement is requested; remove chicken from the dish query if explicitly excluded. Do not invent a budget from unrelated numbers. Do not raise a budget without an explicit new amount. Anything is fine permits choosing missing details. Current state: ${JSON.stringify(previous)}` },
          ...history.slice(-8).map(m => ({ role: m.role, content: m.text })), { role: "user", content: message },
        ] });
        const parsed = turnSchema.safeParse(JSON.parse(completion.choices[0]?.message.content || "{}"));
        if (parsed.success) turn = { ...turn, ...parsed.data };
      } catch { /* deterministic extraction keeps demo and API failures usable */ }
    }
    const { anything, cheaper, addressChange, ...updates } = turn;
    const state: ChatState = { ...previous, ...updates };
    // Preserve the dish category when a protein is removed in a refinement.
    if (avoid.length && !turn.dishes) state.dishes = state.dishes.map(d => d.split(/\s+/).filter(w => !avoid.includes(w)).join(" ")).filter(Boolean);
    if (anything) { if (!state.dishes.length) state.dishes = ["pizza"]; state.budget ??= 350; }
    if (cheaper && !turn.budget && state.budget) state.budget = Math.max(50, Math.floor(state.budget * .8));
    const remember: Partial<Profile> = {};
    if (!/today|this time|tonight|for now|this order/i.test(message)) {
      if (turn.budget) remember.budget = turn.budget;
      if (turn.diet) remember.diet = state.diet;
      if (turn.allergies) remember.allergies = state.allergies;
      if (turn.dislikes) remember.dislikes = state.dislikes;
    }
    const result = (text: string, suggestions: string[] = [], cards: FoodCard[] = []): TurnResult => ({ state, text, suggestions, cards, remember });
    if ((parseQuantityFromText(message) ?? 1) > 6) return result("I can compare up to six menu items at a time. How many items should I look for?", ["For two", "For four", "For six"]);
    if (addressChange) return result("Use the delivery address selector at the top to choose another saved address, then ask me to search again.", ["Search again"]);
    if (!state.dishes.length) return result("What are you craving? Tell me a dish and a rough budget. I’ll start with one person unless you say otherwise.", ["Pizza under ₹350", "Chocolate waffles for two under ₹500", "Anything is fine"]);
    if (!state.budget) return result(`What budget should I work with for ${state.dishes.join(" and ")}? I’m planning for ${state.quantity} ${state.quantity === 1 ? "item" : "items"}. You can also tell me any dietary restrictions or allergies.`, ["Under ₹300", "Under ₹500 for two", "Anything is fine"]);
    onState?.(state);
    if (!this.client.isMockMode() && !this.client.hasAccessToken()) return result("Your request is ready. Connect Swiggy using the button above when you want me to search live restaurants.");
    if (!this.client.isMockMode() && !addressId) return result("Choose a saved delivery address at the top before I search.");
    const tools = new ToolOrchestrator(this.client);
    const restaurantMap = new Map<string, Awaited<ReturnType<typeof tools.searchRestaurantsWithMenus>>[number]>();
    for (const dish of state.dishes) {
      for (const r of await tools.searchRestaurantsWithMenus(dish, addressId, state.restaurants)) restaurantMap.set(r.id, r);
    }
    const coupons = await tools.getAvailableCoupons();
    const candidates: { card: FoodCard; score: number }[] = [];
    for (const restaurant of restaurantMap.values()) {
      const restricted = [...state.dislikes, ...state.allergies];
      const items = restaurant.items.filter(item => {
        const text = `${item.name} ${item.category}`.toLowerCase();
        if (restricted.some(word => text.includes(word.toLowerCase()))) return false;
        if (state.diet !== "any" && /chicken|mutton|fish|prawn|beef|pork|pepperoni|non.?veg|\begg\b/.test(text)) return false;
        if (state.diet === "vegan" && /cheese|paneer|butter|cream|milk|nutella|chocolate|yogurt|ghee/.test(text)) return false;
        return state.dishes.some(d => dishRelevance(item, d) > 0) && item.available !== false;
      }).sort((a,b) => a.price - b.price);
      const count = Math.max(state.quantity, state.dishes.length);
      if (count > 6) continue;
      for (const combo of generateCombinations(items, count)) {
        if (!state.dishes.every(d => combo.items.some(i => dishRelevance(i,d) > 0))) continue;
        const discount = bestCouponForSubtotal(combo.subtotal + restaurant.deliveryFee, restaurant.pricingIsEstimate ? [] : restaurant.coupons?.length ? restaurant.coupons : coupons);
        const grouped = new Map<string, FoodCard["items"][number]>();
        for (const item of combo.items) {
          const existing = grouped.get(item.name);
          if (existing) existing.quantity++;
          else grouped.set(item.name, { name: item.name, quantity: 1, unitPrice: item.price, requiresCustomization: Boolean(item.requiresCustomization) });
        }
        const card: FoodCard = { id: randomUUID(), restaurant: restaurant.name, rating: restaurant.rating || undefined, eta: restaurant.deliveryTime || undefined,
          items: [...grouped.values()], subtotal: combo.subtotal, deliveryFee: restaurant.deliveryFee, total: discount.finalPrice,
          savings: discount.savings, coupon: discount.coupon?.couponCode, estimate: Boolean(restaurant.pricingIsEstimate), overBudget: discount.finalPrice > state.budget };
        // Balance affordability and rating; faster delivery is an explicit refinement.
        const score = (restaurant.rating || 3) * (state.premium ? 2 : 1) - card.total / state.budget * 3 - restaurant.deliveryTime * (state.faster ? .12 : .01);
        candidates.push({ card, score });
      }
    }
    const within = candidates.filter(c => !c.card.overBudget).sort((a,b) => b.score-a.score);
    const unique = (list: typeof candidates) => [...new Map(list.map(c => [c.card.restaurant + JSON.stringify(c.card.items), c.card])).values()].slice(0,5);
    if (!within.length) {
      const nearest = unique(candidates.sort((a,b) => a.card.total-b.card.total)).slice(0,2);
      if (!nearest.length) return result(`I couldn’t find available ${state.dishes.join(" and ")} matching your preferences in the menus checked. Would you like to try another dish?`, ["Try pizza", "Try chocolate waffles"]);
      const minimum = nearest[0].total;
      return result(`Nothing I checked fits ₹${state.budget}. The nearest matching option is ${nearest[0].estimate ? "estimated at " : ""}₹${minimum}. Would you like to increase your budget, or try another dish?`, [`Increase budget to ₹${Math.ceil(minimum)}`, "Try another dish"], nearest);
    }
    const cards = unique(within);
    const allergyNote = state.allergies.length ? " Menu names cannot verify allergens or cross-contamination; confirm directly with the restaurant before ordering." : "";
    return result(`Here ${cards.length === 1 ? "is one option" : `are ${cards.length} options`} for ${state.dishes.join(" and ")} within ₹${state.budget}, balanced by price and restaurant rating.${state.quantity === 1 ? " I’ve assumed one person." : ""}${state.diet !== "any" ? " Dietary filtering uses menu names and needs restaurant confirmation." : ""}${allergyNote}`, ["Show cheaper options", "Find faster delivery", "Try another dish"], cards);
  }

  async *reply(result: TurnResult): AsyncGenerator<string> {
    // Stream real model deltas where configured; deterministic text remains available offline.
    if (this.ai) {
      let emitted = false;
      try {
        const stream = await this.ai.chat.completions.create({ model: this.model, stream: true, temperature: .3, messages: [
          { role: "system", content: "Write a concise, friendly food assistant response in English, at most 3 sentences. Paraphrase the supplied verified response. Preserve every price, question, constraint, and allergy warning. Do not invent details, claim checkout works, or claim that menu estimates include fees. Cards are displayed separately. Return plain text." },
          { role: "user", content: result.text },
        ] });
        for await (const chunk of stream) { const token = chunk.choices[0]?.delta.content; if (token) { emitted = true; yield token; } }
        if (emitted) return;
      } catch { if (emitted) { yield "\n" + result.text; return; } }
    }
    for (const chunk of result.text.match(/\S+\s*/g) || []) yield chunk;
  }
}
