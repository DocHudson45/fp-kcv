export const API_URL = process.env.REACT_APP_DDQN_API_URL || "http://localhost:8000";

export const CHRONOTYPES = [
  { key: "morning", name: "Morning Person", emoji: "🌅", peak: "8am–12pm" },
  { key: "intermediate", name: "Intermediate", emoji: "☀️", peak: "10am–2pm" },
  { key: "evening", name: "Night Owl", emoji: "🌙", peak: "4pm–9pm" },
];

export const cogDemandStrToFloat = (s) => (s === "low" ? 0.4 : s === "medium" ? 0.6 : 1.0);
export const priorityToImportance = (p) => p / 5.0;

export function deadlineToHour(str) {
  if (!str) return 23.98;
  const [h, m] = str.split(":").map(Number);
  return h + (m || 0) / 60;
}

export const STORAGE_KEY = "apuahrls-data-v3";
export const saveData = (d) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch {} };
export const loadData = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; } };

export const fmt = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
};

export const slotToTime = (slot) => {
  const h = Math.floor(slot / 2);
  const m = slot % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2,"0")}:${m}`;
};

export const TOTAL_SLOTS = 48; // Full 24h day, 30-min slots starting from midnight (00:00)
export const ENERGY_LABELS = ["", "Exhausted", "Low", "Moderate", "Good", "Peak"];
export const DEMAND_COLORS = {
  high: { bg: "rgba(220,38,38,0.15)", border: "#dc2626", text: "#fca5a5" },
  medium: { bg: "rgba(245,158,11,0.15)", border: "#f59e0b", text: "#fcd34d" },
  low: { bg: "rgba(34,197,94,0.15)", border: "#22c55e", text: "#86efac" },
};
export const BLOCK_COLORS = {
  "analytical": { bg: "rgba(168,85,247,0.08)", border: "#a855f7", text: "#c084fc" },
  "routine": { bg: "rgba(34,197,94,0.06)", border: "#22c55e", text: "#86efac" },
  "creative": { bg: "rgba(245,158,11,0.06)", border: "#f59e0b", text: "#fcd34d" },
  "Admin": { bg: "rgba(245,158,11,0.06)", border: "#f59e0b", text: "#fcd34d" },
};

// Character-specific energy curves
export const ENERGY_CURVES = {
  morning:      (h) => h < 8 ? 0.3 : h < 12 ? 0.95 : h < 15 ? 0.45 : h < 19 ? 0.65 : 0.2, 
  intermediate: (h) => h < 10 ? 0.4 : h < 14 ? 0.90 : h < 16 ? 0.50 : h < 17 ? 0.60 : 0.3,
  evening:      (h) => h < 9 ? 0.2 : h < 11 ? 0.45 : h < 16 ? 0.6 : h < 21 ? 0.90 : h < 24 ? 0.65 : 0.3,
};

export function buildEnergyProfile(vibe, characterType = "morning") {
  const curve = ENERGY_CURVES[characterType] || ENERGY_CURVES.morning;
  return Array.from({ length: TOTAL_SLOTS }, (_, i) => {
    const hour = i / 2; // Slot 0 = 00:00
    const base = curve(hour);
    return Math.max(0.08, base * (0.5 + 0.5 * vibe)); 
  });
}

// Fallback manager and worker heuristic exactly as referenced, but adapted for analytical/routine/creative
export function managerAgent(energyProfile, occupied, currentSlot) {
  const blocks = [];
  const available = [];
  for (let s = 0; s < TOTAL_SLOTS; s++) available.push(!occupied.has(s) && s >= currentSlot);

  let blockStart = -1, runLength = 0;
  for (let s = 0; s <= TOTAL_SLOTS; s++) {
    if (s < TOTAL_SLOTS && available[s]) {
      if (blockStart === -1) blockStart = s;
      runLength++;
    } else {
      if (blockStart !== -1 && runLength >= 2) {
        let pos = blockStart;
        while (pos < blockStart + runLength) {
          const remaining = blockStart + runLength - pos;
          const blockSize = remaining >= 10 ? 8 : remaining >= 6 ? Math.min(8, remaining) : remaining;
          if (blockSize < 2) break;
          const avgEnergy = energyProfile.slice(pos, pos + blockSize).reduce((a, b) => a + b, 0) / blockSize;
          let type;
          if (avgEnergy > 0.7) type = "analytical";
          else if (avgEnergy > 0.45) type = "creative";
          else type = "routine";
          blocks.push({ type, startSlot: pos, endSlot: pos + blockSize, avgEnergy });
          pos += blockSize;
        }
      }
      blockStart = -1;
      runLength = 0;
    }
  }
  return blocks;
}

export function workerAgent(tasks, managerBlocks, energyProfile, occupied) {
  const scheduled = [];
  const usedTasks = new Set();
  const localOccupied = new Set(occupied);

  const sortedBlocks = [...managerBlocks].sort((a, b) => b.avgEnergy - a.avgEnergy);
  const sortedTasks = [...tasks].filter(t => !t.is_archived && !t.is_fixed).sort((a, b) => {
    const sa = (a.importance || 0.6) * (a.cognitive_demand || 0.6);
    const sb = (b.importance || 0.6) * (b.cognitive_demand || 0.6);
    return sb - sa;
  });

  for (const block of sortedBlocks) {
    const candidates = sortedTasks.filter(t => {
      if (usedTasks.has(t.id)) return false;
      const type = t.task_type || "routine";
      if (block.type === "analytical") return type === "analytical" || type === "creative";
      if (block.type === "creative") return type === "creative" || type === "routine";
      return type === "routine";
    });

    for (const task of candidates) {
      if (usedTasks.has(task.id)) continue;
      const slotsNeeded = Math.max(1, Math.ceil((task.duration || 0.5) * 2));
      let bestStart = -1, bestScore = -Infinity;

      for (let s = block.startSlot; s <= block.endSlot - slotsNeeded; s++) {
        let valid = true;
        for (let k = 0; k < slotsNeeded; k++) if (localOccupied.has(s + k)) { valid = false; break; }
        if (!valid) continue;
        if (task.deadline) {
          const dlSlot = Math.floor(task.deadline * 2);
          if (s + slotsNeeded > dlSlot) continue;
        }
        let score = 0;
        for (let k = 0; k < slotsNeeded; k++) score += energyProfile[s + k] * (task.cognitive_demand || 0.6);
        score += (task.importance || 0.6) * 3;
        if (score > bestScore) { bestScore = score; bestStart = s; }
      }

      if (bestStart >= 0) {
        for (let k = 0; k < slotsNeeded; k++) localOccupied.add(bestStart + k);
        scheduled.push({ ...task, scheduled_start: bestStart, scheduled_slots: slotsNeeded, assigned_block: block.type });
        usedTasks.add(task.id);
      }
    }
  }

  for (const task of sortedTasks) {
    if (usedTasks.has(task.id)) continue;
    const slotsNeeded = Math.max(1, Math.ceil((task.duration || 0.5) * 2));
    for (let s = 0; s < TOTAL_SLOTS - slotsNeeded; s++) {
      let valid = true;
      for (let k = 0; k < slotsNeeded; k++) if (localOccupied.has(s + k)) { valid = false; break; }
      if (!valid) continue;
      for (let k = 0; k < slotsNeeded; k++) localOccupied.add(s + k);
      scheduled.push({ ...task, scheduled_start: s, scheduled_slots: slotsNeeded, assigned_block: "Overflow" });
      usedTasks.add(task.id);
      break;
    }
  }
  return scheduled;
}

export function generateScheduleFallback(tasks, fixedBlocks, vibe, characterType = "morning") {
  const now = new Date();
  const currentSlot = Math.min(TOTAL_SLOTS - 1, now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0));
  
  const occupied = new Set();
  fixedBlocks.forEach(fb => { for (let s = fb.startSlot; s < fb.endSlot; s++) occupied.add(s); });
  
  for (let s = 0; s < currentSlot; s++) occupied.add(s);
  
  const energyProfile = buildEnergyProfile(vibe, characterType);
  const managerBlocks = managerAgent(energyProfile, occupied, currentSlot);
  const scheduled = workerAgent(tasks, managerBlocks, energyProfile, occupied);
  return { scheduled, managerBlocks, energyProfile };
}
