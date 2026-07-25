const form = document.getElementById("recommend-form");
const output = document.getElementById("output");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  output.textContent = "Searching...";

  const payload = {
    query: document.getElementById("query").value,
    budget: Number(document.getElementById("budget").value),
    quantity: Number(document.getElementById("quantity").value),
    premium: document.getElementById("premium").value === "true",
    dislikes: document
      .getElementById("dislikes")
      .value.split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    deliveryTimeWeight: 1,
  };

  try {
    const response = await fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    output.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    output.textContent = `Error: ${String(error)}`;
  }
});
