import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AgentOrchestrator } from "./agent/orchestrator";
import { formatINR } from "./utils/currency";
import { mcpClient } from "./mcp/runtime";
import { AddressMcpService } from "./mcp/address";

async function runCli(): Promise<void> {
  const rl = createInterface({ input, output });
  const orchestrator = new AgentOrchestrator();
  try {
    let addressId: string | undefined;
    if (!mcpClient.isMockMode()) {
      if (!mcpClient.hasAccessToken()) throw new Error("Use npm run dev:web to sign in, or configure SWIGGY_MCP_ACCESS_TOKEN for CLI mode.");
      const service = new AddressMcpService(mcpClient);
      let page = 1;
      while (!addressId) {
        const result = await service.getAddresses(page);
        result.addresses.forEach((address, index) => console.log(`${index + 1}. ${address.addressTag ?? "Address"}: ${address.addressLine}`));
        const choice = await rl.question(`Choose delivery address${result.pagination.hasMore ? " (or n for next page)" : ""}: `);
        if (choice === "n" && result.pagination.hasMore) { page += 1; continue; }
        addressId = result.addresses[Number(choice) - 1]?.id;
        if (!addressId) throw new Error("No valid delivery address selected.");
      }
    }

    const craving = await rl.question("What are you craving? ");
    const budgetText = await rl.question("Budget (INR)? ");
    const quantityText = await rl.question("How many people? ");
    const premiumText = await rl.question("Premium (yes/no)? ");
    const dislikesText = await rl.question("Any dislikes? (comma separated) ");

    const response = await orchestrator.handleRequest({
      message: craving,
      addressId,
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
      console.log(`${rec?.pricingIsEstimate ? "Estimated item total" : "Final Price"}: ${formatINR(rec?.finalPrice ?? 0)}`);
      console.log(`Coupon: ${rec?.coupon ?? "None"}`);
      console.log(`Why: ${rec?.explanation}`);
      console.log("Recommendation only. Checkout is not connected to this interface.");
    }

  } finally {
    rl.close();
    await mcpClient.close();
  }
}

runCli().catch((error) => {
  console.error(error);
  process.exit(1);
});
