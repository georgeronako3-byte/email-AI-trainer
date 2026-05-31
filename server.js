import "dotenv/config";
import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

// ===== SUPABASE SETUP =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

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

// ===== TRAINING ROUTE =====
app.post("/train", async (req, res) => {
  try {
    const { test_email } = req.body;

    if (!test_email) {
      return res.status(400).json({ error: "Missing test email" });
    }

    // Step 1: Your AI generates a reply
    const yourReply = await callGroq(
      `Reply to this customer email: ${test_email}`,
      "You are a helpful e-commerce customer support assistant."
    );
    await delay(3000);

    // Step 2: Competitor AIs generate replies
    const competitor1Reply = await callGroq(
      `Reply to this customer email: ${test_email}`,
      "You are a world class customer support agent. Write the best possible reply.",
      "llama-3.3-70b-versatile"
    );
    await delay(3000);

    const competitor2Reply = await callGroq(
      `Reply to this customer email: ${test_email}`,
      "You are a world class customer support agent. Write the best possible reply.",
      "gemma2-9b-it"
    );
    await delay(3000);

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

    // Step 4: Save to Supabase
    const { error } = await supabase.from("training_results").insert({
      test_email,
      your_ai_reply: yourReply,
      openai_reply: competitor1Reply,
      gemini_reply: competitor2Reply,
      judge_scores: judgeResult,
      winner: "TBD",
    });

    if (error) throw error;

    return res.json({
      your_reply: yourReply,
      competitor_reply: competitor1Reply,
      judge: judgeResult,
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
