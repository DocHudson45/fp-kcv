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

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "grid", gridTemplateColumns: "36px 1fr 20px", position: "relative", zIndex: 1 }}>
        {Array.from({ length: TOTAL_SLOTS }, (_, slot) => {
          const time = slotToTime(slot);
          const isHour = slot % 2 === 0;
          const scheduledHere = schedule.find((s) => slot >= s.scheduled_start && slot < s.scheduled_start + s.scheduled_slots);
          const ep = energyProfile[slot];
          const barH = Math.min(100, (ep / maxEnergy) * 100);
          const isCurrent = slot === nowSlot;
          
          return (
            <div key={slot} style={{ display: "contents" }}>
              <div style={{ fontSize: 9, color: isCurrent ? "#34d399" : isHour ? "#52525b" : "#27272a", padding: "4px 0", textAlign: "right", paddingRight: 8 }}>{isHour ? time : ""}</div>
              <div style={{ padding: "2px 0", minHeight: 28, background: isCurrent ? "rgba(52,211,153,0.03)" : "transparent" }}>
                {scheduledHere && slot === scheduledHere.scheduled_start && (() => {
                  const c = BLOCK_COLORS[scheduledHere.task_type] || BLOCK_COLORS["routine"];
                  return (
                    <div style={{ background: c.bg, borderLeft: `3px solid ${c.border}`, padding: "6px", height: scheduledHere.scheduled_slots * 28 - 4, overflow: "hidden" }}>
                      <span style={{ fontSize: 10, color: c.text, fontWeight: 700 }}>{scheduledHere.title}</span>
                    </div>
                  )
                })()}
              </div>
              <div style={{ padding: "4px 2px", display: "flex", alignItems: "center" }}>
                <div style={{ width: "100%", height: 6, background: "#18181b", borderRadius: 3 }}>
                  <div style={{ width: `${barH}%`, height: "100%", borderRadius: 3, background: ep > 0.7 ? "#34d399" : ep > 0.4 ? "#f59e0b" : "#ef4444" }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Render fixed blocks absolutely positioned */}
      {fixedBlocks.map((fixedBlock) => (
        <div
          key={fixedBlock.id}
          style={{
            position: "absolute",
            top: fixedBlock.startSlot * 28 + 2,
            left: 36 + 2,
            right: 20 + 2,
            height: (fixedBlock.endSlot - fixedBlock.startSlot) * 28 - 4,
            background: "rgba(99,102,241,0.15)",
            border: "1px solid rgba(129,140,248,0.4)",
            borderRadius: 6,
            padding: "6px 8px",
            zIndex: 2,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 10, color: "#818cf8", fontWeight: 600 }}>{fixedBlock.title}</span>
        </div>
      ))}
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

  const discardTask = (id) => setTasks((prev) => prev.filter((t) => t.id !== id));

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

    setNlLoading(true);
    setNlError("");
    try {
      const payload = {
        systemInstruction: {
          parts: [
            {
              text: `Current timestamp (ISO): ${new Date().toISOString()}

You are a task parser for an AI scheduling system. Extract tasks and events from the user's input.

RULES:
1. Extract every task, event, and deadline mentioned.
2. Categorize each into EXACTLY ONE of these categories: "analytical", "routine", "creative".
3. Mark events with specific times as "fixed" (type="fixed", include start/end as ISO datetime).
4. Mark tasks that can be scheduled flexibly as "flexible" (type="flexible").
5. Set priority 1-5 (5=most urgent/important).
6. Set cognitive_demand 1-5 based on mental focus needed.
7. Duration: estimate if not specified. Use formats like "30m", "1h".
8. Deadline: use ISO format.
9. If the user expresses tiredness, stress, or excitement: Add to energy_forecast with scale: -2=exhausted, -1=tired, 0=normal, 1=good, 2=energized`,
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
        } catch(e) {}
        throw new Error(`${res.status}: ${errMsg}`);
      }
      const apiRes = await res.json();
      const textResponse = apiRes.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textResponse) throw new Error("Empty response");

      const data = JSON.parse(textResponse);
      console.log("Parsed JSON from Gemini API:", JSON.stringify(data, null, 2));
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
          // Otherwise try to parse as is
          return new Date(str);
        } catch (e) {
          return null;
        }
      };

      const entries = data.entries || data.tasks || [];
      
      for (const e of entries) {
        const title = (e.title || e.name || "Untitled").toUpperCase();
        const startStr = e.start || e.start_time;
        const endStr = e.end || e.end_time;

        if (e.type === "fixed" && startStr && endStr) {
          const sd = parseDateTime(startStr);
          const ed = parseDateTime(endStr);
          if (sd && ed && !isNaN(sd.getTime()) && !isNaN(ed.getTime())) {
            const startSlot = Math.min(TOTAL_SLOTS - 1, sd.getHours() * 2 + Math.floor(sd.getMinutes() / 30));
            const endSlot = Math.min(TOTAL_SLOTS, ed.getHours() * 2 + Math.floor(ed.getMinutes() / 30));
            if (endSlot > startSlot) {
              newFixed.push({
                id: crypto.randomUUID(),
                title: title,
                startSlot,
                endSlot,
              });
            }
          }
        } else {
          newTasks.push({
            id: crypto.randomUUID(),
            title: title,
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

  const doGenerate = async (isRegen = false) => {
    const remainingTasks = activeTasks.filter(t => !t.is_fixed);
    setScheduleLoading(true);
    setShowDebug(true);
    setDebugResponse([]); // Start fresh array of responses
    
    try {
      let currentVibeForApi = vibe;
      if (isRegen === true) {
        currentVibeForApi = Math.max(0.1, vibe - 0.1);
        setVibe(currentVibeForApi);
      }

      // Hardcoded to 5 AM for testing as requested
      const nowHour = 5; 
      // const now = new Date();
      // const nowHour = now.getHours() + now.getMinutes() / 60;
      
      let localTasks = [...remainingTasks];
      let sched = [];
      let currTimeHour = nowHour;
      let isFirstCall = true;
      
      let sanity = 10;
      while (localTasks.length > 0 && sanity > 0) {
         sanity--;
         
         const nowDate = new Date();
         const apiHour = Math.floor(currTimeHour);
         const apiMin = Math.round((currTimeHour % 1) * 60);
         const isoTime = `${nowDate.getFullYear()}-${String(nowDate.getMonth()+1).padStart(2,'0')}-${String(nowDate.getDate()).padStart(2,'0')}T${String(apiHour).padStart(2,'0')}:${String(apiMin).padStart(2,'0')}:00`;

         // Convert tasks to FrontendTask format (what deploy_api.py expects)
         const durationToStr = (hrs) => {
           const h = Math.floor(hrs);
           const m = Math.round((hrs - h) * 60);
           if (h > 0 && m > 0) return `${h}h${m}m`;
           if (h > 0) return `${h}h`;
           return `${m}m`;
         };

         // Build deadline as ISO string
         const deadlineToIso = (dlStr) => {
           if (!dlStr) return null;
           // dlStr is "HH:MM" format from our task objects
           const today = new Date();
           return `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}T${dlStr}:00`;
         };

         const payload = {
           user_id: "user_001",
           current_time_iso: isoTime,
           chronotype: characterType,
           current_vibe: currentVibeForApi,
           entries: localTasks.map((t) => ({
             id: t.id,
             type: "flexible",
             title: t.title,
             category: t.task_type || "routine",
             duration: durationToStr(parseFloat(t.duration) || 0.5),
             priority: t.priority || 3,
             cognitive_demand: t.cognitive_demand || 3,
             deadline: deadlineToIso(t.deadline),
           })),
         };

         // Log payload on first call
         if (isFirstCall) {
           console.log("=== API PAYLOAD (First Call) ===");
           console.log(JSON.stringify(payload, null, 2));
           setDebugPayload(payload);
           isFirstCall = false;
         }

         // 2. Tembak API
         const res = await fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

         if (!res.ok) throw new Error(`DDQN error: ${res.status}`);
         const d = await res.json();

         setDebugResponse(prev => [...prev, d]); // Append to debug array

         if (d.status !== "success") break;

         // Match by id first, then by title as fallback
         let recTask = null;
         if (d.recommended_task_id) {
           recTask = localTasks.find((t) => t.id === d.recommended_task_id);
         }
         if (!recTask && d.recommended_task_title) {
           recTask = localTasks.find((t) => t.title === d.recommended_task_title);
         }
         if (!recTask && d.recommended_task_index !== undefined) {
           recTask = localTasks[d.recommended_task_index];
         }
         if (!recTask) break;

         // 4. Masukkan ke dalam slot kalender UI
         const startSlot = Math.round(currTimeHour * 2);
         const slotsNeeded = Math.max(1, Math.round(recTask.duration * 2));

         sched.push({
           ...recTask,
           scheduled_start: startSlot,
           scheduled_slots: slotsNeeded,
           assigned_block: "AI",
         });

         // 5. Majukan waktu simulasi untuk tugas selanjutnya
         currTimeHour += recTask.duration;

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

  const activeTasks = tasks.filter((t) => !t.is_archived);
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
                <button style={scheduleLoading ? { ...S.btnP, opacity: 0.6 } : S.btnP} onClick={() => doGenerate(false)} disabled={scheduleLoading}>
                  {scheduleLoading ? "⏳ Scheduling..." : "◈ AI Schedule"}
                </button>
                <button 
                  style={{...S.btn, borderColor: '#ef4444', color: '#ef4444', background: 'rgba(239, 68, 68, 0.05)'}} 
                  onClick={() => { if(window.confirm("Reset all data?")) { localStorage.clear(); window.location.reload(); }}}
                >
                  ⚠ Reset Session
                </button>
              </>
            )}
            {view === "schedule" && <button style={S.btnP} onClick={() => doGenerate(true)}>↻ Regenerate</button>}
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
              <div style={{ flex: "1 1 40%", borderLeft: "1px solid rgba(255,255,255,0.06)", paddingLeft: 24, height: "100%", overflowY: "auto", paddingRight: 8 }}>
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
              
              {debugResponse && debugResponse.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#34d399", marginBottom: 8 }}>API RESPONSE HISTORY:</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {debugResponse.map((res, idx) => (
                      <div key={idx} style={{ padding: 8, background: "rgba(0,0,0,0.4)", borderRadius: 4, borderLeft: "2px solid #10b981" }}>
                        <div style={{ fontSize: 9, color: "#10b981", marginBottom: 4, fontWeight: 700 }}>STEP {idx + 1}</div>
                        <pre style={{ fontSize: 10, color: "#d1d1d6", margin: 0, overflowX: "auto" }}>
                          {JSON.stringify(res, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
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