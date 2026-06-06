import "dotenv/config";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { businesses } from "./businesses.js";

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

// ===== SUPABASE SETUP =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ===== COMPETITOR MODEL TIERS =====
const competitorTiers = [
  { b: "llama-3.3-70b-versatile", c: "openai/gpt-oss-120b" },
  { b: "openai/gpt-oss-120b", c: "llama-3.3-70b-versatile" },
  { b: "openai/gpt-oss-120b", c: "llama-3.3-70b-versatile" },
];
// ===== DELAY HELPER =====
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ===== GROQ AI CALL =====
async function callGroq(prompt, systemPrompt, model = "llama-3.1-8b-instant") {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) {
      console.error(`Model ${model} returned null. Error:`, data);
      return `[Model ${model} failed to respond]`;
    }
    return reply;
  } catch (err) {
    console.error(`Model ${model} crashed:`, err);
    return `[Model ${model} crashed]`;
  }
}

// ===== GET WIN COUNT =====
async function getWinCount(model) {
  const { data, error } = await supabase
    .from("win_counts")
    .select("wins")
    .eq("model", model)
    .single();
  if (error) console.error("getWinCount error:", error);
  console.log(`Win count for ${model}:`, data?.wins);
  return data?.wins ?? 0;
}
// ===== UPDATE WIN COUNT =====
async function updateWinCount(model) {
  const current = await getWinCount(model);
  await supabase
    .from("win_counts")
    .upsert({ model, wins: current + 1 }, { onConflict: "model" });
  return current + 1;
}

// ===== GET CURRENT TIER =====
async function getCurrentTier() {
  const wins = await getWinCount("A");
  const tierIndex = Math.min(Math.floor(wins / 20), competitorTiers.length - 1);
  return competitorTiers[tierIndex];
}

// ===== SAVE PROMPT MEMORY =====
async function saveMemory(type, email, reply, feedback) {
  await supabase.from("prompt_memory").insert({ type, email, reply, feedback });
}

// ===== GET RECENT MEMORIES =====
async function getRecentMemories() {
  const { data } = await supabase
    .from("prompt_memory")
    .select("*")
    .order("id", { ascending: false })
    .limit(5);
  return data || [];
}

// ===== TRAINING ROUTE =====
app.post("/train", async (req, res) => {
  try {
    const { test_email } = req.body;

    // Pick a random business
const business = businesses[Math.floor(Math.random() * businesses.length)];
console.log(`Using business: ${business.shopName}`);

    if (!test_email) {
      return res.status(400).json({ error: "Missing test email" });
    }

    // Get current competitor tier
    const tier = await getCurrentTier();
    console.log(`Using competitors: B=${tier.b}, C=${tier.c}`);

    // Get recent memories to improve A's prompt
    const memories = await getRecentMemories();
    let memoryContext = "";
    if (memories.length > 0) {
      const rewards = memories.filter(m => m.type === "reward").map(m => `Good example: ${m.reply}`).join("\n");
      const punishments = memories.filter(m => m.type === "punishment").map(m => `Avoid this: ${m.feedback}`).join("\n");
      memoryContext = `\n\nPAST FEEDBACK:\n${rewards}\n${punishments}`;
    }

    // Step 1: Your AI generates a reply
    const yourReply = await callGroq(
      `Reply to this customer email: ${test_email}`,
      `You are a helpful customer support assistant for ${business.shopName}.
    Business Category: ${business.category}
    Business Hours: ${business.hours}
    Return Policy: ${business.returnPolicy}
    Shipping Policy: ${business.shippingPolicy}
    Products: ${business.products}
    ${memoryContext}`
    );

    await delay(5000);

    // Step 2: Competitor AIs generate replies
    const competitor1Reply = await callGroq(
      `Reply to this customer email: ${test_email}`,
      "You are a world class customer support agent. Write the best possible reply.",
      tier.b
    );
    await delay(5000);

    const competitor2Reply = await callGroq(
      `Reply to this customer email: ${test_email}`,
      "You are a world class customer support agent. Write the best possible reply.",
      tier.c
    );
    await delay(5000);

    // Step 3: Judge scores all three replies
    const judgePrompt = `
You are an AI judge scoring three email replies.
Score each reply from 1-10 on:
1. Helpfulness to the customer
2. How human it sounds

CUSTOMER EMAIL:
${test_email}

REPLY A (Your AI):
${yourReply}

REPLY B (Competitor 1):
${competitor1Reply}

REPLY C (Competitor 2):
${competitor2Reply}

Give scores and pick a winner. Explain why in 2-3 sentences.
Format your response as JSON like this:
{
  "reply_a_score": 8,
  "reply_b_score": 7,
  "reply_c_score": 6,
  "winner": "A",
  "reasoning": "Reply A was more helpful because..."
}
`;

    let judgeResult = await callGroq(judgePrompt, "You are a strict but fair AI judge. Always respond with valid JSON only. No extra text, no markdown, no backticks.");
    judgeResult = judgeResult?.replace(/```json|```/g, "").trim();

    // Step 4: Parse judge result and update win counts
    let winner = "unknown";
    let reasoning = "";
    try {
      const parsed = JSON.parse(judgeResult);
      winner = parsed.winner;
      reasoning = parsed.reasoning;
    } catch (e) {
      console.error("Could not parse judge result:", judgeResult);
    }

    // Update win count and save memory
    if (winner === "A") {
      const newWins = await updateWinCount("A");
      await saveMemory("reward", test_email, yourReply, reasoning);
      console.log(`✅ A won! Total A wins: ${newWins}`);
      if (newWins % 20 === 0) {
        console.log(`🔥 A hit ${newWins} wins! Competitors upgrading to harder tier!`);
      }
    } else {
      await updateWinCount(winner === "B" ? "B" : "C");
      await saveMemory("punishment", test_email, yourReply, `A lost to ${winner}. Reason: ${reasoning}`);
      console.log(`❌ A lost to ${winner}. Saving feedback.`);
    }

    // Step 5: Save to Supabase
    const { error } = await supabase.from("training_results").insert({
      test_email,
      your_ai_reply: yourReply,
      openai_reply: competitor1Reply,
      gemini_reply: competitor2Reply,
      judge_scores: judgeResult,
      winner,
    });

    if (error) throw error;

    return res.json({
      your_reply: yourReply,
      competitor_reply: competitor1Reply,
      judge: judgeResult,
      winner,
    });

  } catch (err) {
    console.error("ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`Training server running on http://localhost:${PORT}`);
});
