/**
 * test_rl_proof.js
 * 
 * Proves that the RL energy profile adaptation works.
 * Shows the difference in energy profiles and task scheduling
 * with and without history data.
 * 
 * Run: node test_rl_proof.js
 */

// ===== Inline copies of the relevant functions from utils.js =====
const TOTAL_SLOTS = 48;

const ENERGY_CURVES = {
  morning:      (h) => h < 8 ? 0.3 : h < 12 ? 0.95 : h < 15 ? 0.45 : h < 19 ? 0.65 : 0.2, 
  intermediate: (h) => h < 10 ? 0.4 : h < 14 ? 0.90 : h < 16 ? 0.50 : h < 17 ? 0.60 : 0.3,
  evening:      (h) => h < 9 ? 0.2 : h < 11 ? 0.45 : h < 16 ? 0.6 : h < 21 ? 0.90 : h < 24 ? 0.65 : 0.3,
};

function buildEnergyProfile(vibe, characterType = "morning") {
  const curve = ENERGY_CURVES[characterType] || ENERGY_CURVES.morning;
  return Array.from({ length: TOTAL_SLOTS }, (_, i) => {
    const hour = i / 2;
    const base = curve(hour);
    return Math.max(0.08, base * (0.5 + 0.5 * vibe)); 
  });
}

function computeRLModifiers(historyRecords) {
  const modifiers = new Array(TOTAL_SLOTS).fill(1.0);
  if (!historyRecords || historyRecords.length === 0) return modifiers;
  const slotScores = new Array(TOTAL_SLOTS).fill(0);
  const slotCounts = new Array(TOTAL_SLOTS).fill(0);
  const totalRecords = historyRecords.length;
  for (let i = 0; i < totalRecords; i++) {
    const rec = historyRecords[i];
    const slot = rec.scheduled_slot;
    if (slot == null || slot < 0 || slot >= TOTAL_SLOTS) continue;
    const slotsUsed = Math.max(1, Math.ceil((rec.duration_hours || 0.5) * 2));
    const recencyWeight = 0.5 + 0.5 * (i / totalRecords);
    for (let s = slot; s < Math.min(TOTAL_SLOTS, slot + slotsUsed); s++) {
      slotCounts[s] += recencyWeight;
      if (rec.was_abandoned) {
        slotScores[s] -= 0.6 * recencyWeight;
      } else if (rec.completed_on_time) {
        slotScores[s] += 1.0 * recencyWeight;
      } else {
        slotScores[s] += 0.3 * recencyWeight;
      }
    }
  }
  for (let s = 0; s < TOTAL_SLOTS; s++) {
    if (slotCounts[s] > 0) {
      const avgScore = slotScores[s] / slotCounts[s];
      modifiers[s] = Math.max(0.7, Math.min(1.4, 1.0 + avgScore * 0.2));
    }
  }
  return modifiers;
}

function buildRLEnergyProfile(vibe, characterType, historyRecords) {
  const baseProfile = buildEnergyProfile(vibe, characterType);
  const modifiers = computeRLModifiers(historyRecords);
  return baseProfile.map((val, i) => Math.max(0.05, Math.min(1.0, val * modifiers[i])));
}

function slotToTime(slot) {
  const h = Math.floor(slot / 2);
  const m = slot % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2,"0")}:${m}`;
}

// ===== Test Data =====

// Scenario: User is very productive 8-12 AM, always abandons tasks 14-17 PM
function generateTestHistory() {
  const history = [];
  
  // 5 days of history
  for (let day = 0; day < 5; day++) {
    const date = `2026-04-${13 + day}`;
    
    // MORNING (slots 16-24, 8:00-12:00): Always completed on time
    for (let i = 0; i < 3; i++) {
      const slot = 16 + i * 2; // 8:00, 9:00, 10:00
      history.push({
        task_type: "analytical",
        duration_hours: 1.0,
        completed_on_time: 1,
        was_abandoned: 0,
        vibe_before: 0.7,
        vibe_after: 0.8,
        scheduled_slot: slot,
        date,
        day,
      });
    }
    
    // AFTERNOON (slots 28-34, 14:00-17:00): Always abandoned!
    for (let i = 0; i < 2; i++) {
      const slot = 28 + i * 3; // 14:00, 15:30
      history.push({
        task_type: "analytical",
        duration_hours: 1.0,
        completed_on_time: 0,
        was_abandoned: 1,
        vibe_before: 0.4,
        vibe_after: 0.2,
        scheduled_slot: slot,
        date,
        day,
      });
    }
    
    // EVENING (slots 36-40, 18:00-20:00): Completed but late
    history.push({
      task_type: "creative",
      duration_hours: 1.5,
      completed_on_time: 0,
      was_abandoned: 0,
      vibe_before: 0.5,
      vibe_after: 0.5,
      scheduled_slot: 36,
      date,
      day,
    });
  }
  
  return history;
}

// ===== Run the proof =====

console.log("╔═══════════════════════════════════════════════════════════════╗");
console.log("║        RL ENERGY PROFILE ADAPTATION — PROOF OF CONCEPT      ║");
console.log("╚═══════════════════════════════════════════════════════════════╝\n");

const vibe = 0.5;
const chronotype = "morning";
const history = generateTestHistory();

console.log(`📋 Test Setup:`);
console.log(`   Chronotype: ${chronotype}`);
console.log(`   Vibe: ${vibe}`);
console.log(`   History records: ${history.length}`);
console.log(`   Pattern: Morning=success, Afternoon=abandoned, Evening=late\n`);

// 1. Base profile (no history)
const baseProfile = buildEnergyProfile(vibe, chronotype);

// 2. RL-adjusted profile (with history)
const rlProfile = buildRLEnergyProfile(vibe, chronotype, history);

// 3. RL modifiers
const modifiers = computeRLModifiers(history);

// Show comparison table
console.log("┌────────┬──────────┬──────────┬──────────┬────────────────────────┐");
console.log("│  Time  │   Base   │    RL    │ Modifier │ Change                 │");
console.log("├────────┼──────────┼──────────┼──────────┼────────────────────────┤");

const keySlots = [
  10, // 05:00
  14, // 07:00
  16, // 08:00 — morning success zone starts
  18, // 09:00
  20, // 10:00
  22, // 11:00
  24, // 12:00 — morning success zone ends
  26, // 13:00
  28, // 14:00 — afternoon abandon zone starts
  30, // 15:00
  32, // 16:00
  34, // 17:00 — afternoon abandon zone ends
  36, // 18:00 — evening late zone
  38, // 19:00
  40, // 20:00
];

for (const slot of keySlots) {
  const time = slotToTime(slot);
  const base = baseProfile[slot];
  const rl = rlProfile[slot];
  const mod = modifiers[slot];
  const diff = rl - base;
  
  let bar = "";
  const barLen = Math.round(Math.abs(diff) * 50);
  if (diff > 0.01) {
    bar = "▲ " + "█".repeat(barLen) + ` +${(diff*100).toFixed(1)}%`;
  } else if (diff < -0.01) {
    bar = "▼ " + "░".repeat(barLen) + ` ${(diff*100).toFixed(1)}%`;
  } else {
    bar = "= no change";
  }
  
  console.log(`│ ${time}  │  ${base.toFixed(3)}   │  ${rl.toFixed(3)}   │  ${mod.toFixed(3)}   │ ${bar.padEnd(22)} │`);
}

console.log("└────────┴──────────┴──────────┴──────────┴────────────────────────┘\n");

// 4. Show how this affects task placement
console.log("📊 Impact on Scheduling:");
console.log("─────────────────────────────────────────────────");

// Find best slots for analytical tasks (high energy needed)
const baseTop5 = baseProfile.map((e, i) => ({slot: i, energy: e}))
  .filter(s => s.slot >= 10 && s.slot <= 42)
  .sort((a,b) => b.energy - a.energy)
  .slice(0, 5);

const rlTop5 = rlProfile.map((e, i) => ({slot: i, energy: e}))
  .filter(s => s.slot >= 10 && s.slot <= 42)
  .sort((a,b) => b.energy - a.energy)
  .slice(0, 5);

console.log("\n🔵 WITHOUT RL — Best slots for analytical tasks:");
baseTop5.forEach((s, i) => {
  console.log(`   ${i+1}. ${slotToTime(s.slot)} (energy: ${s.energy.toFixed(3)})`);
});

console.log("\n🟢 WITH RL — Best slots for analytical tasks:");
rlTop5.forEach((s, i) => {
  console.log(`   ${i+1}. ${slotToTime(s.slot)} (energy: ${s.energy.toFixed(3)})`);
});

// Show worst slots
const rlBottom5 = rlProfile.map((e, i) => ({slot: i, energy: e}))
  .filter(s => s.slot >= 10 && s.slot <= 42)
  .sort((a,b) => a.energy - b.energy)
  .slice(0, 5);

console.log("\n🔴 WITH RL — Worst slots (RL learned to avoid):");
rlBottom5.forEach((s, i) => {
  console.log(`   ${i+1}. ${slotToTime(s.slot)} (energy: ${s.energy.toFixed(3)})`);
});

// Summary
console.log("\n╔═══════════════════════════════════════════════════════════════╗");
console.log("║                        CONCLUSION                           ║");
console.log("╠═══════════════════════════════════════════════════════════════╣");

const morningBoost = (rlProfile[18] - baseProfile[18]) / baseProfile[18] * 100;
const afternoonDrop = (rlProfile[30] - baseProfile[30]) / baseProfile[30] * 100;

console.log(`║  Morning (09:00) energy: ${baseProfile[18].toFixed(3)} → ${rlProfile[18].toFixed(3)} (${morningBoost > 0 ? '+' : ''}${morningBoost.toFixed(1)}%)`.padEnd(64) + "║");
console.log(`║  Afternoon (15:00) energy: ${baseProfile[30].toFixed(3)} → ${rlProfile[30].toFixed(3)} (${afternoonDrop > 0 ? '+' : ''}${afternoonDrop.toFixed(1)}%)`.padEnd(64) + "║");
console.log("║                                                              ║");
console.log("║  ✅ RL BOOSTED morning slots (user succeeds there)           ║");
console.log("║  ❌ RL REDUCED afternoon slots (user abandons there)         ║");
console.log("║  → Scheduler will place hard tasks in morning, not afternoon ║");
console.log("╚═══════════════════════════════════════════════════════════════╝");
