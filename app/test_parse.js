require('dotenv').config({ path: '.env.local' });
const apiKey = process.env.REACT_APP_GEMINI_API_KEY;
const nlInput = "Aku ada kelas jam 12-13 hari ini, ada presentasi jadi aku harus belajar dulu. Terus ada tugas resum PAA pak rully jam 23.59. Rada sulit sih. Trus ada lagi dl jam 23.59 tentang K-means ML.";

const payload = {
  systemInstruction: {
    parts: [{
      text: "Current timestamp (ISO): 2026-04-14T18:00:00.000Z\n\nYou are a task parser for an AI scheduling system. Extract tasks and events from the user's input.\n\nRULES:\n1. Extract every task, event, and deadline mentioned.\n2. Categorize each into EXACTLY ONE of these categories: \"analytical\", \"routine\", \"creative\".\n3. Mark events with specific times as \"fixed\" (type=\"fixed\", include start/end as ISO datetime).\n4. Mark tasks that can be scheduled flexibly as \"flexible\" (type=\"flexible\").\n5. Set priority 1-5 (5=most urgent/important).\n6. Set cognitive_demand 1-5 based on mental focus needed.\n7. Duration: estimate if not specified. Use formats like \"30m\", \"1h\".\n8. Deadline: use ISO format.\n9. If the user expresses tiredness, stress, or excitement: Add to energy_forecast with scale: -2=exhausted, -1=tired, 0=normal, 1=good, 2=energized"
    }]
  },
  contents: [{ parts: [{ text: nlInput }] }],
  generationConfig: {
    temperature: 0.1,
    responseMimeType: "application/json",
  }
};

fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
}).then(r => r.json()).then(data => {
  const jsonStr = data.candidates?.[0]?.content?.parts?.[0]?.text || "Failed";
  let parsed = jsonStr;
  try { parsed = JSON.stringify(JSON.parse(jsonStr), null, 2); } catch(e){}
  const out = `input:\n${nlInput}\n\nJson (parsed):\n${parsed}`;
  require('fs').writeFileSync('debug_output.txt', out);
  console.log("Done. Check debug_output.txt");
});
