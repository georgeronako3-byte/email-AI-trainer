import { testEmails } from "./emails.js";

async function runTraining() {
  console.log(`Starting training with ${testEmails.length} emails...`);

  for (let i = 0; i < testEmails.length; i++) {
    const email = testEmails[i];
    console.log(`\nRunning email ${i + 1} of ${testEmails.length}...`);

    try {
      const response = await fetch("https://email-ai-trainer.onrender.com/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test_email: email }),
      });

      const data = await response.json();
      console.log(`✅ Email ${i + 1} done. Judge result: ${data.judge}`);

    } catch (err) {
        console.log(`❌ Email ${i + 1} failed:`, err);
    }

    // Wait 2 seconds between each email to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 20000));
  }

  console.log("\n🎉 Training complete! Check Supabase for all results.");
}

async function loop() {
  while (true) {
    await runTraining();
    console.log("\n🔄 Starting next round...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

loop();
