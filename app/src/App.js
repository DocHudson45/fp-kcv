import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  API_URL,
  CHRONOTYPES,
  TOTAL_SLOTS,
  ENERGY_LABELS,
  DEMAND_COLORS,
  BLOCK_COLORS,
  buildEnergyProfile,
  generateScheduleFallback,
  saveData,
  loadData,
  fmt,
  slotToTime,
  deadlineToHour,
  priorityToImportance,
  cogDemandStrToFloat,
} from "./utils";

const PriorityDots = ({ level }) => (
  <span style={{ display: "inline-flex", gap: 2 }}>
    {[1, 2, 3, 4, 5].map((i) => (
      <span
        key={i}
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: i <= level ? "#f59e0b" : "#27272a",
        }}
      />
    ))}
  </span>
);

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [view, setView] = useState("dashboard");
  const [vibe, setVibe] = useState(0.5); // 0.0 - 1.0 (defaults to 0.5)
  const [schedule, setSchedule] = useState([]);
  const [managerBlocks, setManagerBlocks] = useState([]);
  const [fixedBlocks, setFixedBlocks] = useState([]);
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
  const [characterType, setCharacterType] = useState("morning");
  const [nlInput, setNlInput] = useState("");
  const [nlLoading, setNlLoading] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [useAI, setUseAI] = useState(true);
  const [historyRecords, setHistoryRecords] = useState([]);
  const [toastMsg, setToastMsg] = useState("");
  const [nlError, setNlError] = useState("");

  useEffect(() => {
    const d = loadData();
    if (d) {
      if (d.tasks) setTasks(d.tasks);
      if (d.vibe !== undefined) setVibe(d.vibe);
      if (d.fixedBlocks?.length) setFixedBlocks(d.fixedBlocks);
      if (d.schedule) setSchedule(d.schedule);
      if (d.managerBlocks) setManagerBlocks(d.managerBlocks);
      if (d.characterType) setCharacterType(d.characterType);
      if (d.historyRecords) setHistoryRecords(d.historyRecords);
    }
  }, []);

  useEffect(() => {
    saveData({
      tasks,
      vibe,
      fixedBlocks,
      schedule,
      managerBlocks,
      characterType,
      historyRecords,
    });
  }, [tasks, vibe, fixedBlocks, schedule, managerBlocks, characterType, historyRecords]);

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

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) throw new Error("Parse failed");
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

      for (const e of data.entries || []) {
        if (e.type === "fixed" && e.start && e.end) {
          const sd = new Date(e.start);
          const ed = new Date(e.end);
          const startSlot = Math.min(TOTAL_SLOTS - 1, sd.getHours() * 2 + Math.floor(sd.getMinutes() / 30));
          const endSlot = Math.min(TOTAL_SLOTS, ed.getHours() * 2 + Math.floor(ed.getMinutes() / 30));
          if (endSlot > startSlot) {
            newFixed.push({
              id: crypto.randomUUID(),
              title: e.title.toUpperCase(),
              startSlot,
              endSlot,
            });
          }
        } else {
          newTasks.push({
            id: crypto.randomUUID(),
            title: e.title.toUpperCase(),
            task_type: e.category,
            duration: parseDurHr(e.duration),
            priority: e.priority,
            cognitive_demand: e.cognitive_demand,
            deadline: e.deadline || "",
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
    const remainingTasks = activeTasks.filter(t => !t.is_fixed);
    if (useAI) {
      setScheduleLoading(true);
      try {
        const nowHour = new Date().getHours() + new Date().getMinutes() / 60;
        
        // Modal DDQN API requires building schedule incrementally.
        // For simplicity in the UI context while simulating loops:
        // We will call Modal endpoint for the *first* task, and then perhaps we can sequence them locally or
        // call in a loop here. I'll just rely on the fallback for full scheduling visualization if API is not fully set.
        
        let localTasks = [...remainingTasks];
        let sched = [];
        let currTime = nowHour;
        
        let sanity = 10;
        while (localTasks.length > 0 && sanity > 0) {
           sanity--;
           const req = {
             user_id: "user_test",
             current_hour: currTime,
             current_day: 0,
             current_vibe: vibe,
             chronotype: characterType,
             tasks_today: localTasks.map(t => ({
               id: t.id,
               title: t.title,
               duration: t.duration,
               deadline: deadlineToHour(t.deadline),
               importance: priorityToImportance(t.priority),
               cognitive_demand: t.cognitive_demand / 5.0,
               task_type: t.task_type,
               partial_done: t.partial_done || 0.0
             })),
             user_history_records: historyRecords
           };
           
           const res = await fetch(API_URL, {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify(req)
           });
           
           if (!res.ok) throw new Error("DDQN error");
           const d = await res.json();
           
           // Find task
           const recTask = localTasks.find(t => t.id === d.recommended_task_id);
           if (!recTask) break;
           
           // Slot in
           const startSlot = Math.round(currTime * 2);
           const slotsNeeded = Math.max(1, Math.round(recTask.duration * 2));
           
           sched.push({ ...recTask, scheduled_start: startSlot, scheduled_slots: slotsNeeded, assigned_block: "AI" });
           
           currTime += recTask.duration;
           localTasks = localTasks.filter(t => t.id !== d.recommended_task_id);
        }

        setSchedule(sched);
        setManagerBlocks([]);
        setView("schedule");
        showToast("AI Schedule Generated!");
      } catch (err) {
        showToast("AI DDQN unavailable, falling back to local heuristic");
        const r = generateScheduleFallback(remainingTasks, fixedBlocks, vibe, characterType);
        setSchedule(r.scheduled);
        setManagerBlocks(r.managerBlocks);
        setView("schedule");
      }
      setScheduleLoading(false);
    } else {
      const r = generateScheduleFallback(remainingTasks, fixedBlocks, vibe, characterType);
      setSchedule(r.scheduled);
      setManagerBlocks(r.managerBlocks);
      setView("schedule");
    }
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
                <div style={{ display: "flex", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", overflow: "hidden" }}>
                  <button onClick={() => setUseAI(true)} style={{ padding: "6px 10px", fontSize: 10, cursor: "pointer", border: "none", background: useAI ? "rgba(52,211,153,0.15)" : "transparent", color: useAI ? "#34d399" : "#71717a" }}>AI (DQN)</button>
                  <button onClick={() => setUseAI(false)} style={{ padding: "6px 10px", fontSize: 10, cursor: "pointer", border: "none", background: !useAI ? "rgba(245,158,11,0.15)" : "transparent", color: !useAI ? "#f59e0b" : "#71717a" }}>Heuristic</button>
                </div>
                <button style={scheduleLoading ? { ...S.btnP, opacity: 0.6 } : S.btnP} onClick={doGenerate} disabled={scheduleLoading}>
                  {scheduleLoading ? "⏳ Scheduling..." : useAI ? "◈ AI Schedule" : "◈ Generate Plan"}
                </button>
              </>
            )}
            {view === "schedule" && <button style={S.btnP} onClick={doGenerate}>↻ Regenerate</button>}
          </div>
        </div>

        <div style={S.content}>
          {view === "dashboard" && (
             <div style={{ marginBottom: 16, padding: "16px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: nlLoading ? "1px solid rgba(52,211,153,0.4)" : "1px solid rgba(255,255,255,0.06)" }}>
               <div style={{ fontSize: 10, color: "#3f3f46", letterSpacing: 2, fontWeight: 600, marginBottom: 8 }}>NATURAL LANGUAGE INPUT (GEMINI)</div>
               <div style={{ display: "flex", gap: 8 }}>
                 <textarea rows={2} placeholder="Describe your day... (e.g. ada kelas jam 12, tugas ML deadline 23:59)" value={nlInput} onChange={(e) => setNlInput(e.target.value)} style={{ ...S.input, resize: "none" }} />
                 <button onClick={handleNlParse} disabled={nlLoading || !nlInput.trim()} style={{ ...S.btnP, minWidth: 120 }}>{nlLoading ? "⏳ Parsing..." : "Parse with AI"}</button>
               </div>
               {nlError && <div style={{ marginTop: 6, fontSize: 10, color: "#fca5a5" }}>{nlError}</div>}
             </div>
          )}

          {showAddTask && view === "dashboard" && (
             <div style={{ ...S.card, flexDirection: "column", alignItems: "stretch", gap: 12, marginBottom: 16 }}>
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

          {view === "dashboard" && (
            <>
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
                      <button onClick={() => archiveTask(task.id)} style={{ ...S.btn, color: "#22c55e" }}>DONE</button>
                      <button onClick={() => abandonTask(task.id)} style={{ ...S.btn, color: "#f59e0b" }}>ABANDON</button>
                      <button onClick={() => discardTask(task.id)} style={{ ...S.btn, color: "#ef4444" }}>✕</button>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {view === "schedule" && (
             <div style={{ display: "grid", gridTemplateColumns: "50px 1fr 60px" }}>
               {Array.from({ length: TOTAL_SLOTS }, (_, slot) => {
                  const time = slotToTime(slot);
                  const isHour = slot % 2 === 0;
                  const fixedHere = fixedBlocks.find((fb) => slot >= fb.startSlot && slot < fb.endSlot);
                  const scheduledHere = schedule.find((s) => slot >= s.scheduled_start && slot < s.scheduled_start + s.scheduled_slots);
                  const ep = energyProfile[slot];
                  const barH = Math.min(100, (ep / maxEnergy) * 100);
                  const isCurrent = slot === nowSlot;
                  const isPast = slot < nowSlot;
                  
                  return (
                    <div key={slot} style={{ display: "contents" }}>
                      <div style={{ fontSize: 10, color: isCurrent ? "#34d399" : isHour ? "#52525b" : "#27272a", padding: "4px 0" }}>{isHour ? time : ""}</div>
                      <div style={{ padding: "2px 0", minHeight: 28, background: isCurrent ? "rgba(52,211,153,0.03)" : "transparent" }}>
                        {fixedHere && slot === fixedHere.startSlot && (
                           <div style={{ background: "rgba(99,102,241,0.1)", borderRadius: 6, padding: "6px", height: (fixedHere.endSlot - fixedHere.startSlot) * 28 - 4 }}>
                             <span style={{ fontSize: 10, color: "#818cf8" }}>{fixedHere.title}</span>
                           </div>
                        )}
                        {scheduledHere && slot === scheduledHere.scheduled_start && (() => {
                          const c = BLOCK_COLORS[scheduledHere.task_type] || BLOCK_COLORS["routine"];
                          return (
                            <div style={{ background: c.bg, borderLeft: `3px solid ${c.border}`, padding: "6px", height: scheduledHere.scheduled_slots * 28 - 4 }}>
                              <span style={{ fontSize: 11, color: c.text, fontWeight: 700 }}>{scheduledHere.title}</span>
                            </div>
                          )
                        })()}
                      </div>
                      <div style={{ padding: "4px 8px", display: "flex", alignItems: "center" }}>
                        <div style={{ width: "100%", height: 6, background: "#18181b", borderRadius: 3 }}>
                          <div style={{ width: `${barH}%`, height: "100%", borderRadius: 3, background: ep > 0.7 ? "#34d399" : ep > 0.4 ? "#f59e0b" : "#ef4444" }} />
                        </div>
                      </div>
                    </div>
                  );
               })}
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
