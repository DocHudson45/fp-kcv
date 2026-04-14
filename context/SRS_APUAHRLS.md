# Software Requirements Specification (SRS)

## Adaptive Task Prioritization via User-Aware Scheduling (APUAHRLS)

**Version:** 1.0
**Date:** April 2026
**Authors:** Omotopuawa (Dzaky), Ata, Radit

---

## 1. Introduction

### 1.1 Purpose

This document specifies the software requirements for APUAHRLS, an intelligent task scheduling system that creates personalized daily and weekly schedules based on the user's chronotype (body clock pattern), current energy state, behavioral history, and task properties. The system uses a trained neural network (Decision Engine) to determine the optimal task execution order, rather than relying on static rules.

This SRS is intended for developers building the production system, lab administrators evaluating the project, and team members integrating frontend, backend, and model components.

### 1.2 Scope

APUAHRLS consists of three subsystems:

1. **Natural Language Parser** — converts unstructured user input (in any language) into structured task objects using an LLM (Gemini)
2. **User Profile Computer** — computes a 10-feature behavioral summary from the user's historical task data
3. **Decision Engine** — a trained DDQN model that takes current tasks, user profile, and energy state as input and outputs the recommended task execution order

The system does NOT include: calendar synchronization (Google Calendar API is out of scope for this version), real-time notifications, or collaborative multi-user scheduling.

### 1.3 Definitions, Acronyms, and Abbreviations

| Term             | Definition                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| DDQN             | Double Deep Q-Network — a neural network that estimates the value of scheduling actions, using two networks to reduce estimation errors |
| Chronotype       | A user's biological clock category (morning, intermediate, or evening) that determines their energy pattern throughout the day          |
| Vibe             | A numeric representation (0.0–1.0) of the user's current self-reported energy and mood state                                            |
| Effective Energy | The user's actual energy at a given time, computed as the chronotype's base energy modulated by current vibe                            |
| User Profile     | A 10-dimensional numeric vector summarizing a user's behavioral patterns over the past 14 days                                          |
| Cold Start       | The state of a new user with insufficient historical data; the system uses population-average defaults                                  |
| Buffer           | A holding area for tasks whose deadlines are beyond the current day; the user can choose to work on them early or defer                 |
| Action Masking   | A technique that prevents the Decision Engine from selecting invalid actions (e.g., selecting a task that doesn't exist)                |
| State Vector     | An 85-dimensional numeric array encoding all information the Decision Engine needs to make a scheduling decision                        |
| Task Type        | One of three categories: analytical (high cognitive load), routine (low cognitive load), or creative (moderate, divergent thinking)     |

### 1.4 Overview

The remainder of this document describes the system architecture, features, interfaces, functional and non-functional requirements, data structures, workflows, use cases, and known limitations.

---

## 2. Overall Description

### 2.1 Product Perspective

APUAHRLS fills a gap between static task managers (which know what you need to do but not when you should do it) and generic AI assistants (which give advice but don't learn your personal patterns). The system combines three sources of intelligence:

1. **Circadian science** — decades of research on how cognitive performance varies by time of day and chronotype (Wieth & Zacks 2011, Valdez et al. 2012, Blatter & Cajochen 2007)
2. **Behavioral learning** — the user's own task completion history, lateness patterns, and preferences
3. **Real-time adaptation** — the user's current mood/energy state at the moment of scheduling

### 2.2 System Architecture Overview

The system has two parallel input paths that merge at the State Encoder:

```
┌──────────────┐     ┌─────────────────┐     ┌────────────────────┐
│   Frontend   │────▶│  LLM Parser     │────▶│ convert_entries()  │──┐
│  (React UI)  │     │  (Gemini API)   │     │ (data.py)          │  │
└──────────────┘     └─────────────────┘     └────────────────────┘  │
                                                                      ▼
                                                              ┌──────────────┐     ┌────────────┐
                                                              │State Encoder │────▶│  Decision   │────▶ Schedule
                                                              │(85-dim vec)  │     │  Engine     │
                                                              └──────────────┘     │  (DDQN)    │
                                                                      ▲            └────────────┘
┌──────────────┐     ┌─────────────────┐                              │
│  User History│────▶│compute_profile()│──────────────────────────────┘
│  Database    │     │(10-dim vector)  │
└──────────────┘     └─────────────────┘
```

The LLM provides today's tasks. The database provides the user's behavioral profile. Both are independent inputs — the LLM does not access user history, and the profile computer does not parse natural language.

### 2.3 User Characteristics

The system targets individual users who:

- Have recurring daily tasks with varying cognitive demands and deadlines
- Want a schedule that adapts to their energy patterns rather than treating all hours equally
- May input tasks in natural language (including Bahasa Indonesia)
- Fall into one of three chronotype categories (morning, intermediate, evening)
- Range from highly disciplined planners to chronic deadliners

### 2.4 Constraints

- The Decision Engine is a pre-trained neural network; it does not retrain during deployment
- Maximum 10 tasks can be considered per scheduling decision
- The system requires at least 7 days of historical data for personalization; otherwise, cold-start defaults are used
- The LLM parser requires internet access and a valid Gemini API key
- The Decision Engine requires PyTorch for inference (or a Modal.com serverless deployment)

### 2.5 Assumptions

- Users accurately self-report their chronotype during onboarding
- Users provide honest vibe/energy assessments when prompted
- Task durations provided by users are approximate estimates, not exact values
- The system operates on a single-user basis; it does not coordinate schedules between multiple users

---

## 3. System Features

### 3.1 Personalized Task Scheduling

**Description:** The system generates a recommended task execution order that is personalized to the specific user based on their behavioral profile, chronotype, and current energy state.

**Inputs:**

- List of today's tasks (from LLM parser or direct entry)
- User's chronotype (morning / intermediate / evening)
- User's current vibe (0.0–1.0)
- User's behavioral profile (10-dimensional vector from history)

**Processing:**

1. Tasks and context are encoded into an 85-dimensional state vector
2. The Decision Engine evaluates all available actions (which task to do next)
3. The action with the highest estimated value is selected
4. The selected task is returned as the recommendation

**Outputs:**

- Recommended task ID and index
- Estimated value scores for all available tasks (for transparency/debugging)
- User profile that was used (for verification)

### 3.2 User Profile Computation

**Description:** The system computes a compact 10-feature summary of the user's behavioral patterns from their historical task data. This profile is what makes the system personalized — the same Decision Engine produces different schedules for different profiles.

**Inputs:**

- User's task history records (past 14 days)
- Required columns: completed_on_time, actual_duration_hours, duration_hours, task_type, vibe_after, was_abandoned, is_buffer, user_accepted_buffer, day

**Processing:**
The `compute_profile()` function calculates:

| Index | Feature            | Computation                                                          |
| ----- | ------------------ | -------------------------------------------------------------------- |
| 0     | completion_rate    | Mean of completed_on_time over 14-day window                         |
| 1     | avg_lateness_norm  | Mean excess duration for late tasks, normalized by /4.0              |
| 2     | chrono_confidence  | 1 − 2×std(daily completion rate); measures consistency               |
| 3     | vibe_trend         | Linear regression slope of vibe_after × 10; captures mood trajectory |
| 4     | abandon_rate       | Fraction of tasks that were abandoned midway                         |
| 5     | pref_analytical    | Completion rate specifically for analytical tasks                    |
| 6     | pref_routine       | Completion rate specifically for routine tasks                       |
| 7     | pref_creative      | Completion rate specifically for creative tasks                      |
| 8     | buffer_accept_rate | Fraction of buffer tasks the user accepted for early work            |
| 9     | duration_ratio     | Median of actual_duration / estimated_duration                       |

**Outputs:**

- numpy array of shape (10,), dtype float32
- If user has < 7 days of history, returns cold-start population average: `[0.70, 0.20, 0.65, 0.00, 0.12, 0.70, 0.78, 0.72, 0.55, 1.10]`

### 3.3 Task Prioritization Engine (Decision Engine)

**Description:** The core scheduling intelligence. A pre-trained DDQN neural network that takes the current system state and outputs estimated values for each possible scheduling action.

**Inputs:**

- 85-dimensional state vector (see Section 7 for structure)

**Processing:**

1. State is normalized using frozen training statistics (mean and standard deviation)
2. Normalized state is passed through a neural network (2 hidden layers of 128 neurons each)
3. The network outputs 11 values (one per possible action)
4. Invalid actions are masked (set to negative infinity)
5. The action with the highest value is selected

**Outputs:**

- Selected action index (0–9 = task index, 10 = abandon)
- Raw value estimates for all actions (optional, for debugging)

### 3.4 Energy-Aware Scheduling

**Description:** The system uses circadian research to determine the user's energy level and best task type at any given hour. This information is embedded in the state vector, allowing the Decision Engine to prefer scheduling analytical tasks during peak energy and routine tasks during energy dips.

**Inputs:**

- User's chronotype
- Current hour of day
- Current vibe

**Processing:**

1. Look up the base energy level and best task type from the chronotype energy curve
2. Modulate by current vibe: `effective_energy = base_energy × (0.5 + 0.5 × vibe)`
3. A tired morning person at 9am (base 0.95, vibe 0.3) gets effective energy 0.62, not 0.95
4. This is encoded per-task as an energy value and a type_match flag (1.0 if task type matches the hour's best type, 0.0 otherwise)

**Chronotype Energy Curves:**

| Chronotype              | Analytical Peak   | Post-Lunch Dip    | Creative Window |
| ----------------------- | ----------------- | ----------------- | --------------- |
| Morning (wake 5–7)      | 8–12 (0.85–0.95)  | 12–15 (0.40–0.45) | 16–19 (0.65)    |
| Intermediate (wake 7–8) | 10–14 (0.80–0.90) | 14–16 (0.50)      | 16–17 (0.60)    |
| Evening (wake 9–10)     | 16–21 (0.85–0.90) | 9–11 (0.45)       | 21–24 (0.65)    |

**Outputs:**

- Effective energy level (0.05–1.0)
- Best task type for current hour (analytical / routine / creative)

### 3.5 Deadline Management

**Description:** The system tracks time-to-deadline and slack for each task, ensuring that urgent tasks are prioritized while balancing energy alignment and user wellbeing.

**Inputs:**

- Task deadline (absolute hour)
- Task duration (estimated hours)
- Current system hour

**Processing:**

- time_to_deadline = task.deadline − current_hour
- slack = time_to_deadline − task.duration
- Both values are encoded in the state vector per task
- The Decision Engine has learned (during training) that negative slack indicates impossible-to-meet deadlines and very late completions incur increasing penalties

**Outputs:**

- Per-task time_to_deadline and slack values in the state vector

### 3.6 Mood/Vibe Adaptation

**Description:** The system collects the user's self-reported energy/mood twice: before scheduling (vibe input #1) and after completing a task (vibe input #2). The pre-scheduling vibe modulates the energy curve. The post-task vibe is stored for profile computation.

**Inputs:**

- Vibe #1: user's self-reported energy before scheduling (0.0–1.0)
- Vibe #2: user's self-reported energy after completing a task (0.0–1.0)
- LLM-inferred energy from natural language mood cues (e.g., "cape banget" → low energy)

**Processing:**

- Vibe #1 modulates the chronotype energy curve for the current scheduling session
- Vibe #2 is recorded in the task history database for future profile computation
- The vibe_trend feature in the user profile captures whether the user's mood has been improving or declining over the past 14 days

**Outputs:**

- Adjusted effective energy for current session
- Stored vibe_after value for historical record

### 3.7 Weekly Buffer Management

**Description:** Tasks with deadlines beyond the current day are stored in a buffer. Each day, the system identifies buffer tasks with approaching deadlines and offers them to the user for early execution.

**Inputs:**

- All tasks across the current week
- Each task's deadline day

**Processing:**

1. On each new day, tasks with deadline_day ≤ current_day + 1 are pulled from the buffer into today's task pool
2. Tasks with deadline_day > current_day + 1 remain in the buffer
3. The buffer_accept_rate in the user profile captures whether the user typically accepts or defers buffer tasks
4. Unfinished tasks at the end of a day are moved to the buffer if their deadline is in the future

**Outputs:**

- Today's merged task pool (new tasks + relevant buffer tasks)
- Updated buffer (remaining deferred tasks)

### 3.8 Task Abandonment Handling

**Description:** The system supports partial task completion. If the user realizes a task is misaligned with their current energy (e.g., deep analytical work during a post-lunch dip), they can abandon it. The task returns to the pool with its partial progress saved.

**Inputs:**

- Abandon action (action index = 10 in the Decision Engine)

**Processing:**

1. The first task in the current pool is selected as the abandonment target
2. 50% of remaining work is considered completed: `partial_done += 0.5 × (1 − partial_done)`
3. The task is moved to the back of the queue (deprioritized)
4. Time advances by the duration of partial work
5. The user's vibe is updated (abandonment typically decreases vibe)
6. The abandon_rate in the user profile tracks how often the user does this

**Outputs:**

- Task returned to pool with updated partial_done value
- Updated current_hour and vibe

---

## 4. External Interface Requirements

### 4.1 User Interface (Frontend)

The frontend is a React web application that provides:

- **Onboarding screen:** chronotype selection (morning / intermediate / evening)
- **Task input:** natural language text field where users describe their tasks in any language
- **Vibe input:** a simple selector or slider for current energy level (before scheduling)
- **Schedule display:** timeline visualization of recommended task order with time blocks
- **Task completion:** buttons for "Done" (triggers vibe #2 input) and "Abandon" (returns task to pool)
- **Fixed event display:** immovable events (classes, gym, meetings) shown as blocked time

### 4.2 API Interface

The system exposes a REST API (FastAPI or Modal.com serverless):

**POST /parse** — Parse natural language input

- Input: `{ "text": "Aku ada kelas jam 12-13..." }`
- Output: `{ "entries": [...], "energy_forecast": [...] }`
- Backend: Gemini LLM

**POST /prioritize_tasks** — Get recommended task order

- Input: `ScheduleRequest` (see Section 4.2.1)
- Output: `{ "recommended_task_index": int, "recommended_task_id": str, "q_values_debug": {...}, "user_profile_used": [...] }`
- Backend: DDQN model inference

#### 4.2.1 ScheduleRequest Schema

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
  "user_history_records": [...]
}
```

### 4.3 Data Interface

**Input data (from LLM parser):**

- `Entry` objects: timestamp, type (fixed/flexible), title, category, duration, priority, cognitive_demand, deadline, start/end times

**Conversion (data.py):**

- Category mapping: study/work → analytical, errands/exercise → routine, leisure → creative
- Priority (1–5) → importance (0.2–1.0): `importance = priority / 5.0`
- Cognitive demand (1–5) → cognitive_demand (0.2–1.0): `cognitive_demand = value / 5.0`
- Duration string → hours: "2h" → 2.0, "30m" → 0.5, "1h30m" → 1.5

**Output data (to frontend):**

- Ordered list of task IDs representing the recommended schedule
- Fixed events as blocked time constraints

### 4.4 Model Interface

**Model file:** `ddqn_model_final.pth` (234 KB)

- Contains: Q-network weights, target network weights, normalization statistics (frozen mean and std), architecture parameters, chronotype curves, cold-start profile

**Config file:** `deploy_config.json`

- Contains: state_dim (85), n_actions (11), max_tasks (10), profile_dim (10), profile feature names, supported chronotypes, cold-start profile values, profile window (14 days)

**Loading procedure:**

1. Load config JSON for dimension parameters
2. Load .pth file with `torch.load(path, map_location='cpu', weights_only=False)`
3. Instantiate QNet(state_dim, n_actions, hidden=128)
4. Load state_dict from checkpoint
5. Set model to eval mode
6. Load normalization mean and std from checkpoint

---

## 5. Functional Requirements

| ID    | Requirement                                                                                                                                   | Priority |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-1  | The system shall parse natural language user input into structured task objects with type, duration, deadline, priority, and cognitive demand | High     |
| FR-2  | The system shall classify tasks into exactly one of three types: analytical, routine, or creative                                             | High     |
| FR-3  | The system shall distinguish between fixed events (immovable) and flexible tasks (schedulable)                                                | High     |
| FR-4  | The system shall compute a 10-feature user profile from the most recent 14 days of task history                                               | High     |
| FR-5  | The system shall use population-average defaults when the user has fewer than 7 days of history (cold start)                                  | High     |
| FR-6  | The system shall generate a recommended task execution order using the Decision Engine                                                        | High     |
| FR-7  | The system shall encode the current scheduling context as an 85-dimensional state vector                                                      | High     |
| FR-8  | The system shall mask invalid actions to prevent the Decision Engine from selecting nonexistent tasks                                         | High     |
| FR-9  | The system shall compute effective energy by modulating the chronotype base energy with the user's current vibe                               | High     |
| FR-10 | The system shall support three chronotypes: morning, intermediate, and evening                                                                | High     |
| FR-11 | The system shall accept user vibe input before scheduling and after task completion                                                           | Medium   |
| FR-12 | The system shall store task completion records (on-time status, actual duration, vibe before/after, was_abandoned) for profile computation    | Medium   |
| FR-13 | The system shall support task abandonment, recording partial completion and returning the task to the pool                                    | Medium   |
| FR-14 | The system shall manage a weekly buffer of tasks with future deadlines, merging relevant buffer tasks into each day's pool                    | Medium   |
| FR-15 | The system shall carry unfinished tasks with future deadlines to the next day's buffer                                                        | Medium   |
| FR-16 | The system shall normalize the state vector using frozen training statistics before inference                                                 | Medium   |
| FR-17 | The system shall return value estimates for all available tasks alongside the recommendation (for transparency)                               | Low      |
| FR-18 | The system shall support task input in Bahasa Indonesia and English                                                                           | Low      |
| FR-19 | The system shall extract mood/energy cues from natural language input and convert them to a vibe value                                        | Low      |

---

## 6. Non-Functional Requirements

### 6.1 Performance

- Decision Engine inference shall complete in < 1 millisecond on CPU
- LLM parsing shall complete in < 5 seconds per request
- Profile computation shall complete in < 100 milliseconds for up to 500 historical records
- Total end-to-end latency (input to schedule display) shall not exceed 8 seconds

### 6.2 Scalability

- The Decision Engine shall serve all users from a single model instance (no per-user models)
- The system shall support up to 10,000 concurrent user profiles without retraining
- The model file shall remain under 500 KB to allow rapid deployment

### 6.3 Reliability

- The system shall degrade gracefully for cold-start users (population-average profile)
- The system shall handle missing or incomplete task data without crashing
- Invalid actions shall be masked rather than causing errors
- The system shall validate all input data types before processing

### 6.4 Maintainability

- All model parameters shall be stored in a single .pth file with a companion .json config
- The profile computation function shall be a standalone pure function with no side effects
- Energy curves shall be configurable via the config file, not hardcoded in the inference code
- The system shall use semantic versioning for model files

### 6.5 Security and Privacy

- User task history shall be stored per-user and not shared across users
- User profile vectors shall contain only aggregate statistics, not individual task content
- Users shall be able to delete their history, which triggers a cold-start reset
- The LLM parser shall not send user history to external APIs (only current session input)

---

## 7. Data Requirements

### 7.1 Dataset Structure

The training dataset contains 4,320 records: 18 synthetic users (6 behavioral archetypes × 3 chronotypes), each with 240 tasks over a 30-day simulated month.

**Core columns (27):**

| Column                | Type  | Description                               |
| --------------------- | ----- | ----------------------------------------- |
| user_id               | str   | Format: `{chronotype}_{archetype}`        |
| chronotype            | str   | morning / intermediate / evening          |
| archetype             | str   | One of 6 behavioral archetypes            |
| day                   | int   | Day number (1–30)                         |
| task_type             | str   | analytical / routine / creative           |
| duration_hours        | float | Estimated duration in hours               |
| deadline_day          | int   | Day number of deadline                    |
| importance            | float | 0.1–1.0                                   |
| cognitive_demand      | float | 0.1–1.0                                   |
| is_buffer             | bool  | True if deadline > assigned day           |
| user_accepted_buffer  | bool  | Whether user chose to work on buffer task |
| energy_at_assignment  | float | Effective energy at scheduled time        |
| vibe_before           | float | User vibe before task                     |
| vibe_after            | float | User vibe after completion                |
| completed_on_time     | int   | 1 (on time) or 0 (late)                   |
| actual_duration_hours | float | Actual time spent                         |
| was_abandoned         | bool  | Whether user abandoned the task           |

### 7.2 Task Attributes (Runtime)

Each task in the scheduling pool has:

| Attribute        | Type  | Range                       | Source                         |
| ---------------- | ----- | --------------------------- | ------------------------------ |
| id               | str   | unique                      | Generated or from parser       |
| duration         | float | 0.25–3.5 hours              | User estimate or LLM inference |
| deadline         | float | Absolute hour               | From parser conversion         |
| deadline_day     | int   | 0–4 (within episode)        | Computed from deadline         |
| importance       | float | 0.1–1.0                     | priority / 5                   |
| cognitive_demand | float | 0.1–1.0                     | cognitive_demand / 5           |
| task_type        | str   | analytical/routine/creative | From category mapping          |
| partial_done     | float | 0.0–1.0                     | Updated on abandonment         |

### 7.3 User Profile Vector (10 features)

| Index | Feature            | Range       | Update Frequency |
| ----- | ------------------ | ----------- | ---------------- |
| 0     | completion_rate    | [0, 1]      | Daily            |
| 1     | avg_lateness_norm  | [0, 1]      | Daily            |
| 2     | chrono_confidence  | [0, 1]      | Daily            |
| 3     | vibe_trend         | [−0.3, 0.3] | Daily            |
| 4     | abandon_rate       | [0, 1]      | Daily            |
| 5     | pref_analytical    | [0, 1]      | Daily            |
| 6     | pref_routine       | [0, 1]      | Daily            |
| 7     | pref_creative      | [0, 1]      | Daily            |
| 8     | buffer_accept_rate | [0, 1]      | Daily            |
| 9     | duration_ratio     | [0.5, 2.0]  | Daily            |

### 7.4 State Vector (85 dimensions)

| Segment           | Dimensions  | Content                                                                                                 |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| Per-task features | 10 × 7 = 70 | time_to_deadline, duration_remaining, importance, slack, cognitive_demand, effective_energy, type_match |
| Global features   | 5           | current_vibe, sin(hour), cos(hour), day_progress, buffer_count                                          |
| User profile      | 10          | The 10 profile features listed above                                                                    |

---

## 8. System Workflow

### 8.1 Full Scheduling Pipeline

```
1. USER INPUTS TASKS
   User types: "Aku ada kelas jam 12-13, trus ada tugas ML deadline 23:59"
                         │
2. LLM PARSING           ▼
   Gemini parses text → Entry[] with type, duration, deadline, priority, cognitive_demand
                         │
3. DATA CONVERSION        ▼
   convert_entries() → SchedulerTask[] (numeric format)
   - Category "study" → task_type "analytical"
   - Priority 5 → importance 1.0
   - "2h" → 2.0
   Separate: fixed events (constraints) vs flexible tasks (schedulable)
                         │
4. PROFILE COMPUTATION    │ (parallel, from database)
   compute_profile(user_history_14_days) → 10-dim profile vector
   If < 7 days history → cold-start defaults
                         │
5. VIBE INPUT             │ (parallel, from user)
   "How are you feeling?" → vibe value (0.0–1.0)
   Or inferred from LLM mood extraction
                         │
6. STATE ENCODING         ▼
   Merge: tasks (70 dims) + global context (5 dims) + profile (10 dims) = 85-dim state
   Apply frozen normalization (mean, std from training)
                         │
7. DECISION ENGINE        ▼
   DDQN forward pass → 11 Q-values
   Mask invalid actions → select argmax
   Output: "Do task #3 next"
                         │
8. SCHEDULE DISPLAY       ▼
   Frontend renders: recommended task order + fixed event blocks + time estimates
                         │
9. TASK EXECUTION         ▼
   User works on task → completes or abandons
                         │
10. FEEDBACK COLLECTION   ▼
    "How do you feel now?" → vibe #2
    Record: completed_on_time, actual_duration, vibe_before, vibe_after, was_abandoned
    Store in database → feeds future profile computation
                         │
11. NEXT TASK             ▼
    If tasks remain: return to step 6 with updated state
    If day ends: buffer remaining tasks, advance to next day
```

### 8.2 Iterative Scheduling

The system does not produce a full-day schedule in one shot. It recommends one task at a time, then updates the state after the user completes (or abandons) it. This allows the schedule to adapt in real time to changing energy and mood.

---

## 9. Use Cases

### UC-1: New User Scheduling (Cold Start)

**Actor:** First-time user
**Precondition:** No historical data exists
**Flow:**

1. User selects chronotype during onboarding (morning / intermediate / evening)
2. User enters tasks via natural language
3. System uses cold-start profile `[0.70, 0.20, 0.65, 0.00, 0.12, 0.70, 0.78, 0.72, 0.55, 1.10]`
4. System asks for current vibe
5. System generates schedule using chronotype energy curve + cold-start profile
6. After task completion, system collects feedback and stores in database
   **Postcondition:** User receives a reasonable schedule; historical data begins accumulating

### UC-2: Returning User with Personalization

**Actor:** User with 14+ days of history
**Precondition:** Database contains sufficient historical task records
**Flow:**

1. User logs in; system computes profile from last 14 days
2. User enters today's tasks
3. System identifies the user as, e.g., a "creative sprinter" (high creative completion, low analytical, moderate abandon rate)
4. System schedules creative tasks during peak energy and places analytical tasks in shorter blocks
5. User completes tasks with feedback; profile updates overnight
   **Postcondition:** Schedule is tailored to user's specific behavioral patterns

### UC-3: Mid-Day Rescheduling After Mood Change

**Actor:** User who started the day energized but crashed after lunch
**Precondition:** Morning tasks are completed; afternoon tasks remain
**Flow:**

1. At 2pm, system asks for vibe update
2. User reports low energy (vibe = 0.3)
3. System recomputes effective energy: morning person at 2pm, base 0.45 × modifier 0.65 = 0.29
4. System recommends routine tasks (low cognitive demand) for the post-lunch window
5. If the next scheduled task is analytical, the Decision Engine may recommend abandoning it and switching to a routine task
   **Postcondition:** Schedule adapts to user's actual energy state, not just their chronotype default

### UC-4: Weekly Buffer Management

**Actor:** User on Wednesday with tasks due Friday
**Precondition:** Some tasks have deadlines 2–3 days out
**Flow:**

1. On Wednesday morning, system pulls buffer tasks with deadline ≤ Thursday from the buffer
2. System presents them alongside today's new tasks
3. User with high buffer_accept_rate (planner) sees them integrated into the schedule
4. User with low buffer_accept_rate (deadliner) may see them deprioritized or offered as optional
5. Unfinished tasks at end of Wednesday carry to Thursday's buffer
   **Postcondition:** Weekly workload is distributed according to user's natural planning style

---

## 10. Constraints and Limitations

| Limitation                    | Impact                                                     | Mitigation                                                       |
| ----------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| No task dependencies          | Cannot model "task B requires task A"                      | User manually orders dependent tasks as fixed events             |
| No context-switching cost     | Assumes zero time between task transitions                 | Add 5–10 minute buffer in frontend display                       |
| Synthetic training data       | All behavioral patterns are simulated, not from real users | Dataset parameters calibrated to published productivity research |
| Maximum 10 tasks per decision | Tasks beyond 10 are invisible to the Decision Engine       | Paginate large task lists; most users have < 10 tasks/day        |
| No interruption modeling      | Assumes uninterrupted task execution                       | User can abandon and reschedule at any time                      |
| Fixed chronotype              | Users cannot change chronotype within a session            | Chronotype reassessment available in settings                    |
| Single-user system            | No collaborative scheduling or shared calendars            | Out of scope for this version                                    |
| No real-time calendar sync    | Google Calendar API credentials pending                    | Manual task input via LLM parser                                 |

---

## 11. Future Enhancements

| Enhancement                 | Description                                                     | Priority |
| --------------------------- | --------------------------------------------------------------- | -------- |
| Real user data collection   | Replace synthetic dataset with opt-in real user scheduling data | High     |
| Task dependencies           | Model prerequisite relationships between tasks                  | High     |
| Google Calendar integration | Sync fixed events and deadlines from Google Calendar            | High     |
| Context-switching cost      | Add transition time between tasks of different types            | Medium   |
| Notification system         | Push notifications for scheduled task start times               | Medium   |
| Collaborative scheduling    | Coordinate schedules between team members                       | Low      |
| Model retraining pipeline   | Periodic retraining with accumulated real-user data             | Low      |
| Chronotype auto-detection   | Infer chronotype from usage patterns instead of self-report     | Low      |
| CatBoost energy prediction  | Predict energy levels when user doesn't provide vibe input      | Low      |

---

## Appendix A: File Manifest

| File                     | Purpose                                             |
| ------------------------ | --------------------------------------------------- |
| `final_notebook.py`      | Complete training + evaluation pipeline             |
| `generate_dataset_v2.py` | Dataset generator (4,320 rows, 18 users)            |
| `dataset_v2_full.csv`    | Generated training/evaluation dataset               |
| `data.py`                | Pydantic schemas + LLM→DDQN conversion functions    |
| `main.py`                | Gemini LLM parser entry point                       |
| `ddqn_model_final.pth`   | Trained model weights (234 KB)                      |
| `deploy_config.json`     | Deployment configuration                            |
| `train_agent.py`         | Modal.com training script                           |
| `deploy_api.py`          | Modal.com inference API                             |
| `final_results.csv`      | Evaluation results for all 18 user profiles         |
| `README.md`              | Non-technical project overview (for Medium article) |
| `README_TECHNICAL.md`    | Technical documentation (for academic review)       |
