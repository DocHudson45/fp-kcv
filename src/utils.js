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

// ========== REINFORCEMENT LEARNING: Energy Profile Adaptation ==========

/**
 * Compute per-slot energy modifiers from task completion history.
 * Tasks completed on-time at a slot → boost energy estimate (model learns user is productive there).
 * Tasks abandoned at a slot → reduce energy estimate (model learns user struggles there).
 * 
 * Returns an array of 48 floats (modifiers centered around 1.0).
 */
export function computeRLModifiers(historyRecords) {
  const modifiers = new Array(TOTAL_SLOTS).fill(1.0);
  if (!historyRecords || historyRecords.length === 0) return modifiers;

  const slotScores = new Array(TOTAL_SLOTS).fill(0);
  const slotCounts = new Array(TOTAL_SLOTS).fill(0);

  // Weight recent records more heavily (exponential decay)
  const totalRecords = historyRecords.length;

  for (let i = 0; i < totalRecords; i++) {
    const rec = historyRecords[i];
    const slot = rec.scheduled_slot;
    if (slot == null || slot < 0 || slot >= TOTAL_SLOTS) continue;

    const slotsUsed = Math.max(1, Math.ceil((rec.duration_hours || 0.5) * 2));
    // Recency weight: more recent records have higher weight
    const recencyWeight = 0.5 + 0.5 * (i / totalRecords);

    for (let s = slot; s < Math.min(TOTAL_SLOTS, slot + slotsUsed); s++) {
      slotCounts[s] += recencyWeight;
      if (rec.was_abandoned) {
        slotScores[s] -= 0.6 * recencyWeight; // penalize slots where user abandoned
      } else if (rec.completed_on_time) {
        slotScores[s] += 1.0 * recencyWeight; // reward successful on-time completion
      } else {
        slotScores[s] += 0.3 * recencyWeight; // completed but late — slight positive
      }
    }
  }

  // Also learn from task-type patterns: which types succeed at which slots
  const typeSlotSuccess = {}; // { "analytical": { slot: score, ... }, ... }
  for (const rec of historyRecords) {
    const slot = rec.scheduled_slot;
    const type = rec.task_type;
    if (slot == null || !type) continue;
    if (!typeSlotSuccess[type]) typeSlotSuccess[type] = {};
    if (!typeSlotSuccess[type][slot]) typeSlotSuccess[type][slot] = { success: 0, total: 0 };
    typeSlotSuccess[type][slot].total++;
    if (!rec.was_abandoned && rec.completed_on_time) {
      typeSlotSuccess[type][slot].success++;
    }
  }

  // Convert accumulated scores to modifiers (range: 0.4 to 1.8)
  for (let s = 0; s < TOTAL_SLOTS; s++) {
    if (slotCounts[s] > 0) {
      const avgScore = slotScores[s] / slotCounts[s]; // range: roughly -0.6 to 1.0
      modifiers[s] = Math.max(0.4, Math.min(1.8, 1.0 + avgScore * 0.5));
    }
  }

  return modifiers;
}

/**
 * Build an RL-adjusted energy profile that incorporates learned patterns from history.
 * Combines the base chronotype curve with RL modifiers from past task performance.
 */
export function buildRLEnergyProfile(vibe, characterType, historyRecords) {
  const baseProfile = buildEnergyProfile(vibe, characterType);
  const modifiers = computeRLModifiers(historyRecords);

  return baseProfile.map((val, i) =>
    Math.max(0.05, Math.min(1.0, val * modifiers[i]))
  );
}

/**
 * Compute a summary of RL learning state for display/debug purposes.
 */
export function getRLSummary(historyRecords) {
  if (!historyRecords || historyRecords.length === 0) {
    return { totalRecords: 0, completionRate: 0, onTimeRate: 0, avgVibeChange: 0, bestSlots: [], worstSlots: [] };
  }
  const total = historyRecords.length;
  const completed = historyRecords.filter(r => !r.was_abandoned).length;
  const onTime = historyRecords.filter(r => r.completed_on_time && !r.was_abandoned).length;
  const vibeChanges = historyRecords.filter(r => r.vibe_before != null && r.vibe_after != null)
    .map(r => r.vibe_after - r.vibe_before);
  const avgVibeChange = vibeChanges.length > 0 ? vibeChanges.reduce((a, b) => a + b, 0) / vibeChanges.length : 0;

  const modifiers = computeRLModifiers(historyRecords);
  const indexed = modifiers.map((m, i) => ({ slot: i, mod: m }));
  const bestSlots = [...indexed].sort((a, b) => b.mod - a.mod).slice(0, 3).map(s => slotToTime(s.slot));
  const worstSlots = [...indexed].sort((a, b) => a.mod - b.mod).slice(0, 3).map(s => slotToTime(s.slot));

  return {
    totalRecords: total,
    completionRate: completed / total,
    onTimeRate: total > 0 ? onTime / total : 0,
    avgVibeChange,
    bestSlots,
    worstSlots,
  };
}

/**
 * Local RL scheduler — places tasks based on energy profile.
 * Analytical → highest energy slots, Routine → low energy slots.
 */
export function localRLScheduler(tasks, fixedBlocks, energyProfile, startHour = 5) {
  if (!tasks || tasks.length === 0) return [];
  const endSlot = 46;
  const occupied = new Set();
  (fixedBlocks || []).forEach(fb => { for (let s = fb.startSlot; s < fb.endSlot; s++) occupied.add(s); });

  const scoreSlot = (slot, n, type) => {
    let e = 0;
    for (let s = slot; s < slot + n; s++) { if (s >= endSlot || occupied.has(s)) return -Infinity; e += energyProfile[s] || 0; }
    const avg = e / n;
    if (type === "analytical") return avg * 2.0;
    if (type === "creative") return avg * 1.2;
    return 1.0 - avg * 0.5;
  };

  const prio = { analytical: 0, creative: 1, routine: 2 };
  const sorted = [...tasks].sort((a, b) => (prio[a.task_type] ?? 1) - (prio[b.task_type] ?? 1) || (b.priority || 3) - (a.priority || 3));
  const result = [];
  const start = Math.max(0, Math.ceil(startHour * 2));

  for (const task of sorted) {
    const n = Math.max(1, Math.round((task.duration || 0.5) * 2));
    let bestS = -1, bestSc = -Infinity;
    for (let s = start; s + n <= endSlot; s++) { const sc = scoreSlot(s, n, task.task_type); if (sc > bestSc) { bestSc = sc; bestS = s; } }
    if (bestS >= 0) {
      for (let s = bestS; s < bestS + n; s++) occupied.add(s);
      result.push({ ...task, scheduled_start: bestS, scheduled_slots: n, assigned_block: "RL" });
    }
  }
  return result.sort((a, b) => a.scheduled_start - b.scheduled_start);
}
