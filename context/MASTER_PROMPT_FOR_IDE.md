# MASTER PROMPT — Build APUAHRLS Website Integration

You are building the frontend integration for **APUAHRLS** — an AI task scheduler that uses a DDQN (Double Deep Q-Network) model to create personalized schedules based on the user's chronotype, energy state, and behavioral history.

The existing codebase is a **React app on Tauri** (project originally called SylvaTDL). The main component is `Website5/context/my-app/src/APUAHRLS.jsx`. Your job is to connect this frontend to two external services:

1. **Gemini LLM** — parses natural language task input into structured JSON
2. **DDQN Model API** — hosted on Modal.com, returns the recommended task to do next

---

## ARCHITECTURE

```
User types tasks (natural language, Bahasa Indonesia or English)
         │
         ▼
┌─────────────────────────────────────────┐
│          React Frontend (Tauri)          │
│                                         │
│  1. Send text to Gemini API             │
│  2. Parse response into task list       │
│  3. Ask user for vibe (energy slider)   │
│  4. Send tasks + vibe + chronotype      │
│     to Modal DDQN API                   │
│  5. Display recommended schedule        │
│  6. After task completion, ask vibe #2  │
│  7. Store completion record in state    │
│  8. Request next task recommendation    │
└─────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌──────────────┐    ┌──────────────────────┐
│ Gemini API   │    │ Modal DDQN API       │
│ (parse text) │    │ (schedule decision)  │
└──────────────┘    └──────────────────────┘
```

**IMPORTANT:** The Gemini API call happens from the frontend (API key in env, "~/Desktop/Semester-4/Semester4/01_Academics/SM04MK03 Machine Learning/KCV/Website5/.env). The DDQN API is a POST endpoint on Modal.com. There is NO local backend — everything is serverless.

---

## API CONTRACTS

### 1. DDQN Model API (Radit's Modal deployment)

**URL:** `https://discordhoma--apuahrls-scheduler-api-schedulerapi-priorit-a5a5d1.modal.run`

**Method:** POST

**Request body:**

```json
{
  "user_id": "string",
  "current_hour": 10.5,
  "current_day": 0,
  "current_vibe": 0.6,
  "chronotype": "morning",
  "tasks_today": [
    {
      "id": "task_1",
      "duration": 2.0,
      "deadline": 23.98,
      "importance": 0.8,
      "cognitive_demand": 0.8,
      "task_type": "analytical",
      "partial_done": 0.0
    }
  ],
  "user_history_records": []
}
```

**Response:**

```json
{
  "status": "success",
  "recommended_task_index": 0,
  "recommended_task_id": "task_1",
  "q_values_debug": {
    "task_1": 1.23,
    "task_2": 0.87
  },
  "user_profile_used": [0.7, 0.2, 0.65, 0.0, 0.12, 0.7, 0.78, 0.72, 0.55, 1.1]
}
```

**Key details:**

- `current_hour`: float, hour of day (e.g., 14.5 = 2:30pm)
- `current_day`: int, 0 = today, 1 = tomorrow
- `current_vibe`: float 0.0–1.0 (user's self-reported energy)
- `chronotype`: one of "morning", "intermediate", "evening"
- `task_type`: one of "analytical", "routine", "creative"
- `importance`: float 0.0–1.0 (converted from priority: priority / 5)
- `cognitive_demand`: float 0.0–1.0 (converted from 1-5 scale: value / 5)
- `deadline`: float, absolute hour (e.g., 23.98 = 11:59pm today)
- `user_history_records`: array of past task completion records (empty for new users = cold start)

### 2. Gemini LLM API (for natural language parsing)

**Direct API call from frontend** using the Gemini REST API or SDK.

**System prompt to include:**

```
Current timestamp (ISO): {new Date().toISOString()}

You are a task parser for an AI scheduling system. Extract tasks and events from the user's input.

RULES:
1. Extract every task, event, and deadline mentioned.
2. Categorize each into EXACTLY ONE of these categories:
   - "analytical" — studying, coding, writing reports, homework, research, problem-solving
   - "routine" — errands, shopping, cleaning, exercise, gym, commute, admin tasks, emails
   - "creative" — brainstorming, design, planning, leisure activities, social events, hobbies
3. Mark events with specific times as "fixed" (type="fixed", include start/end as ISO datetime).
4. Mark tasks that can be scheduled flexibly as "flexible" (type="flexible").
5. Set priority 1-5 (5=most urgent/important).
6. Set cognitive_demand 1-5 based on mental focus needed.
7. Duration: estimate if not specified. Use formats like "30m", "1h", "2h", "1h30m".
8. Deadline: use ISO format.
9. If the user expresses tiredness, stress, or excitement:
   - Add to energy_forecast with scale: -2=exhausted, -1=tired, 0=normal, 1=good, 2=energized
```

**Expected Gemini response structure:**

```json
{
  "entries": [
    {
      "timestamp": "2026-04-14T10:00:00",
      "number_key": 1,
      "type": "flexible",
      "title": "Prepare presentation",
      "category": "analytical",
      "duration": "2h",
      "priority": 5,
      "cognitive_demand": 5,
      "deadline": "2026-04-14T12:00:00",
      "start": null,
      "end": null
    }
  ],
  "energy_forecast": [{ "time": "10:00", "potential_energy_level": -1 }]
}
```

---

## DATA CONVERSION (frontend must do this)

After receiving Gemini's response, convert entries to the DDQN API format:

```javascript
// Category mapping (Gemini already outputs these, but handle legacy values too)
const CATEGORY_TO_TASK_TYPE = {
  analytical: "analytical",
  study: "analytical",
  work: "analytical",
  routine: "routine",
  errands: "routine",
  exercise: "routine",
  creative: "creative",
  leisure: "creative",
};

// Duration parsing
function parseDurationToHours(str) {
  let hours = 0;
  const hMatch = str.match(/(\d+)h/);
  const mMatch = str.match(/(\d+)m/);
  if (hMatch) hours += parseInt(hMatch[1]);
  if (mMatch) hours += parseInt(mMatch[1]) / 60;
  return hours || 1.0;
}

// Convert Gemini entry to DDQN task format
function entryToSchedulerTask(entry) {
  const taskType =
    CATEGORY_TO_TASK_TYPE[entry.category.toLowerCase()] || "routine";
  const importance = entry.priority / 5.0;
  const cogDemand = entry.cognitive_demand / 5.0;
  const duration = parseDurationToHours(entry.duration);

  let deadlineHour = 23.98; // default: end of today
  if (entry.deadline) {
    const dt = new Date(entry.deadline);
    deadlineHour = dt.getHours() + dt.getMinutes() / 60;
  }

  return {
    id: `task_${entry.number_key}`,
    title: entry.title,
    duration: duration,
    deadline: deadlineHour,
    importance: importance,
    cognitive_demand: cogDemand,
    task_type: taskType,
    partial_done: 0.0,
    // Keep these for UI display but don't send to DDQN:
    _isFixed: entry.type === "fixed",
    _fixedStart: entry.start ? new Date(entry.start) : null,
    _fixedEnd: entry.end ? new Date(entry.end) : null,
    _originalPriority: entry.priority,
    _originalCogDemand: entry.cognitive_demand,
  };
}

// Convert energy forecast to vibe (0.0–1.0)
function energyForecastToVibe(forecast) {
  if (!forecast || forecast.length === 0) return 0.5;
  const avg =
    forecast.reduce((sum, e) => sum + e.potential_energy_level, 0) /
    forecast.length;
  return Math.max(0.1, Math.min(0.9, 0.5 + avg * 0.2));
}
```

---

## USER FLOW (step by step)

### Step 1: Onboarding (first time only)

- User selects chronotype: Morning / Intermediate / Evening
- Store in localStorage as `chronotype`
- Show a brief explanation of what each means

### Step 2: Task Input

Two modes (user can switch between them):

**Mode A — Natural Language (recommended):**

- Large textarea at top: "Tell me about your day..."
- User types freely: "Aku ada kelas jam 12-13, trus ada tugas ML deadline 23:59, harus nge gym jam 15-16"
- Button: "Parse with AI"
- Loading spinner while Gemini processes
- Result: task list auto-populates below
- User can edit/remove individual tasks after parsing

**Mode B — Manual Form (fallback):**

- Standard form: title, category dropdown (analytical/routine/creative), duration, priority (1-5), cognitive demand (1-5), deadline picker
- "Add Task" button
- Same as the existing form in APUAHRLS.jsx

### Step 3: Vibe Check

- Before generating schedule, ask: "How are you feeling right now?"
- Slider: 0 (exhausted) to 1.0 (energized), or simple buttons: 😫 😐 😊 🔥
- If Gemini detected energy from text, pre-fill the slider
- Store as `current_vibe` (float 0.0–1.0)

### Step 4: Generate Schedule

- Button: "Generate AI Schedule"
- Loading state while calling Modal API
- The frontend calls the DDQN API in a LOOP:
  1. Send all remaining flexible tasks + vibe + chronotype
  2. Get back `recommended_task_index`
  3. Move that task from "remaining" to "scheduled" list
  4. Advance `current_hour` by that task's duration
  5. Repeat until no flexible tasks remain
- Fixed events are placed at their specified times (not sent to DDQN)
- Result: a timeline showing tasks in recommended order with time slots

### Step 5: Schedule Display

- Timeline view (vertical, hour-by-hour)
- Each task block shows:
  - Task title
  - Time window (e.g., "9:00 – 11:00")
  - Task type badge (analytical/routine/creative, color-coded)
  - Priority indicator
- Fixed events shown in a different color (gray/locked)
- Color coding:
  - Analytical: purple/indigo
  - Routine: teal/green
  - Creative: amber/orange
  - Fixed: gray

### Step 6: Task Execution & Feedback

- When user starts a task: "Schedule starts now" indicator
- When user finishes: button "Mark Complete"
  - Ask vibe #2: "How do you feel after this task?" (same slider)
  - Record: { task_id, completed_on_time: true/false, actual_duration, vibe_before, vibe_after, was_abandoned: false }
- When user can't finish: button "Abandon"
  - Task goes back to remaining pool with partial_done = 0.5
  - Record: { ..., was_abandoned: true }
  - Re-call DDQN API for next recommendation

### Step 7: History Storage

- Store all completion records in localStorage (array of objects)
- On next session, send as `user_history_records` to the DDQN API
- This enables personalization over time
- Schema for each record:

```json
{
  "task_id": "task_1",
  "task_type": "analytical",
  "duration_hours": 2.0,
  "completed_on_time": 1,
  "actual_duration_hours": 1.8,
  "vibe_before": 0.6,
  "vibe_after": 0.7,
  "was_abandoned": false,
  "is_buffer": false,
  "user_accepted_buffer": null,
  "day": 1
}
```

---

## CHRONOTYPE DATA (hardcoded in frontend for display)

```javascript
const CHRONOTYPES = {
  morning: {
    label: "Morning Person",
    description: "Peak energy 8am–12pm, creative burst 4–7pm",
    emoji: "🌅",
    peakHours: "8:00 – 12:00",
    dipHours: "12:00 – 15:00",
  },
  intermediate: {
    label: "Intermediate",
    description: "Peak energy 10am–2pm, balanced throughout",
    emoji: "☀️",
    peakHours: "10:00 – 14:00",
    dipHours: "14:00 – 16:00",
  },
  evening: {
    label: "Night Owl",
    description: "Peak energy 4pm–9pm, slow mornings",
    emoji: "🌙",
    peakHours: "16:00 – 21:00",
    dipHours: "9:00 – 11:00",
  },
};
```

---

## EXISTING CODE STRUCTURE

The app lives in `src/APUAHRLS.jsx`. It currently has:

- Sidebar with navigation (Dashboard, Schedule, Archive)
- Dashboard view with task input form, fixed block input, energy slider
- Schedule view with timeline visualization
- Local `managerAgent()` and `workerAgent()` functions for heuristic scheduling
- `generateSchedule()` that ties manager + worker together
- Dark theme styling (dark gray backgrounds, white text)

**What to keep:** The overall layout, sidebar, dark theme, task display components.

**What to replace:**

- The manual-only task input → add natural language input as primary mode
- The local `managerAgent/workerAgent` heuristic → replace with DDQN API calls
- The energy slider (1-5 integer) → replace with vibe slider (0.0–1.0 float)

**What to add:**

- Chronotype selector (onboarding + settings)
- Natural language input with Gemini parsing
- DDQN API integration (iterative: get one task at a time, build schedule incrementally)
- Task completion feedback flow (vibe #2 after each task)
- History storage in localStorage
- Loading states for API calls

---

## ENVIRONMENT VARIABLES

```
REACT_APP_GEMINI_API_KEY=your_gemini_key_here
REACT_APP_DDQN_API_URL=https://discordhoma--apuahrls-scheduler-api-schedulerapi-priorit-a5a5d1.modal.run
```

---

## ERROR HANDLING

- If Gemini API fails: show error message below text input, keep user text for retry
- If DDQN API fails: fall back to local heuristic (keep existing `managerAgent/workerAgent` as fallback)
- If DDQN returns action index out of range: use first available task
- Network timeout: 30 seconds for Gemini, 60 seconds for DDQN
- Show clear loading indicators during API calls
- Never lose user input on error

---

## STYLE GUIDELINES

- Keep existing dark theme
- Use the color scheme already in APUAHRLS.jsx
- Task type colors: analytical = #534AB7 (purple), routine = #1D9E75 (teal), creative = #EF9F27 (amber)
- Fixed events = #888780 (gray)
- Vibe indicator: gradient from red (0.0) through yellow (0.5) to green (1.0)
- Use existing component patterns from the codebase
- No additional CSS frameworks — use inline styles or existing CSS approach

---

## FILES TO MODIFY

| File               | Action                                    |
| ------------------ | ----------------------------------------- |
| `src/APUAHRLS.jsx` | Major modification — add all new features |
| `.env`             | Add GEMINI_API_KEY and DDQN_API_URL       |

No new dependencies needed. All API calls use native `fetch()`.

---

## CONSTRAINTS

- This is a Tauri app — no server-side rendering, no Node.js backend
- All API calls happen from the React frontend
- localStorage is the only persistence layer
- The DDQN API returns ONE task recommendation per call — you must loop to build a full schedule
- Fixed events are NEVER sent to the DDQN API — they are UI-only constraints
- The DDQN API does not know about fixed events — the frontend must schedule around them

---

## DELIVERABLE

Modify `src/APUAHRLS.jsx` (and create helper files if needed) so that:

1. User can input tasks via natural language OR manual form
2. Tasks are parsed by Gemini into structured format
3. User selects chronotype (stored persistently)
4. User provides vibe check before scheduling
5. Schedule is generated by calling the DDQN API iteratively
6. Fixed events are placed at their times, flexible tasks fill around them
7. After each task, user gives completion feedback
8. History accumulates in localStorage for future personalization
9. Fallback to local heuristic if DDQN API is unavailable

Now build it.
