import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  API_URL,
  CHRONOTYPES,
  TOTAL_SLOTS,
  ENERGY_LABELS,
  BLOCK_COLORS,
  buildEnergyProfile,
  buildRLEnergyProfile,
  getRLSummary,
  fmt,
  slotToTime,
  deadlineToHour,
  priorityToImportance,
  cogDemandStrToFloat,
} from "./utils";
import { db } from "./db";

const getNow = () => new Date();

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
  const now = getNow();
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
                  className="timeline-slot"
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
  const [weekViewKey, setWeekViewKey] = useState(0); // Force re-render week view
  const [form, setForm] = useState({
    title: "",
    category: "analytical",
    duration_estimate: 30,
    priority: 3,
    cognitive_demand: 3,
    deadline: "",
    deadline_date: "", // YYYY-MM-DD format
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

  const [editingItemId, setEditingItemId] = useState(null);
  const [editingItemType, setEditingItemType] = useState(null); // "task" or "fixed"
  const [editForm, setEditForm] = useState({
    title: "",
    category: "analytical",
    duration_estimate: 30,
    priority: 3,
    cognitive_demand: 3,
    deadline: "",
    deadline_date: "",
    startTime: "08:00",
    endTime: "10:00",
  });

  // Buffer prompt state
  const [bufferPromptTasks, setBufferPromptTasks] = useState([]);
  const [showBufferPrompt, setShowBufferPrompt] = useState(false);

  useEffect(() => {
    db.setActiveTasks(tasks);
    db.setFixedEvents(fixedBlocks);
    db.setScheduleForDay(userState.current_day, schedule);
    // RL: Also persist schedule by date for week view history
    const todayStr = getNow().toISOString().split('T')[0];
    db.setScheduleByDate(todayStr, schedule);
    db.setFixedEventsByDate(todayStr, fixedBlocks);
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

  // ========== RL: Auto-detect day change and trigger rollover ==========
  useEffect(() => {
    const todayStr = getNow().toISOString().split('T')[0];
    const lastDate = db.getUser().lastActiveDate;

    if (lastDate && lastDate !== todayStr) {
      // Day has changed — save yesterday's final state, then roll over
      db.setScheduleByDate(lastDate, schedule);
      db.setFixedEventsByDate(lastDate, fixedBlocks);

      const newDay = db.advanceDay(todayStr);
      console.log(`[RL] Day changed: ${lastDate} → ${todayStr} (episode day ${newDay})`);

      // Reload state from db after rollover
      setUserState(db.getUser());
      setTasks(db.getActiveTasks());
      setBufferPool(db.getBufferPool());
      setSchedule([]); // Fresh day, empty schedule
    } else if (!lastDate) {
      // First time — just set today's date
      db.updateUser({ lastActiveDate: todayStr });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ===================================================================

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
      const newTask = {
        id: crypto.randomUUID(),
        ...form,
        title: form.title.toUpperCase(),
        task_type: form.category,
        duration: form.duration_estimate / 60,
        deadline_date: form.deadline_date || "",
        is_running: false,
        total_duration: 0,
        last_started_at: null,
        is_archived: false,
        is_fixed: false,
        partial_done: 0.0,
      };

      const today = getNow().toISOString().split("T")[0];
      if (newTask.deadline_date && newTask.deadline_date > today) {
        // Future deadline → buffer
        setBufferPool(prev => [newTask, ...prev]);
        showToast(`📦 "${newTask.title}" masuk buffer (deadline: ${newTask.deadline_date})`);
      } else {
        // Today or no deadline → active
        setTasks(prev => [newTask, ...prev]);
      }
    }
    setForm({
      title: "",
      category: "analytical",
      duration_estimate: 30,
      priority: 3,
      cognitive_demand: 3,
      deadline: "",
      deadline_date: "",
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

  // Abandon logic => partial completion, record history, route to buffer if future deadline
  const abandonTask = (id) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const newPartial = task.partial_done + 0.5 * (1 - task.partial_done);
    recordHistory(task, true);

    const today = getNow().toISOString().split("T")[0];

    if (task.deadline_date && task.deadline_date > today) {
      // Deadline still in future → move to buffer pool
      setBufferPool(prev => [...prev, { ...task, partial_done: newPartial, is_running: false, is_buffer: true }]);
      setTasks(prev => prev.filter(t => t.id !== id));
      showToast(`📦 "${task.title}" kembali ke buffer (deadline: ${task.deadline_date})`);
    } else {
      // Deadline today or no deadline → stay in active, mark partial
      setTasks(prev => prev.map(t => t.id === id ? { ...t, is_running: false, partial_done: newPartial } : t));
      showToast("Task abandoned & partial progress saved.");
    }
    setSchedule(prev => prev.filter(s => s.id !== id));
  };

  const recordHistory = (task, was_abandoned) => {
    const elapsedHrs = (task.total_duration) / 3600; 
    let completed_on_time = 1;
    if (task.deadline) {
       const nowHour = getNow().getHours() + getNow().getMinutes()/60;
       if (nowHour > deadlineToHour(task.deadline)) completed_on_time = 0;
    }
    // Find the scheduled slot for this task (for RL learning)
    const scheduledTask = schedule.find(s => s.id === task.id);
    const todayStr = getNow().toISOString().split('T')[0];

    const record = {
      task_id: task.id,
      task_type: task.task_type || "analytical",
      duration_hours: task.duration,
      completed_on_time,
      actual_duration_hours: elapsedHrs,
      vibe_before: vibe,
      vibe_after: vibe, // In full flow, we'd prompt for vibe 2
      was_abandoned: was_abandoned ? 1 : 0,
      is_buffer: task.is_buffer || false,
      user_accepted_buffer: null,
      day: userState.current_day,
      // RL-critical fields: slot and date for learning
      scheduled_slot: scheduledTask ? scheduledTask.scheduled_start : null,
      date: todayStr,
      completed_at_hour: getNow().getHours() + getNow().getMinutes() / 60,
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
    // API key check is handled conditionally depending on whether it's production


    setNlLoading(true);
    setNlError("");
    try {
      const payload = {
        systemInstruction: {
          parts: [
            {
              text: `Current timestamp (ISO): ${getNow().toISOString()}
Today's date: ${getNow().toISOString().split('T')[0]}

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
→ type="flexible", title="TUGAS ML", deadline="17:00", deadline_date="2026-04-20", category="analytical", priority=3

Input: "tugas kalkulus deadline hari rabu"
→ type="flexible", title="TUGAS KALKULUS", deadline="23:59", deadline_date="2026-04-22", category="analytical", priority=3

Input: "meeting 10-11 pagi"
→ type="fixed", title="MEETING", start="2026-04-15T10:00:00", end="2026-04-15T11:00:00", category="routine", priority=4

IMPORTANT: For deadline_date, compute the actual date from relative mentions:
- "besok" = tomorrow's date
- "lusa" = day after tomorrow
- "hari rabu" = next Wednesday
- "minggu depan" = next week
Always use ISO YYYY-MM-DD format. If no date mentioned, use today's date.`,
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
                    deadline_date: { type: "STRING" },
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

      const isDev = process.env.NODE_ENV !== "production";
      const parseUrl = isDev
        ? `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.REACT_APP_GEMINI_API_KEY}`
        : "/api/parse";

      const res = await fetch(parseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        let errMsg = "Parse failed";
        try {
           const errJson = JSON.parse(errText);
           if (errJson.error && errJson.error.message) errMsg = errJson.error.message;
           else if (errJson.error) errMsg = JSON.stringify(errJson.error);
        } catch(e) {
           errMsg = errText || `Error ${res.status}`;
        }
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
            const today = getNow();
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
            
            const startDate = getNow();
            startDate.setHours(startHour, startMin, 0, 0);
            start = startDate.toISOString();
            
            const endDate = getNow();
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
            deadline_date: e.deadline_date || getNow().toISOString().split("T")[0],
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
      
      // Route tasks: today → active, future → buffer
      const today = getNow().toISOString().split("T")[0];
      const todayTasks = newTasks.filter(t => !t.deadline_date || t.deadline_date <= today);
      const bufferTasks = newTasks.filter(t => t.deadline_date && t.deadline_date > today);
      
      if (todayTasks.length) setTasks((prev) => [...todayTasks, ...prev]);
      if (bufferTasks.length) {
        setBufferPool(prev => [...bufferTasks, ...prev]);
        showToast(`📦 ${bufferTasks.length} task masuk buffer (deadline di masa depan)`);
      }
      
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

  // ========== BUFFER CHECK: intercept before doGenerate ==========
  const handleAISchedule = () => {
    const today = getNow().toISOString().split("T")[0];
    const tomorrow = new Date(getNow().getTime());
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    // Pull urgent buffer tasks (deadline <= tomorrow)
    const urgent = bufferPool.filter(t => t.deadline_date && t.deadline_date <= tomorrowStr);

    if (urgent.length > 0) {
      setBufferPromptTasks(urgent.map(t => ({ ...t, _accepted: null }))); // null = undecided
      setShowBufferPrompt(true);
    } else {
      doGenerate();
    }
  };

  const handleBufferDecision = (taskId, accepted) => {
    setBufferPromptTasks(prev => prev.map(t => t.id === taskId ? { ...t, _accepted: accepted } : t));
  };

  const handleBufferConfirm = () => {
    const accepted = bufferPromptTasks.filter(t => t._accepted === true);
    const declined = bufferPromptTasks.filter(t => t._accepted === false || t._accepted === null);

    // Move accepted tasks to active
    if (accepted.length > 0) {
      const cleanTasks = accepted.map(({ _accepted, ...rest }) => ({ ...rest, is_buffer: false }));
      setTasks(prev => [...cleanTasks, ...prev]);
    }

    // Remove accepted from buffer, keep declined
    const acceptedIds = new Set(accepted.map(t => t.id));
    setBufferPool(prev => prev.filter(t => !acceptedIds.has(t.id)));

    // Track accept rate
    const totalPrompted = bufferPromptTasks.length;
    if (totalPrompted > 0) {
      const rate = accepted.length / totalPrompted;
      db.updateUser({ buffer_accept_rate: rate });
    }

    setShowBufferPrompt(false);
    setBufferPromptTasks([]);

    // Now proceed to generate
    setTimeout(() => doGenerate(), 100);
  };
  // ==============================================================

  const doGenerate = async () => {
    // Only schedule flexible tasks. Fixed blocks are handled separately in fixedBlocks array.
    // Ensure no fixed events are included in API calls.
    setScheduleLoading(true);
    try {
      // Use actual current time
      const nowDate = getNow();
      const nowHour = nowDate.getHours() + nowDate.getMinutes() / 60;
      const endOfDayHour = 23.99;
      
      // If generating late at night (after 21:00), schedule for tomorrow morning
      const WAKE_HOURS = { morning: 5, intermediate: 7, evening: 9 };
      const isLateNight = nowHour >= 21;
      const scheduleStartHour = isLateNight ? (WAKE_HOURS[characterType] || 7) : nowHour;
      
      if (isLateNight) {
        console.log(`Late night mode (${nowHour.toFixed(2)}h) — scheduling from ${scheduleStartHour}:00 (${characterType} wake time)`);
      }
      
      console.log(`Current time: ${nowDate.getHours()}:${String(nowDate.getMinutes()).padStart(2, '0')} (${nowHour.toFixed(2)} hours)`);
      console.log(`Schedule start hour: ${scheduleStartHour.toFixed(2)}`);
      console.log(`API_URL: ${API_URL}`);
      
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
        
        return fixedOverlap || schedOverlap;
      };
      
      // Helper: Find next available slot that doesn't conflict with fixed blocks or existing schedule
      const findNextAvailableSlot = (fromHour, duration, existingSched) => {
        const slotsNeeded = Math.max(1, Math.round(duration * 2));
        const endOfDay = 48; // Full day (24:00)
        
        // Start from a properly calculated slot, ensuring we don't go backwards in time
        let startSlot = Math.ceil(fromHour * 2); // Use ceil to round up to next slot
        if (startSlot < 0) startSlot = 0;
        if (startSlot >= endOfDay) startSlot = 0; // Wrap to start of day if past end
        
        console.log(`Finding slot for ${duration}h task starting from hour ${fromHour.toFixed(2)} (slot ${startSlot})`);
        
        // Scan every slot from start onwards
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
      
      // Include all tasks — let the DDQN model decide priority even for overdue ones
      const tasksToSchedule = activeTasks.filter(t => {
        const taskDeadline = deadlineToHour(t.deadline);
        if (t.deadline && taskDeadline <= nowHour) {
          console.log(`Task "${t.title}" has passed deadline ${t.deadline} — still including for DDQN`);
        }
        return true; // Always include, DDQN handles urgency
      });
      
      // Modal DDQN API requires building schedule incrementally.
      // For simplicity in the UI context while simulating loops:
      // We will call Modal endpoint for the *first* task, and then perhaps we can sequence them locally or
      // call in a loop here. I'll just rely on the fallback for full scheduling visualization if API is not fully set.
      
      // SAFEGUARD: Ensure no fixed blocks are included in scheduling
      const verifyNoFixedEvents = (tasksArray) => tasksArray.filter(t => t.is_fixed !== true);
      let localTasks = verifyNoFixedEvents(tasksToSchedule);
      let sched = [];
      let currTimeHour = scheduleStartHour;
      let isFirstCall = true;
      
      let sanity = 10;
      while (localTasks.length > 0 && sanity > 0) {
         sanity--;
         
         // Use local DDQN API endpoint format (correct format)
         const currentIsoDate = getNow();
         currentIsoDate.setHours(Math.floor(currTimeHour), Math.round((currTimeHour % 1) * 60), 0, 0);

         // Strip milliseconds from ISO string (backend format: %Y-%m-%dT%H:%M:%S)
         const isoNoMs = currentIsoDate.toISOString().replace(/\.\d{3}Z$/, "Z");

         const payload = {
           user_id: "user_001",
           current_time_iso: isoNoMs,
           chronotype: characterType,
           current_vibe: vibe,
           // RL: Send history using backend's expected field name
           user_history_records: historyRecords.slice(-50).map(r => ({
             task_type: r.task_type,
             scheduled_slot: r.scheduled_slot,
             duration_hours: r.duration_hours,
             completed_on_time: r.completed_on_time,
             was_abandoned: r.was_abandoned,
             vibe_before: r.vibe_before,
             vibe_after: r.vibe_after,
             date: r.date,
             day: r.day,
             actual_duration_hours: r.actual_duration_hours,
             is_buffer: r.is_buffer,
             user_accepted_buffer: r.user_accepted_buffer,
           })),
           entries: localTasks.map((t) => ({
             id: t.id,
             type: "flexible",
             title: t.title,
             category: t.task_type || "routine",
             duration: `${Math.round((parseFloat(t.duration) || 0.5) * 60)}m`,
             priority: t.priority || 3,
             cognitive_demand: t.cognitive_demand || 3,
             deadline: t.deadline || null,
           }))
         };

         // Log payload on first call
         if (isFirstCall) {
           console.log(`=== API PAYLOAD (DDQN Format) ===`);
           console.log(JSON.stringify(payload, null, 2));

           isFirstCall = false;
         }

         // 2. Call API
         const res = await fetch(API_URL, {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify(payload),
         });

         if (!res.ok) throw new Error(`API error: ${res.status}`);
         const d = await res.json();

         console.log("=== API RESPONSE ===");
         console.log(JSON.stringify(d, null, 2));

         // Parse response - expect DDQN format
         if (d.status !== "success" || !d.recommended_task_id) {
           console.log("DDQN API: Error or no recommendation");
           break;
         }
         const recommendedTaskId = d.recommended_task_id;

         // 3. Find recommended task
         const recTask = localTasks.find((t) => t.id === recommendedTaskId);
         if (!recTask) {
           console.log(`Task not found: ${recommendedTaskId}`);
           break;
         }

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

         // Advance time for next task (after scheduled task)
         currTimeHour = availableSlot.hour + recTask.duration;

         // Remove scheduled task from queue
         localTasks = localTasks.filter((t) => t.id !== recommendedTaskId);
      }

      setSchedule(sched);
      // RL: Persist schedule per date for week view history
      const todayStr = getNow().toISOString().split('T')[0];
      db.setScheduleByDate(todayStr, sched);
      db.setFixedEventsByDate(todayStr, fixedBlocks);
      db.updateUser({ lastActiveDate: todayStr });



      if (sched.length > 0) {
        showToast(`AI Schedule Generated! (${sched.length} tasks, RL history: ${historyRecords.length} records)`);
      } else {
        showToast("⚠️ No schedule generated. Check API or try fallback scheduler.");
      }

    } catch (err) {
      console.error("Schedule generation error:", err);
      showToast(`Error: ${err.message}`);
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

  // RL: Use history-adapted energy profile instead of static one
  const energyProfile = useMemo(
    () => buildRLEnergyProfile(vibe, characterType, historyRecords),
    [vibe, characterType, historyRecords]
  );
  const rlSummary = useMemo(
    () => getRLSummary(historyRecords),
    [historyRecords]
  );
  const maxEnergy = Math.max(...energyProfile);
  const nowSlot = getNow().getHours() * 2 + (getNow().getMinutes() >= 30 ? 1 : 0);

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
                <button style={scheduleLoading ? { ...S.btnP, opacity: 0.6 } : S.btnP} onClick={handleAISchedule} disabled={scheduleLoading}>
                  {scheduleLoading ? "⏳ Scheduling..." : "◈ AI Schedule"}
                </button>
              </>
            )}
            {view === "schedule" && (
              <>
                <button style={scheduleLoading ? { ...S.btnP, opacity: 0.6 } : S.btnP} onClick={handleAISchedule} disabled={scheduleLoading}>
                  {scheduleLoading ? "⏳ Generating..." : "↻ AI Schedule"}
                </button>
              </>
            )}
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
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 8 }}>
                        <div><label style={{fontSize:9}}>DURATION (min)</label><input type="number" value={form.duration_estimate} onChange={e => setForm({...form, duration_estimate: +e.target.value})} style={S.input}/></div>
                        <div><label style={{fontSize:9}}>PRIORITY</label><select value={form.priority} onChange={e => setForm({...form, priority: +e.target.value})} style={S.select}>{[1,2,3,4,5].map(i => <option key={i} value={i}>{i}</option>)}</select></div>
                        <div><label style={{fontSize:9}}>COGNITIVE DEMAND</label><select value={form.cognitive_demand} onChange={e => setForm({...form, cognitive_demand: +e.target.value})} style={S.select}>{[1,2,3,4,5].map(i => <option key={i} value={i}>{i}</option>)}</select></div>
                        <div><label style={{fontSize:9}}>DEADLINE TIME</label><input type="time" value={form.deadline} onChange={e => setForm({...form, deadline: e.target.value})} style={S.input} /></div>
                        <div><label style={{fontSize:9}}>DEADLINE DATE</label><input type="date" value={form.deadline_date} onChange={e => setForm({...form, deadline_date: e.target.value})} style={S.input} /></div>
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
                const isLate = task.deadline && deadlineToHour(task.deadline) < (getNow().getHours() + getNow().getMinutes() / 60);
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

              {/* Buffer Pool Section */}
              {bufferPool.length > 0 && (
                <div style={{ flex: "1 1 100%", marginTop: 8, padding: "12px 16px", background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "#f59e0b", letterSpacing: 1, fontWeight: 700, marginBottom: 8 }}>📦 BUFFER POOL ({bufferPool.length})</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {bufferPool.map(task => {
                      const today = getNow().toISOString().split("T")[0];
                      const daysLeft = task.deadline_date ? Math.ceil((new Date(task.deadline_date) - new Date(today)) / 86400000) : "?";
                      const urgent = daysLeft <= 1;
                      return (
                        <div key={task.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", borderRadius: 6, background: urgent ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.02)", border: `1px solid ${urgent ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.06)"}` }}>
                          <div>
                            <span style={{ fontWeight: 600, fontSize: 12, color: "#e4e4e7" }}>{task.title}</span>
                            <span style={{ ...S.badge(BLOCK_COLORS[task.task_type || "routine"]), marginLeft: 6 }}>{task.task_type}</span>
                            {task.partial_done > 0 && <span style={{ fontSize: 9, color: "#f59e0b", marginLeft: 6 }}>{(task.partial_done * 100).toFixed(0)}%</span>}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 10, color: urgent ? "#ef4444" : "#a1a1aa" }}>
                              📅 {task.deadline_date} ({daysLeft}d left)
                            </span>
                            <button onClick={() => {
                              setBufferPool(prev => prev.filter(t => t.id !== task.id));
                              setTasks(prev => [{ ...task, is_buffer: false }, ...prev]);
                              showToast(`✅ "${task.title}" moved to active tasks`);
                            }} style={{ ...S.btn, color: "#34d399", fontSize: 10 }}>→ Active</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Right Side: Timeline */}
              <div style={{ flex: "1 1 40%", borderLeft: "1px solid rgba(255,255,255,0.06)", paddingLeft: 24, overflowY: "auto", overflowX: "hidden", paddingRight: 8, minHeight: 0 }}>
                <div style={{ fontSize: 13, color: "#a1a1aa", letterSpacing: 1, fontWeight: 700, marginBottom: 12 }}>TODAY'S SCHEDULE</div>
                <DailyTimeline schedule={schedule} fixedBlocks={fixedBlocks} energyProfile={energyProfile} />
              </div>
            </div>
          )}

          {/* Buffer Prompt Modal */}
          {showBufferPrompt && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
              <div style={{ background: "#18181b", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 12, padding: 24, maxWidth: 500, width: "90%" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#f59e0b", marginBottom: 12 }}>📦 Buffer Tasks Getting Urgent!</div>
                <div style={{ fontSize: 11, color: "#a1a1aa", marginBottom: 16 }}>Task-task di bawah deadline-nya sudah dekat. Mau kerjakan hari ini?</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {bufferPromptTasks.map(task => (
                    <div key={task.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 8, background: task._accepted === true ? "rgba(34,197,94,0.1)" : task._accepted === false ? "rgba(239,68,68,0.05)" : "rgba(255,255,255,0.03)", border: `1px solid ${task._accepted === true ? "rgba(34,197,94,0.3)" : task._accepted === false ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.08)"}` }}>
                      <div>
                        <div style={{ fontWeight: 600, color: "#e4e4e7", fontSize: 12 }}>{task.title}</div>
                        <div style={{ fontSize: 10, color: "#71717a" }}>
                          {task.task_type} • {task.duration}h • deadline: {task.deadline_date}
                          {task.partial_done > 0 && <span style={{ color: "#f59e0b" }}> • {(task.partial_done * 100).toFixed(0)}% done</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => handleBufferDecision(task.id, true)}
                          style={{ ...S.btn, color: task._accepted === true ? "#fff" : "#34d399", background: task._accepted === true ? "rgba(34,197,94,0.3)" : "transparent", borderColor: "rgba(34,197,94,0.3)", fontSize: 10, padding: "4px 10px" }}
                        >✅ Kerjakan</button>
                        <button
                          onClick={() => handleBufferDecision(task.id, false)}
                          style={{ ...S.btn, color: task._accepted === false ? "#fff" : "#71717a", background: task._accepted === false ? "rgba(239,68,68,0.2)" : "transparent", borderColor: "rgba(113,113,122,0.3)", fontSize: 10, padding: "4px 10px" }}
                        >⏭ Skip</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button onClick={() => { setShowBufferPrompt(false); setBufferPromptTasks([]); }} style={{ ...S.btn, color: "#71717a" }}>Cancel</button>
                  <button onClick={handleBufferConfirm} style={S.btnP}>Lanjut Generate →</button>
                </div>
              </div>
            </div>
          )}

          {view === "schedule" && (
             <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12 }}>
               {/* RL Learning Stats Bar */}
               <div style={{ display: "flex", gap: 16, padding: "12px 16px", background: "rgba(52,211,153,0.04)", border: "1px solid rgba(52,211,153,0.15)", borderRadius: 8, alignItems: "center", flexWrap: "wrap" }}>
                 <div style={{ fontSize: 10, fontWeight: 700, color: "#34d399", letterSpacing: 1 }}>🧠 RL LEARNING</div>
                 <div style={{ fontSize: 10, color: "#a1a1aa" }}>
                   Records: <span style={{ color: "#e4e4e7", fontWeight: 600 }}>{rlSummary.totalRecords}</span>
                 </div>
                 <div style={{ fontSize: 10, color: "#a1a1aa" }}>
                   Completion: <span style={{ color: rlSummary.completionRate > 0.7 ? "#34d399" : "#f59e0b", fontWeight: 600 }}>{(rlSummary.completionRate * 100).toFixed(0)}%</span>
                 </div>
                 <div style={{ fontSize: 10, color: "#a1a1aa" }}>
                   On-time: <span style={{ color: rlSummary.onTimeRate > 0.7 ? "#34d399" : "#f59e0b", fontWeight: 600 }}>{(rlSummary.onTimeRate * 100).toFixed(0)}%</span>
                 </div>
                 {rlSummary.bestSlots.length > 0 && (
                   <div style={{ fontSize: 10, color: "#a1a1aa" }}>
                     Best slots: <span style={{ color: "#34d399", fontWeight: 600 }}>{rlSummary.bestSlots.join(", ")}</span>
                   </div>
                 )}
                 {rlSummary.worstSlots.length > 0 && (
                   <div style={{ fontSize: 10, color: "#a1a1aa" }}>
                     Weak slots: <span style={{ color: "#ef4444", fontWeight: 600 }}>{rlSummary.worstSlots.join(", ")}</span>
                   </div>
                 )}
                 <div style={{ fontSize: 10, color: "#a1a1aa" }}>
                   Episode Day: <span style={{ color: "#818cf8", fontWeight: 600 }}>{userState.current_day + 1}/5</span>
                 </div>
               </div>


               {/* Week view: Shows last 6 days + today (7 days total with history) */}
               <div key={`week-${weekViewKey}`} style={{ flex: 1, display: "flex", gap: 1, overflowX: "auto", overflowY: "auto", background: "rgba(255,255,255,0.01)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", padding: 12 }}>
                 {Array.from({ length: 7 }, (_, dayIdx) => {
                   const dayDate = new Date(getNow().getTime());
                   dayDate.setDate(dayDate.getDate() - (6 - dayIdx)); // 6 days ago to today
                   const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayDate.getDay()];
                   const dateStr = `${dayDate.getMonth() + 1}/${dayDate.getDate()}`;
                   const dateKey = dayDate.toISOString().split('T')[0];
                   const isToday = dayIdx === 6;

                   // RL: Load per-date schedule — today uses live state, past days use stored history
                   const daySchedule = isToday ? schedule : db.getScheduleByDate(dateKey);
                   const dayFixed = isToday ? fixedBlocks : db.getFixedEventsByDate(dateKey);
                   const hasData = daySchedule.length > 0 || dayFixed.length > 0;
                   
                   return (
                     <div key={`${dayIdx}-${dateKey}`} style={{ flex: "0 0 180px", display: "flex", flexDirection: "column", borderRight: dayIdx < 6 ? "1px solid rgba(255,255,255,0.06)" : "none", minHeight: 0, opacity: isToday ? 1 : (hasData ? 0.85 : 0.5) }}>
                       {/* Day header */}
                       <div style={{
                         padding: "10px",
                         borderBottom: "1px solid rgba(255,255,255,0.06)",
                         background: isToday ? "rgba(52,211,153,0.12)" : hasData ? "rgba(129,140,248,0.05)" : "rgba(255,255,255,0.02)",
                         textAlign: "center",
                       }}>
                         <div style={{ fontSize: 12, fontWeight: 700, color: isToday ? "#34d399" : hasData ? "#818cf8" : "#52525b" }}>
                           {isToday ? "TODAY" : dayName}
                         </div>
                         <div style={{ fontSize: 10, color: isToday ? "#34d399" : "#71717a" }}>{dateStr}</div>
                         {hasData && !isToday && <div style={{ fontSize: 8, color: "#818cf8", marginTop: 2 }}>{daySchedule.length} tasks</div>}
                       </div>
                       
                       {/* Time slots grid */}
                       <div style={{ flex: 1, overflowY: "auto", position: "relative", borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
                         {Array.from({ length: 48 }, (_, slot) => {
                           const hour = Math.floor(slot / 2);
                           const isHourMark = slot % 2 === 0;
                           const timeStr = String(hour).padStart(2, "0") + ":00";
                           
                           // Use per-date schedule data (not global schedule)
                           const scheduledHere = daySchedule.find((s) => slot >= s.scheduled_start && slot < s.scheduled_start + s.scheduled_slots);
                           const fixedHere = dayFixed.find((fb) => slot >= fb.startSlot && slot < fb.endSlot);
                           
                           return (
                             <div
                               key={slot}
                               style={{
                                 padding: "4px",
                                 minHeight: 28,
                                 borderBottom: isHourMark ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(255,255,255,0.02)",
                                 background: isHourMark ? "transparent" : "rgba(255,255,255,0.005)",
                                 position: "relative",
                                 fontSize: 8,
                                 color: "#52525b",
                               }}
                             >
                               {isHourMark && <span style={{ lineHeight: "12px" }}>{timeStr}</span>}
                               
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
               <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#71717a", flexWrap: "wrap" }}>
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
                 <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                   <div style={{ width: 10, height: 10, borderRadius: "50%", background: "rgba(52,211,153,0.4)" }} />
                   <span>Today</span>
                 </div>
                 <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                   <div style={{ width: 10, height: 10, borderRadius: "50%", background: "rgba(129,140,248,0.4)" }} />
                   <span>Has History</span>
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


        </div>
      </div>
      {toastMsg && <div style={{ position: "fixed", bottom: 24, right: 24, padding: "10px", background: "rgba(30,30,30,0.95)", border: "1px solid #fbbf24", color: "#fbbf24", borderRadius: 8 }}>{toastMsg}</div>}
    </div>
  );
}
