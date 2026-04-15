import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  API_URL,
  CHRONOTYPES,
  TOTAL_SLOTS,
  ENERGY_LABELS,
  BLOCK_COLORS,
  buildEnergyProfile,
  fmt,
  slotToTime,
  deadlineToHour,
  priorityToImportance,
  cogDemandStrToFloat,
} from "./utils";
import { db } from "./db";

const PriorityDots = ({ level }) => (
  <span style={{ display: "inline-flex", gap: 2 }}>
    {[1, 2, 3, 4, 5].map((i) => (
      <span
        key={i}
        style={{ width: 5, height: 5, borderRadius: "50%", background: i <= level ? "#f59e0b" : "#27272a" }}
      />
    ))}
  </span>
);

const DailyTimeline = ({ schedule, fixedBlocks, energyProfile }) => {
  const now = new Date();
  const nowSlot = now.getHours() * 2 + Math.floor(now.getMinutes() / 30);
  const maxEnergy = Math.max(...energyProfile, 1);
  const SLOT_HEIGHT = 40; // Fixed height per 30-min slot in pixels
  const TOTAL_HEIGHT = SLOT_HEIGHT * TOTAL_SLOTS; // 48 slots * 40px = 1920px

  return (
    <div style={{ position: "relative", minHeight: TOTAL_HEIGHT, width: "100%" }}>
      {/* Time labels on the left */}
      <div style={{ display: "flex", gap: 12, height: "100%" }}>
        <div style={{ width: 50, flexShrink: 0, position: "relative", height: TOTAL_HEIGHT }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              style={{
                height: SLOT_HEIGHT * 2,
                fontSize: 10,
                fontWeight: 600,
                color: "#52525b",
                display: "flex",
                alignItems: "flex-start",
                paddingTop: 4,
                paddingRight: 8,
                textAlign: "right",
                position: "absolute",
                top: h * SLOT_HEIGHT * 2,
                width: "100%",
              }}
            >
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {/* Main calendar grid */}
        <div style={{ flex: 1, position: "relative", borderLeft: "1px solid rgba(255,255,255,0.1)", height: TOTAL_HEIGHT, width: "100%" }}>
          {/* Draw all slots with fixed height */}
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, width: "100%", height: TOTAL_HEIGHT }}>
            {Array.from({ length: TOTAL_SLOTS }, (_, slot) => {
              const isHour = slot % 2 === 0;
              const isCurrent = slot === nowSlot;
              const ep = energyProfile[slot];
              const barH = Math.min(100, (ep / maxEnergy) * 100);

              return (
                <div
                  key={slot}
                  style={{
                    position: "absolute",
                    top: slot * SLOT_HEIGHT,
                    left: 0,
                    right: 0,
                    height: SLOT_HEIGHT,
                    borderBottom: isHour ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(255,255,255,0.02)",
                    background: isCurrent ? "rgba(52,211,153,0.02)" : "transparent",
                    padding: "2px 8px",
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    overflow: "hidden",
                  }}
                >
                  {/* Energy bar */}
                  <div style={{ width: 16, height: "100%", background: "#18181b", borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div
                      style={{
                        width: "80%",
                        height: `${barH}%`,
                        borderRadius: 1,
                        background: ep > 0.7 ? "#34d399" : ep > 0.4 ? "#f59e0b" : "#ef4444",
                        transition: "height 0.2s",
                      }}
                    />
                  </div>
                </div>
              );
            })}

            {/* Scheduled tasks */}
            {schedule.map((task) => (
              <div
                key={task.id}
                style={{
                  position: "absolute",
                  top: task.scheduled_start * SLOT_HEIGHT,
                  left: 30,
                  right: 8,
                  height: task.scheduled_slots * SLOT_HEIGHT - 2,
                  background: BLOCK_COLORS[task.task_type]?.bg || BLOCK_COLORS.routine.bg,
                  borderLeft: `3px solid ${BLOCK_COLORS[task.task_type]?.border || BLOCK_COLORS.routine.border}`,
                  borderRadius: 4,
                  padding: "6px 8px",
                  overflow: "hidden",
                  zIndex: 3,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: 10, color: BLOCK_COLORS[task.task_type]?.text || BLOCK_COLORS.routine.text, fontWeight: 600 }}>
                  {task.title}
                </span>
              </div>
            ))}

            {/* Fixed events */}
            {fixedBlocks.map((fixedBlock) => (
              <div
                key={fixedBlock.id}
                style={{
                  position: "absolute",
                  top: fixedBlock.startSlot * SLOT_HEIGHT,
                  left: 30,
                  right: 8,
                  height: (fixedBlock.endSlot - fixedBlock.startSlot) * SLOT_HEIGHT - 2,
                  background: "rgba(99,102,241,0.15)",
                  border: "1px solid rgba(129,140,248,0.4)",
                  borderRadius: 4,
                  padding: "6px 8px",
                  zIndex: 2,
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: 10, color: "#818cf8", fontWeight: 600 }}>
                  {fixedBlock.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [userState, setUserState] = useState(() => db.getUser());
  const [tasks, setTasks] = useState(() => db.getActiveTasks());
  const [view, setView] = useState("dashboard");
  const [vibe, setVibe] = useState(0.5); // 0.0 - 1.0 (defaults to 0.5)
  const [schedule, setSchedule] = useState(() => db.getScheduleForDay(db.getUser().current_day));
  const [fixedBlocks, setFixedBlocks] = useState(() => db.getFixedEvents());
  const [bufferPool, setBufferPool] = useState(() => db.getBufferPool());
  const [showAddTask, setShowAddTask] = useState(false);
  const [, setTick] = useState(0);
  const [form, setForm] = useState({
    title: "",
    category: "analytical",
    duration_estimate: 30,
    priority: 3,
    cognitive_demand: 3,
    deadline: "",
    is_fixed: false,
    startTime: "08:00",
    endTime: "10:00",
  });
  const [characterType, setCharacterType] = useState(() => db.getUser().chronotype);
  const [nlInput, setNlInput] = useState("");
  const [nlLoading, setNlLoading] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [historyRecords, setHistoryRecords] = useState(() => db.getHistory());
  const [toastMsg, setToastMsg] = useState("");
  const [nlError, setNlError] = useState("");
  const [debugPayload, setDebugPayload] = useState(null);
  const [debugResponse, setDebugResponse] = useState(null);
  const [showDebug, setShowDebug] = useState(false);
  const [editingItemId, setEditingItemId] = useState(null);
  const [editingItemType, setEditingItemType] = useState(null); // "task" or "fixed"
  const [editForm, setEditForm] = useState({
    title: "",
    category: "analytical",
    duration_estimate: 30,
    priority: 3,
    cognitive_demand: 3,
    deadline: "",
    startTime: "08:00",
    endTime: "10:00",
  });

  useEffect(() => {
    db.setActiveTasks(tasks);
    db.setFixedEvents(fixedBlocks);
    db.setScheduleForDay(userState.current_day, schedule);
  }, [tasks, fixedBlocks, schedule, userState.current_day]);

  useEffect(() => {
    db.updateUser({ chronotype: characterType });
  }, [characterType]);

  useEffect(() => {
    db.data.historyRecords = historyRecords;
    db.setBufferPool(bufferPool);
    db.save();
  }, [historyRecords, bufferPool]);

  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (toastMsg) {
      const t = setTimeout(() => setToastMsg(""), 3000);
      return () => clearTimeout(t);
    }
  }, [toastMsg]);

  const showToast = useCallback((msg) => setToastMsg(msg), []);

  const addTask = () => {
    if (!form.title.trim()) return;
    if (form.is_fixed) {
      const sh = parseInt(form.startTime.split(":")[0]);
      const sm = parseInt(form.startTime.split(":")[1] || "0");
      const eh = parseInt(form.endTime.split(":")[0]);
      const em = parseInt(form.endTime.split(":")[1] || "0");
      const startSlot = Math.min(TOTAL_SLOTS - 1, sh * 2 + Math.floor(sm / 30));
      const endSlot = Math.min(TOTAL_SLOTS, eh * 2 + Math.floor(em / 30));
      if (endSlot <= startSlot) return;
      setFixedBlocks((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          title: form.title.toUpperCase(),
          startSlot,
          endSlot,
          color: "#4338ca",
        },
      ]);
    } else {
      setTasks((prev) => [
        {
          id: crypto.randomUUID(),
          ...form,
          title: form.title.toUpperCase(),
          task_type: form.category,
          duration: form.duration_estimate / 60, // in hours
          is_running: false,
          total_duration: 0,
          last_started_at: null,
          is_archived: false,
          is_fixed: false,
          partial_done: 0.0,
        },
        ...prev,
      ]);
    }
    setForm({
      title: "",
      category: "analytical",
      duration_estimate: 30,
      priority: 3,
      cognitive_demand: 3,
      deadline: "",
      is_fixed: false,
      startTime: "08:00",
      endTime: "10:00",
    });
    setShowAddTask(false);
  };

  const toggleTask = (id) =>
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const now = Date.now();
        if (t.is_running) {
          const dur = t.last_started_at ? Math.floor((now - t.last_started_at) / 1000) : 0;
          return {
            ...t,
            is_running: false,
            total_duration: t.total_duration + dur,
            last_started_at: null,
          };
        }
        return { ...t, is_running: true, last_started_at: now };
      })
    );

  const discardTask = (id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setSchedule((prev) => prev.filter((s) => s.id !== id));
  };

  // Abandon logic => add partial completion, record history
  const abandonTask = (id) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const newPartial = t.partial_done + 0.5 * (1 - t.partial_done);
        
        // Add to history
        recordHistory(t, true);
        
        return {
          ...t,
          is_running: false,
          partial_done: newPartial,
          // optional: move to back of queue could be achieved implicitly
          // but we just reset it for DDQN to reschedule
        };
      })
    );
    setSchedule((prev) => prev.filter((s) => s.id !== id));
    showToast("Task abandoned & partial progress saved.");
  };

  const recordHistory = (task, was_abandoned) => {
    const elapsedHrs = (task.total_duration) / 3600; 
    let completed_on_time = 1;
    if (task.deadline) {
       const nowHour = new Date().getHours() + new Date().getMinutes()/60;
       if (nowHour > deadlineToHour(task.deadline)) completed_on_time = 0;
    }
    const record = {
      task_id: task.id,
      task_type: task.task_type || "analytical",
      duration_hours: task.duration,
      completed_on_time,
      actual_duration_hours: elapsedHrs,
      vibe_before: vibe,
      vibe_after: vibe, // In full flow, we'd prompt for vibe 2
      was_abandoned: was_abandoned ? 1 : 0,
      is_buffer: false,
      user_accepted_buffer: null,
      day: 0
    };
    setHistoryRecords(prev => [...prev, record]);
  };

  const archiveTask = (id) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        recordHistory(t, false);
        return { ...t, is_archived: true, is_running: false };
      })
    );
    setSchedule((prev) => prev.filter((s) => s.id !== id));
    // Vibe check #2 
    const vibe2 = window.prompt("Task complete! How is your energy now? (1-5)", ""+Math.round(vibe * 5));
    if (vibe2) {
      setVibe(Math.max(0.1, Math.min(1.0, parseInt(vibe2) / 5)));
    }
  };

  const removeFixed = (id) => setFixedBlocks((prev) => prev.filter((f) => f.id !== id));

  const startEditing = (itemId, itemType) => {
    setEditingItemId(itemId);
    setEditingItemType(itemType);
    
    if (itemType === "task") {
      const task = tasks.find(t => t.id === itemId);
      if (task) {
        setEditForm({
          title: task.title,
          category: task.task_type,
          duration_estimate: task.duration * 60,
          priority: task.priority,
          cognitive_demand: task.cognitive_demand,
          deadline: task.deadline,
          startTime: "08:00",
          endTime: "10:00",
        });
      }
    } else if (itemType === "fixed") {
      const fixed = fixedBlocks.find(f => f.id === itemId);
      if (fixed) {
        const startHour = Math.floor(fixed.startSlot / 2);
        const startMin = (fixed.startSlot % 2) * 30;
        const endHour = Math.floor(fixed.endSlot / 2);
        const endMin = (fixed.endSlot % 2) * 30;
        setEditForm({
          title: fixed.title,
          category: "routine",
          duration_estimate: 60,
          priority: 3,
          cognitive_demand: 3,
          deadline: "",
          startTime: `${String(startHour).padStart(2, "0")}:${String(startMin).padStart(2, "0")}`,
          endTime: `${String(endHour).padStart(2, "0")}:${String(endMin).padStart(2, "0")}`,
        });
      }
    }
  };

  const saveEdit = () => {
    if (!editForm.title.trim()) return;
    
    if (editingItemType === "task") {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== editingItemId) return t;
          return {
            ...t,
            title: editForm.title.toUpperCase(),
            task_type: editForm.category,
            duration: editForm.duration_estimate / 60,
            priority: editForm.priority,
            cognitive_demand: editForm.cognitive_demand,
            deadline: editForm.deadline,
          };
        })
      );
    } else if (editingItemType === "fixed") {
      setFixedBlocks((prev) =>
        prev.map((f) => {
          if (f.id !== editingItemId) return f;
          const sh = parseInt(editForm.startTime.split(":")[0]);
          const sm = parseInt(editForm.startTime.split(":")[1] || "0");
          const eh = parseInt(editForm.endTime.split(":")[0]);
          const em = parseInt(editForm.endTime.split(":")[1] || "0");
          const startSlot = Math.min(TOTAL_SLOTS - 1, sh * 2 + Math.floor(sm / 30));
          const endSlot = Math.min(TOTAL_SLOTS, eh * 2 + Math.floor(em / 30));
          return {
            ...f,
            title: editForm.title.toUpperCase(),
            startSlot,
            endSlot,
          };
        })
      );
    }
    setEditingItemId(null);
    setEditingItemType(null);
    showToast("Changes saved!");
  };

  const cancelEdit = () => {
    setEditingItemId(null);
    setEditingItemType(null);
  };

  const handleNlParse = async () => {
    if (!nlInput.trim()) return;
    const apiKey = process.env.REACT_APP_GEMINI_API_KEY;
    if (!apiKey) {
      setNlError("REACT_APP_GEMINI_API_KEY is missing in .env.local");
      return;
    }

    setNlLoading(true);
    setNlError("");
    try {
      const payload = {
        systemInstruction: {
          parts: [
            {
              text: `Current timestamp (ISO): ${new Date().toISOString()}
Today's date: ${new Date().toISOString().split('T')[0]}

You are a task parser for an AI scheduling system. Extract tasks and events from the user's input in Indonesian or English.

CRITICAL RULES FOR CLASSIFICATION:
- "fixed" type: Events/classes/meetings with EXPLICIT START AND END TIMES (MUST have both!)
  Examples: "kelas pbo jam 1-2", "meeting 3pm-4pm", "zoom call 10:00-11:00"
  → ALWAYS generate start and end ISO datetime like: "2026-04-15T13:00:00"
  
- "flexible" type: Tasks WITHOUT fixed times (just deadline or priority, need to be scheduled)
  Examples: "finish ML homework due 5pm", "beli groceries", "review notes"
  → Only include deadline, NOT start/end times

DATETIME FORMAT EXAMPLES:
- Input "jam 1-2 siang" → start="2026-04-15T13:00:00", end="2026-04-15T14:00:00"
- Input "jam 10-11 pagi" → start="2026-04-15T10:00:00", end="2026-04-15T11:00:00"
- Input "3pm-4pm" → start="2026-04-15T15:00:00", end="2026-04-15T16:00:00"

PARSING INSTRUCTIONS:
1. Extract every task, event, and deadline mentioned.
2. Categorize task type into EXACTLY ONE: "analytical", "routine", "creative" (guess based on description).
3. **CRITICAL**: If user mentions time range (jam X-Y, AXpm-Ypm, X:00-Y:00) → MUST set type="fixed" WITH start/end datetimes in ISO format.
4. If no time range, set type="flexible" with only deadline (if mentioned).
5. Priority: 1-5 (5=most urgent). Classes/meetings default to 4.
6. Cognitive demand: 1-5 based on mental focus. Default 3.
7. Duration: For flexible tasks, estimate if not specified. For fixed events, calculate from end-start.
8. If the user expresses tiredness, stress, or excitement: Add to energy_forecast with scale: -2=exhausted, -1=tired, 0=normal, 1=good, 2=energized

STRICT OUTPUT EXAMPLES (FOLLOW THIS!):
Input: "ada kelas pbo jam 1-2"
→ type="fixed", title="KELAS PBO", start="2026-04-15T13:00:00", end="2026-04-15T14:00:00", duration="1h", category="routine", priority=4

Input: "tugas ml deadline jam 5"
→ type="flexible", title="TUGAS ML", deadline="17:00", category="analytical", priority=3

Input: "meeting 10-11 pagi"
→ type="fixed", title="MEETING", start="2026-04-15T10:00:00", end="2026-04-15T11:00:00", category="routine", priority=4`,
            },
          ],
        },
        contents: [{ parts: [{ text: nlInput }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              entries: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    type: { type: "STRING" },
                    title: { type: "STRING" },
                    category: { type: "STRING" },
                    duration: { type: "STRING" },
                    priority: { type: "INTEGER" },
                    cognitive_demand: { type: "INTEGER" },
                    deadline: { type: "STRING" },
                    start: { type: "STRING" },
                    end: { type: "STRING" }
                  },
                  required: ["type", "title", "category", "duration", "priority", "cognitive_demand"]
                }
              },
              energy_forecast: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: { time: { type: "STRING" }, potential_energy_level: { type: "INTEGER" } }
                }
              }
            },
            required: ["entries"]
          }
        },
      };

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        let errMsg = "Parse failed";
        try {
           const errJson = JSON.parse(errText);
           if (errJson.error && errJson.error.message) errMsg = errJson.error.message;
        } catch(e) {}
        throw new Error(`${res.status}: ${errMsg}`);
      }
      const apiRes = await res.json();
      const textResponse = apiRes.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textResponse) throw new Error("Empty response");

      const data = JSON.parse(textResponse);
      console.log("=== GEMINI PARSED DATA ===");
      console.log(JSON.stringify(data, null, 2));
      
      const newFixed = [];
      const newTasks = [];

      // Duration parsing helper
      const parseDurHr = (str) => {
        let hrs = 0;
        const hMatch = str.match(/(\d+)h/);
        const mMatch = str.match(/(\d+)m/);
        if (hMatch) hrs += parseInt(hMatch[1]);
        if (mMatch) hrs += parseInt(mMatch[1]) / 60;
        return hrs || 0.5;
      };

      // Helper to parse ISO or time-only strings into Date objects for today
      const parseDateTime = (str) => {
        if (!str) return null;
        try {
          // If it's already a full ISO datetime, use it
          if (str.includes("T")) {
            return new Date(str);
          }
          // If it's just a time (HH:MM or HH:MM:SS), create a date for today with that time
          if (/^\d{2}:\d{2}/.test(str)) {
            const [hours, minutes] = str.split(":").map(Number);
            const today = new Date();
            today.setHours(hours || 0, minutes || 0, 0, 0);
            return today;
          }
          // Handle single hour format (e.g., "1", "14")
          if (/^\d{1,2}$/.test(str.trim())) {
            const hour = parseInt(str.trim());
            const today = new Date();
            today.setHours(hour, 0, 0, 0);
            return today;
          }
          // Otherwise try to parse as is
          return new Date(str);
        } catch (e) {
          return null;
        }
      };

      for (const e of data.entries || []) {
        console.log(`Processing entry: type="${e.type}", title="${e.title}", start="${e.start}", end="${e.end}", duration="${e.duration}"`);
        
        // Extract start/end from duration if not explicitly provided (fallback for Gemini quirks)
        let start = e.start;
        let end = e.end;
        
        if (e.type === "fixed" && !start && !end) {
          // Try to extract time range from title like "jam 9.30 - 12.00", "jam 9:30-12:00", etc
          // Improved regex to capture hours AND minutes (with . , : or space separator)
          const titleMatch = e.title?.match(/jam\s+(\d{1,2})[.,:\s]*(\d{0,2})\s*-\s*(\d{1,2})[.,:\s]*(\d{0,2})/i);
          if (titleMatch) {
            const startHour = parseInt(titleMatch[1]);
            const startMin = titleMatch[2] ? parseInt(titleMatch[2]) : 0;
            const endHour = parseInt(titleMatch[3]);
            const endMin = titleMatch[4] ? parseInt(titleMatch[4]) : 0;
            
            const startDate = new Date();
            startDate.setHours(startHour, startMin, 0, 0);
            start = startDate.toISOString();
            
            const endDate = new Date();
            endDate.setHours(endHour, endMin, 0, 0);
            end = endDate.toISOString();
            console.log(`Fallback extracted from title: "${e.title}" → start=${startHour}:${String(startMin).padStart(2,'0')}, end=${endHour}:${String(endMin).padStart(2,'0')}`);
          }
        }
        
        if (e.type === "fixed" && start && end) {
          const sd = parseDateTime(start);
          const ed = parseDateTime(end);
          if (sd && ed && !isNaN(sd.getTime()) && !isNaN(ed.getTime())) {
            const startSlot = Math.min(TOTAL_SLOTS - 1, sd.getHours() * 2 + Math.floor(sd.getMinutes() / 30));
            const endSlot = Math.min(TOTAL_SLOTS, ed.getHours() * 2 + Math.floor(ed.getMinutes() / 30));
            if (endSlot > startSlot) {
              console.log(`Fixed block: "${e.title}"`);
              console.log(`  Parsed time: ${sd.getHours()}:${String(sd.getMinutes()).padStart(2,'0')} - ${ed.getHours()}:${String(ed.getMinutes()).padStart(2,'0')}`);
              console.log(`  Slot: ${startSlot} - ${endSlot}`);
              newFixed.push({
                id: crypto.randomUUID(),
                title: e.title.toUpperCase(),
                startSlot,
                endSlot,
              });
            }
          }
        } else {
          newTasks.push({
            id: crypto.randomUUID(),
            title: e.title.toUpperCase(),
            task_type: e.category,
            duration: parseDurHr(e.duration),
            priority: e.priority,
            cognitive_demand: e.cognitive_demand,
            deadline: e.deadline ? (e.deadline.includes("T") ? e.deadline.split("T")[1].substring(0,5) : String(e.deadline).substring(0,5)) : "23:59",
            is_running: false,
            total_duration: 0,
            last_started_at: null,
            is_archived: false,
            is_fixed: false,
            partial_done: 0.0
          });
        }
      }

      if (newFixed.length) setFixedBlocks((prev) => [...prev, ...newFixed]);
      if (newTasks.length) setTasks((prev) => [...newTasks, ...prev]);
      
      // Update vibe based on energy forecast
      if (data.energy_forecast && data.energy_forecast.length > 0) {
        const avg = data.energy_forecast.reduce((sum, e) => sum + e.potential_energy_level, 0) / data.energy_forecast.length;
        // scale: -2=exhausted, -1=tired, 0=normal, 1=good, 2=energized
        // map to 0.0 to 1.0 (vibe)
        const newVibe = Math.max(0.1, Math.min(0.9, 0.5 + avg * 0.2));
        setVibe(newVibe);
        showToast(`Detected energy from text. Vibe updated to ${newVibe.toFixed(2)}`);
      }

      setNlInput("");
    } catch (e) {
      setNlError("Failed to parse: " + e.message);
    }
    setNlLoading(false);
  };

  const doGenerate = async () => {
    // Only schedule flexible tasks. Fixed blocks are handled separately in fixedBlocks array.
    // Ensure no fixed events are included in API calls.
    setScheduleLoading(true);
    setShowDebug(true);
    try {
      // Use actual current time
      const nowDate = new Date();
      const nowHour = nowDate.getHours() + nowDate.getMinutes() / 60;
      const endOfDayHour = 23.99;
      
      console.log(`Current time: ${nowDate.getHours()}:${String(nowDate.getMinutes()).padStart(2, '0')} (${nowHour.toFixed(2)} hours)`);
      
      // Helper: Check if a time slot overlaps with any fixed block OR scheduled task
      const isSlotOccupied = (startSlot, slotsNeeded, existingSched) => {
        const taskStart = startSlot;
        const taskEnd = startSlot + slotsNeeded;
        
        // Check fixed blocks - ensure they have slot properties
        const fixedOverlap = fixedBlocks.some(fb => {
          if (!fb.startSlot || !fb.endSlot) return false; // Skip if missing slot info
          return !(taskEnd <= fb.startSlot || taskStart >= fb.endSlot);
        });
        
        // Check already scheduled tasks in current session
        const schedOverlap = existingSched.some(s => {
          const sStart = s.scheduled_start;
          const sEnd = s.scheduled_start + s.scheduled_slots;
          return !(taskEnd <= sStart || taskStart >= sEnd);
        });
        
        console.log(`Checking slot ${startSlot}-${taskEnd}: fixed=${fixedOverlap}, sched=${schedOverlap}`);
        return fixedOverlap || schedOverlap;
      };
      
      // Helper: Find next available slot that doesn't conflict with fixed blocks or existing schedule
      const findNextAvailableSlot = (fromHour, duration, existingSched) => {
        const slotsNeeded = Math.max(1, Math.round(duration * 2));
        const endOfDay = 46; // 23:00
        
        // Start from a properly calculated slot, ensuring we don't go backwards in time
        let startSlot = Math.ceil(fromHour * 2); // Use ceil to round up to next slot
        if (startSlot < 0) startSlot = 0;
        
        console.log(`Finding slot for ${duration}h task starting from hour ${fromHour.toFixed(2)} (slot ${startSlot})`);
        
        // Scan every slot from now onwards
        for (let slot = startSlot; slot + slotsNeeded <= endOfDay; slot++) {
          if (!isSlotOccupied(slot, slotsNeeded, existingSched)) {
            const schedHour = slot / 2;
            console.log(`Found available slot ${slot} (hour ${schedHour.toFixed(2)}) for ${duration}h task`);
            return { slot, hour: schedHour };
          }
        }
        
        console.log(`No available slot found for ${duration}h task starting from hour ${fromHour.toFixed(2)}`);
        return null;
      };
      
      // Filter flexible tasks that have NOT passed their deadline yet
      const tasksToSchedule = activeTasks.filter(t => {
        const taskDeadline = deadlineToHour(t.deadline);
        // Only include tasks with future deadlines (or no deadline)
        const isViable = !t.deadline || taskDeadline > nowHour;
        if (!isViable) {
          console.log(`Skipping task "${t.title}" with expired deadline ${t.deadline} (${taskDeadline.toFixed(2)} < ${nowHour.toFixed(2)})`);
        }
        return isViable;
      });
      
      // Modal DDQN API requires building schedule incrementally.
      // For simplicity in the UI context while simulating loops:
      // We will call Modal endpoint for the *first* task, and then perhaps we can sequence them locally or
      // call in a loop here. I'll just rely on the fallback for full scheduling visualization if API is not fully set.
      
      // SAFEGUARD: Ensure no fixed blocks are included in scheduling
      const verifyNoFixedEvents = (tasksArray) => tasksArray.filter(t => t.is_fixed !== true);
      let localTasks = verifyNoFixedEvents(tasksToSchedule);
      let sched = [];
      let currTimeHour = nowHour;
      let isFirstCall = true;
      
      let sanity = 10;
      while (localTasks.length > 0 && sanity > 0) {
         sanity--;
         
         // 1. Siapkan Payload untuk API Modal
         const payload = {
           user_id: "radit_001",
           current_hour: currTimeHour, // expected by Modal DDQN
           current_day: 0,
           chronotype: characterType,
           current_vibe: vibe,
           tasks_today: localTasks.map((t) => ({
             id: t.id,
             duration: parseFloat(t.duration) || 0.5, // float hours
             deadline: deadlineToHour(t.deadline), // float hour
             importance: priorityToImportance(t.priority), // float 0-1
             cognitive_demand: t.cognitive_demand / 5.0, // float 0-1
             task_type: t.task_type || "routine",
             partial_done: t.partial_done || 0.0
           })),
           user_history_records: historyRecords
         };

         // Log payload on first call
         if (isFirstCall) {
           console.log("=== API PAYLOAD (First Call) ===");
           console.log(JSON.stringify(payload, null, 2));
           setDebugPayload(payload);
           isFirstCall = false;
         }

         // 2. Tembak API
         const res = await fetch(API_URL, {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify(payload),
         });

         if (!res.ok) throw new Error(`DDQN error: ${res.status}`);
         const d = await res.json();

         console.log("=== API RESPONSE ===");
         console.log(JSON.stringify(d, null, 2));
         setDebugResponse(d);

         if (d.status !== "success" || !d.recommended_task_id) {
           break; // Berhenti jika AI error atau tidak ada rekomendasi
         }

         // 3. Cari tugas yang direkomendasikan AI
         const recTask = localTasks.find((t) => t.id === d.recommended_task_id);
         if (!recTask) break;

         // 4. Find available slot that doesn't overlap with fixed blocks or existing schedule
         const slotsNeeded = Math.max(1, Math.round(recTask.duration * 2));
         const availableSlot = findNextAvailableSlot(currTimeHour, recTask.duration, sched);
         
         if (!availableSlot) {
           console.log(`No available slot for task "${recTask.title}" (need ${recTask.duration}h)`);
           break; // Tidak ada slot yang tersedia hari ini
         }

         console.log(`Scheduling "${recTask.title}" at slot ${availableSlot.slot} (hour ${availableSlot.hour})`);
         
         sched.push({
           ...recTask,
           scheduled_start: availableSlot.slot,
           scheduled_slots: slotsNeeded,
           assigned_block: "AI",
         });

         // 5. Majukan waktu simulasi untuk tugas selanjutnya (setelah task yang dijadwalkan)
         currTimeHour = availableSlot.hour + recTask.duration;

         // Hapus tugas yang sudah dijadwalkan dari antrean
         localTasks = localTasks.filter((t) => t.id !== d.recommended_task_id);
      }

      setSchedule(sched);
      showToast("AI Schedule Generated!", "success");

    } catch (err) {
      console.error(err);
      showToast("AI DDQN gagal dihubungi. Tidak ada data yang tersusun.", "error");
    }
    setScheduleLoading(false);
  };

  // Reorder active tasks based on schedule order if schedule exists
  const getOrderedActiveTasks = () => {
    const unarchived = tasks.filter((t) => !t.is_archived);
    if (schedule.length === 0) return unarchived;
    
    const ordered = [];
    const scheduled = new Set();
    
    // Add tasks in schedule order
    for (const s of schedule) {
      const task = unarchived.find(t => t.id === s.id);
      if (task) {
        ordered.push(task);
        scheduled.add(s.id);
      }
    }
    
    // Add unscheduled tasks at the end
    for (const t of unarchived) {
      if (!scheduled.has(t.id)) {
        ordered.push(t);
      }
    }
    
    return ordered;
  };

  const activeTasks = getOrderedActiveTasks();
  const archivedTasks = tasks.filter((t) => t.is_archived);
  const runningTask = tasks.find((t) => t.is_running);
  const getElapsed = (t) =>
    !t.is_running || !t.last_started_at
      ? t.total_duration
      : t.total_duration + Math.floor((Date.now() - t.last_started_at) / 1000);

  const energyProfile = useMemo(
    () => buildEnergyProfile(vibe, characterType),
    [vibe, characterType]
  );
  const maxEnergy = Math.max(...energyProfile);
  const nowSlot = new Date().getHours() * 2 + (new Date().getMinutes() >= 30 ? 1 : 0);

  const S = {
    app: { display: "flex", height: "100vh", background: "#09090b", color: "#e4e4e7", overflow: "hidden", fontSize: 13 },
    sidebar: { width: 240, minWidth: 240, background: "#0c0c0f", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column" },
    main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
    topbar: { padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(9,9,11,0.8)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "space-between" },
    content: { flex: 1, overflow: "auto", padding: 24 },
    card: { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "12px 16px", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" },
    btn: { padding: "6px 14px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#a1a1aa", cursor: "pointer", fontSize: 12 },
    btnP: { padding: "8px 18px", borderRadius: 6, border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.12)", color: "#34d399", cursor: "pointer", fontSize: 12, fontWeight: 600 },
    input: { padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#e4e4e7", fontSize: 12, outline: "none", width: "100%" },
    select: { padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "#18181b", color: "#e4e4e7", fontSize: 12, outline: "none" },
    badge: (c) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: c?.bg, color: c?.text, border: `1px solid ${c?.border}30` }),
    dot: (on) => ({ width: 8, height: 8, borderRadius: "50%", background: on ? "#34d399" : "#3f3f46", flexShrink: 0, boxShadow: on ? "0 0 8px rgba(52,211,153,0.5)" : "none" }),
  };

  const NavItem = ({ label, icon, active, onClick }) => (
    <button
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", width: "100%", background: active ? "rgba(255,255,255,0.04)" : "transparent", borderLeft: `2px solid ${active ? "#34d399" : "transparent"}`, color: active ? "#34d399" : "#71717a", border: "none", cursor: "pointer", borderLeftWidth: 2, borderLeftStyle: "solid", borderLeftColor: active ? "#34d399" : "transparent" }}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>{label}
    </button>
  );

  return (
    <div style={S.app}>
      <aside style={S.sidebar}>
        <div>
          <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>APUAHRLS</div>
            <div style={{ fontSize: 9, color: "#52525b", letterSpacing: 1.5 }}>ADAPTIVE SCHEDULER</div>
          </div>
          <div style={{ padding: "12px 0" }}>
            <NavItem label="Dashboard" icon="◈" active={view === "dashboard"} onClick={() => setView("dashboard")} />
            <NavItem label="Schedule" icon="◫" active={view === "schedule"} onClick={() => setView("schedule")} />
            <NavItem label="Archive" icon="◰" active={view === "archive"} onClick={() => setView("archive")} />
          </div>
        </div>
        <div style={{ padding: 16, borderTop: "1px solid rgba(255,255,255,0.04)", marginTop: 'auto' }}>
          <div style={{ fontSize: 9, color: "#3f3f46", letterSpacing: 2, fontWeight: 600, marginBottom: 10 }}>ENERGY VIBE</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 20 }}>{ENERGY_LABELS[Math.round(vibe * 5)] || "😐"}</span>
            <span style={{ fontSize: 11, color: "#a1a1aa", fontWeight: 600 }}>{(vibe * 100).toFixed(0)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={vibe}
            onChange={(e) => setVibe(+e.target.value)}
            style={{ width: "100%", accentColor: "#34d399" }}
          />

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 9, color: "#3f3f46", letterSpacing: 2, fontWeight: 600, marginBottom: 8 }}>CHRONOTYPE</div>
            {CHRONOTYPES.map((ct) => (
              <button
                key={ct.key}
                onClick={() => setCharacterType(ct.key)}
                style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "6px 8px", marginBottom: 3, borderRadius: 6, border: characterType === ct.key ? "1px solid rgba(52,211,153,0.4)" : "1px solid transparent", background: characterType === ct.key ? "rgba(52,211,153,0.08)" : "transparent", color: characterType === ct.key ? "#34d399" : "#71717a", cursor: "pointer", textAlign: "left" }}
              >
                <span style={{ fontSize: 14 }}>{ct.emoji}</span>
                <span>{ct.name}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div style={S.main}>
        <div style={S.topbar}>
          <div>
            <div style={{ fontSize: 18, color: "#f4f4f5" }}>{view === "dashboard" ? "Active Tasks" : view === "schedule" ? "Daily Schedule" : "Completed Tasks"}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {view === "dashboard" && (
              <>
                <button style={S.btn} onClick={() => { setShowAddTask(!showAddTask); setForm((f) => ({ ...f, is_fixed: false })); }}>+ Task</button>
                <button style={scheduleLoading ? { ...S.btnP, opacity: 0.6 } : S.btnP} onClick={doGenerate} disabled={scheduleLoading}>
                  {scheduleLoading ? "⏳ Scheduling..." : "◈ AI Schedule"}
                </button>
              </>
            )}
            {view === "schedule" && <button style={S.btnP} onClick={doGenerate}>↻ Regenerate</button>}
          </div>
        </div>

        <div style={S.content}>
          {view === "dashboard" && (
            <div style={{ display: "flex", gap: 24, height: "100%" }}>
              {/* Left Side: Tasks and Inputs */}
              <div style={{ flex: "1 1 60%", display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ padding: "16px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: nlLoading ? "1px solid rgba(52,211,153,0.4)" : "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ fontSize: 10, color: "#3f3f46", letterSpacing: 2, fontWeight: 600, marginBottom: 8 }}>NATURAL LANGUAGE INPUT (GEMINI)</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <textarea rows={2} placeholder="Describe your day... (e.g. ada kelas jam 12, tugas ML deadline 23:59)" value={nlInput} onChange={(e) => setNlInput(e.target.value)} style={{ ...S.input, resize: "none" }} />
                    <button onClick={handleNlParse} disabled={nlLoading || !nlInput.trim()} style={{ ...S.btnP, minWidth: 120 }}>{nlLoading ? "⏳ Parsing..." : "Parse with AI"}</button>
                  </div>
                  {nlError && <div style={{ marginTop: 6, fontSize: 10, color: "#fca5a5" }}>{nlError}</div>}
                </div>

                {showAddTask && (
                  <div style={{ ...S.card, flexDirection: "column", alignItems: "stretch", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <button onClick={() => setForm((f) => ({ ...f, is_fixed: false }))} style={{ ...S.btn, background: !form.is_fixed ? "rgba(52,211,153,0.15)" : "transparent", color: !form.is_fixed ? "#34d399" : "#71717a" }}>Flexible Task</button>
                      <button onClick={() => setForm((f) => ({ ...f, is_fixed: true }))} style={{ ...S.btn, background: form.is_fixed ? "rgba(99,102,241,0.15)" : "transparent", color: form.is_fixed ? "#818cf8" : "#71717a" }}>Fixed Block</button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: form.is_fixed ? "2fr 1fr 1fr" : "2fr 1fr", gap: 8 }}>
                      <input placeholder={form.is_fixed ? "Block name" : "Task title"} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={S.input} />
                      {form.is_fixed ? (
                        <>
                          <div><label style={{fontSize:9}}>START</label><input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} style={S.input} /></div>
                          <div><label style={{fontSize:9}}>END</label><input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} style={S.input} /></div>
                        </>
                      ) : (
                        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={S.select}>
                          <option value="analytical">Analytical</option>
                          <option value="routine">Routine</option>
                          <option value="creative">Creative</option>
                        </select>
                      )}
                    </div>
                    {!form.is_fixed && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                        <div><label style={{fontSize:9}}>DURATION (min)</label><input type="number" value={form.duration_estimate} onChange={e => setForm({...form, duration_estimate: +e.target.value})} style={S.input}/></div>
                        <div><label style={{fontSize:9}}>PRIORITY</label><select value={form.priority} onChange={e => setForm({...form, priority: +e.target.value})} style={S.select}>{[1,2,3,4,5].map(i => <option key={i} value={i}>{i}</option>)}</select></div>
                        <div><label style={{fontSize:9}}>COGNITIVE DEMAND</label><select value={form.cognitive_demand} onChange={e => setForm({...form, cognitive_demand: +e.target.value})} style={S.select}>{[1,2,3,4,5].map(i => <option key={i} value={i}>{i}</option>)}</select></div>
                        <div><label style={{fontSize:9}}>DEADLINE</label><input type="time" value={form.deadline} onChange={e => setForm({...form, deadline: e.target.value})} style={S.input} /></div>
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button onClick={addTask} style={S.btnP}>Add</button>
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", paddingRight: 8 }}>
                  {/* Edit Form */}
                  {editingItemId && (
                    <div style={{ ...S.card, flexDirection: "column", alignItems: "stretch", gap: 12, background: "rgba(107,114,128,0.1)", borderColor: "rgba(107,114,128,0.3)" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af" }}>EDITING {editingItemType === "task" ? "TASK" : "FIXED EVENT"}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <button onClick={() => { setEditForm((f) => ({ ...f })); if (editingItemType === "fixed") {/* keep showing time fields */} else {/* keep showing other fields */} }} style={{ ...S.btn, background: "rgba(255,255,255,0.04)", color: "#e4e4e7" }}>Editing</button>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: editingItemType === "fixed" ? "2fr 1fr 1fr" : "2fr 1fr", gap: 8 }}>
                        <input placeholder={editingItemType === "fixed" ? "Block name" : "Task title"} value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} style={S.input} />
                        {editingItemType === "fixed" ? (
                          <>
                            <div><label style={{fontSize:9}}>START</label><input type="time" value={editForm.startTime} onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value })} style={S.input} /></div>
                            <div><label style={{fontSize:9}}>END</label><input type="time" value={editForm.endTime} onChange={(e) => setEditForm({ ...editForm, endTime: e.target.value })} style={S.input} /></div>
                          </>
                        ) : (
                          <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} style={S.select}>
                            <option value="analytical">Analytical</option>
                            <option value="routine">Routine</option>
                            <option value="creative">Creative</option>
                          </select>
                        )}
                      </div>
                      {editingItemType === "task" && (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                          <div><label style={{fontSize:9}}>DURATION (min)</label><input type="number" value={editForm.duration_estimate} onChange={e => setEditForm({...editForm, duration_estimate: +e.target.value})} style={S.input}/></div>
                          <div><label style={{fontSize:9}}>PRIORITY</label><select value={editForm.priority} onChange={e => setEditForm({...editForm, priority: +e.target.value})} style={S.select}>{[1,2,3,4,5].map(i => <option key={i} value={i}>{i}</option>)}</select></div>
                          <div><label style={{fontSize:9}}>COGNITIVE DEMAND</label><select value={editForm.cognitive_demand} onChange={e => setEditForm({...editForm, cognitive_demand: +e.target.value})} style={S.select}>{[1,2,3,4,5].map(i => <option key={i} value={i}>{i}</option>)}</select></div>
                          <div><label style={{fontSize:9}}>DEADLINE</label><input type="time" value={editForm.deadline} onChange={e => setEditForm({...editForm, deadline: e.target.value})} style={S.input} /></div>
                        </div>
                      )}
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                        <button onClick={cancelEdit} style={{ ...S.btn, color: "#ef4444" }}>Cancel</button>
                        <button onClick={saveEdit} style={S.btnP}>Save Changes</button>
                      </div>
                    </div>
                  )}

                  {/* Fixed Events Section */}
                  {fixedBlocks.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, color: "#a1a1aa", letterSpacing: 1 }}>FIXED EVENTS</div>
                      {fixedBlocks.map((fixedBlock) => {
                        const startHour = Math.floor(fixedBlock.startSlot / 2);
                        const startMin = (fixedBlock.startSlot % 2) * 30;
                        const endHour = Math.floor(fixedBlock.endSlot / 2);
                        const endMin = (fixedBlock.endSlot % 2) * 30;
                        const startTime = `${String(startHour).padStart(2, "0")}:${String(startMin).padStart(2, "0")}`;
                        const endTime = `${String(endHour).padStart(2, "0")}:${String(endMin).padStart(2, "0")}`;
                        const duration = ((fixedBlock.endSlot - fixedBlock.startSlot) * 30) / 60;
                        
                        return (
                          <div key={fixedBlock.id} style={{ ...S.card, borderColor: "rgba(129,140,248,0.3)", borderLeft: "3px solid rgba(129,140,248,0.6)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(129,140,248,0.6)", flexShrink: 0 }} />
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ fontWeight: 700, color: "#818cf8" }}>{fixedBlock.title}</span>
                                  <span style={S.badge({ text: "#818cf8", bg: "rgba(129,140,248,0.1)", border: "#818cf8" })}>FIXED</span>
                                </div>
                                <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 10, color: "#52525b" }}>
                                  <span>⏰ {startTime} - {endTime}</span>
                                  <span>{duration.toFixed(1)}h</span>
                                </div>
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 10 }}>
                              <button onClick={() => startEditing(fixedBlock.id, "fixed")} style={{ ...S.btn, color: "#f59e0b" }}>EDIT</button>
                              <button onClick={() => removeFixed(fixedBlock.id)} style={{ ...S.btn, color: "#ef4444" }}>✕</button>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}

                  {/* Flexible Tasks Section */}
                  <div style={{ fontSize: 11, color: "#a1a1aa", letterSpacing: 1 }}>FLEXIBLE TASKS</div>
              {activeTasks.map((task) => {
                const elapsed = getElapsed(task);
                const isLate = task.deadline && deadlineToHour(task.deadline) < (new Date().getHours() + new Date().getMinutes() / 60);
                return (
                  <div key={task.id} style={{ ...S.card, borderColor: task.is_running ? "rgba(52,211,153,0.3)" : "rgba(255,255,255,0.06)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={S.dot(task.is_running)} />
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontWeight: 700 }}>{task.title} {isLate ? "⚠️" : ""}</span>
                          <span style={S.badge(BLOCK_COLORS[task.task_type || "routine"])}>{task.task_type}</span>
                          <PriorityDots level={task.priority} />
                        </div>
                        <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 10, color: "#52525b" }}>
                          <span>{task.duration.toFixed(1)}h</span>
                          {task.deadline && <span>⏰ {task.deadline}</span>}
                          {task.partial_done > 0 && <span style={{ color: "#f59e0b" }}>{(task.partial_done * 100).toFixed(0)}% done</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 16, fontWeight: 700, color: task.is_running ? "#34d399" : "#52525b" }}>
                        {fmt(elapsed)}
                      </span>
                      <button onClick={() => toggleTask(task.id)} style={{ ...S.btn, color: task.is_running ? "#34d399" : "#a1a1aa" }}>{task.is_running ? "STOP" : "START"}</button>
                      <button onClick={() => startEditing(task.id, "task")} style={{ ...S.btn, color: "#f59e0b" }}>EDIT</button>
                      <button onClick={() => archiveTask(task.id)} style={{ ...S.btn, color: "#22c55e" }}>DONE</button>
                      <button onClick={() => abandonTask(task.id)} style={{ ...S.btn, color: "#f59e0b" }}>ABANDON</button>
                      <button onClick={() => discardTask(task.id)} style={{ ...S.btn, color: "#ef4444" }}>✕</button>
                    </div>
                  </div>
                );
              })}
                </div>
              </div>

              {/* Right Side: Timeline */}
              <div style={{ flex: "1 1 40%", borderLeft: "1px solid rgba(255,255,255,0.06)", paddingLeft: 24, overflowY: "auto", overflowX: "hidden", paddingRight: 8, minHeight: 0 }}>
                <div style={{ fontSize: 13, color: "#a1a1aa", letterSpacing: 1, fontWeight: 700, marginBottom: 12 }}>TODAY'S SCHEDULE</div>
                <DailyTimeline schedule={schedule} fixedBlocks={fixedBlocks} energyProfile={energyProfile} />
              </div>
            </div>
          )}

          {view === "schedule" && (
             <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12 }}>
               {/* Week view: Days and time slots */}
               <div style={{ flex: 1, display: "flex", gap: 1, overflowX: "auto", overflowY: "auto", background: "rgba(255,255,255,0.01)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", padding: 12 }}>
                 {/* Create 7 columns for each day */}
                 {Array.from({ length: 7 }, (_, dayIdx) => {
                   const dayDate = new Date();
                   dayDate.setDate(dayDate.getDate() + dayIdx);
                   const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayDate.getDay()];
                   const dateStr = `${dayDate.getMonth() + 1}/${dayDate.getDate()}`;
                   
                   return (
                     <div key={dayIdx} style={{ flex: "0 0 180px", display: "flex", flexDirection: "column", borderRight: dayIdx < 6 ? "1px solid rgba(255,255,255,0.06)" : "none", minHeight: 0 }}>
                       {/* Day header */}
                       <div style={{ padding: "10px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(52,211,153,0.05)", textAlign: "center" }}>
                         <div style={{ fontSize: 12, fontWeight: 700, color: "#34d399" }}>{dayName}</div>
                         <div style={{ fontSize: 10, color: "#71717a" }}>{dateStr}</div>
                       </div>
                       
                       {/* Time slots grid */}
                       <div style={{ flex: 1, overflowY: "auto", position: "relative", borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
                         {Array.from({ length: 48 }, (_, slot) => {
                           const hour = Math.floor(slot / 2);
                           const isHour = slot % 2 === 0;
                           const timeStr = String(hour).padStart(2, "0") + ":00";
                           
                           // Find schedules for this slot on this day
                           const scheduledHere = schedule.find((s) => slot >= s.scheduled_start && slot < s.scheduled_start + s.scheduled_slots);
                           const fixedHere = fixedBlocks.find((fb) => slot >= fb.startSlot && slot < fb.endSlot);
                           
                           return (
                             <div
                               key={slot}
                               style={{
                                 padding: "4px",
                                 minHeight: 28,
                                 borderBottom: isHour ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(255,255,255,0.02)",
                                 background: isHour ? "transparent" : "rgba(255,255,255,0.005)",
                                 position: "relative",
                                 fontSize: 8,
                                 color: "#52525b",
                               }}
                             >
                               {isHour && <span style={{ lineHeight: "12px" }}>{timeStr}</span>}
                               
                               {/* Show fixed event if starts at this slot */}
                               {fixedHere && slot === fixedHere.startSlot && (
                                 <div
                                   style={{
                                     background: "rgba(99,102,241,0.2)",
                                     borderRadius: 4,
                                     padding: "4px",
                                     marginTop: 2,
                                     fontSize: 9,
                                     color: "#818cf8",
                                     fontWeight: 600,
                                     height: (fixedHere.endSlot - fixedHere.startSlot) * 28 - 4,
                                     display: "flex",
                                     alignItems: "center",
                                     overflow: "hidden",
                                   }}
                                 >
                                   {fixedHere.title}
                                 </div>
                               )}
                               
                               {/* Show scheduled task if starts at this slot */}
                               {scheduledHere && slot === scheduledHere.scheduled_start && (() => {
                                 const c = BLOCK_COLORS[scheduledHere.task_type] || BLOCK_COLORS["routine"];
                                 return (
                                   <div
                                     style={{
                                       background: c.bg,
                                       borderLeft: `3px solid ${c.border}`,
                                       borderRadius: 4,
                                       padding: "4px",
                                       marginTop: 2,
                                       fontSize: 9,
                                       color: c.text,
                                       fontWeight: 600,
                                       height: scheduledHere.scheduled_slots * 28 - 4,
                                       display: "flex",
                                       alignItems: "center",
                                       overflow: "hidden",
                                     }}
                                   >
                                     {scheduledHere.title}
                                   </div>
                                 );
                               })()}
                             </div>
                           );
                         })}
                       </div>
                     </div>
                   );
                 })}
               </div>
               
               {/* Legend */}
               <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#71717a" }}>
                 <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                   <div style={{ width: 16, height: 16, background: "rgba(99,102,241,0.2)", borderRadius: 2 }} />
                   <span>Fixed Events</span>
                 </div>
                 <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                   <div style={{ width: 16, height: 16, background: BLOCK_COLORS.analytical.bg, borderRadius: 2 }} />
                   <span>Analytical</span>
                 </div>
                 <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                   <div style={{ width: 16, height: 16, background: BLOCK_COLORS.routine.bg, borderRadius: 2 }} />
                   <span>Routine</span>
                 </div>
                 <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                   <div style={{ width: 16, height: 16, background: BLOCK_COLORS.creative.bg, borderRadius: 2 }} />
                   <span>Creative</span>
                 </div>
               </div>
             </div>
          )}

          {view === "archive" && (
            <div>
              {archivedTasks.map((t) => (
                <div key={t.id} style={{ ...S.card, opacity: 0.6 }}>
                   <span style={{ color: "#22c55e" }}>✓ {t.title}</span>
                   <span>{t.task_type} · {t.duration.toFixed(1)}h</span>
                </div>
              ))}
            </div>
          )}

          {/* Debug Panel */}
          {showDebug && (debugPayload || debugResponse) && (
            <div style={{ marginTop: 24, padding: 16, background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#34d399" }}>🐛 DEBUG: API Calls</div>
                <button onClick={() => setShowDebug(false)} style={{ ...S.btn, color: "#ef4444" }}>Close Debug</button>
              </div>
              
              {debugPayload && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#818cf8", marginBottom: 8 }}>REQUEST PAYLOAD:</div>
                  <pre style={{ background: "rgba(0,0,0,0.5)", padding: 8, borderRadius: 4, overflow: "auto", maxHeight: 200, fontSize: 9, color: "#a1a1aa", fontFamily: "monospace" }}>
                    {JSON.stringify(debugPayload, null, 2)}
                  </pre>
                </div>
              )}
              
              {debugResponse && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#34d399", marginBottom: 8 }}>API RESPONSE:</div>
                  <pre style={{ background: "rgba(0,0,0,0.5)", padding: 8, borderRadius: 4, overflow: "auto", maxHeight: 200, fontSize: 9, color: "#a1a1aa", fontFamily: "monospace" }}>
                    {JSON.stringify(debugResponse, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {toastMsg && <div style={{ position: "fixed", bottom: 24, right: 24, padding: "10px", background: "rgba(30,30,30,0.95)", border: "1px solid #fbbf24", color: "#fbbf24", borderRadius: 8 }}>{toastMsg}</div>}
    </div>
  );
}
