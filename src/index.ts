import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AgentOrchestrator } from "./agent/orchestrator";
import { formatINR } from "./utils/currency";

async function runCli(): Promise<void> {
  const rl = createInterface({ input, output });
  const orchestrator = new AgentOrchestrator();

  const craving = await rl.question("What are you craving? ");
  const budgetText = await rl.question("Budget (INR)? ");
  const quantityText = await rl.question("How many people? ");
  const premiumText = await rl.question("Premium (yes/no)? ");
  const dislikesText = await rl.question("Any dislikes? (comma separated) ");

  const response = await orchestrator.handleRequest({
    message: craving,
    preferences: {
      budget: Number(budgetText),
      quantity: Number(quantityText),
      premium: premiumText.trim().toLowerCase().startsWith("y"),
      dislikes: dislikesText
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean),
      deliveryTimeWeight: 1,
    },
  });

  if (response.status === "need_more_info") {
    console.log("\nNeed more details:");
    for (const q of response.followUpQuestions ?? []) {
      console.log(`- ${q}`);
    }
  } else {
    const rec = response.recommendation;
    console.log("\nBest recommendation:");
    console.log(`Restaurant: ${rec?.restaurant}`);
    console.log(`Items: ${rec?.items.join(", ")}`);
    console.log(`Subtotal: ${formatINR(rec?.subtotal ?? 0)}`);
    console.log(`Final Price: ${formatINR(rec?.finalPrice ?? 0)}`);
    console.log(`Coupon: ${rec?.coupon ?? "None"}`);
    console.log(`Why: ${rec?.explanation}`);
    const confirm = await rl.question("Place order? (yes/no) ");
    console.log(confirm.trim().toLowerCase().startsWith("y") ? "Order would be placed (gated)." : "Order canceled.");
  }

  rl.close();
}

runCli().catch((error) => {
  console.error(error);
  process.exit(1);
});
