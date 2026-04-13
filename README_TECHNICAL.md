# APUAHRLS — Technical Documentation

## Adaptive Task Prioritization via User-Aware Scheduling

### Double Deep Q-Network with Personalized User Profiles

---

## Table of Contents

1. [Problem Formulation](#1-problem-formulation)
2. [Theoretical Grounding](#2-theoretical-grounding)
3. [Dataset Design and Generation](#3-dataset-design-and-generation)
4. [Environment Specification](#4-environment-specification)
5. [State Representation](#5-state-representation)
6. [Action Space](#6-action-space)
7. [Reward Function](#7-reward-function)
8. [DDQN Architecture](#8-ddqn-architecture)
9. [Training Procedure](#9-training-procedure)
10. [Heuristic Baselines](#10-heuristic-baselines)
11. [Evaluation Protocol](#11-evaluation-protocol)
12. [Results](#12-results)
13. [Design Decisions and Justifications](#13-design-decisions-and-justifications)
14. [Known Limitations](#14-known-limitations)
15. [Deployment Architecture](#15-deployment-architecture)
16. [References](#16-references)

---

## 1. Problem Formulation

The task scheduling problem is formulated as a finite-horizon Markov Decision Process (MDP) defined by the tuple (S, A, T, R, γ):

- **S** — State space: 85-dimensional continuous vector encoding current tasks, temporal context, user energy state, and user behavioral profile
- **A** — Action space: discrete, |A| = 11 (select one of up to 10 tasks, or abandon)
- **T** — Transition function: deterministic task removal + stochastic vibe update + deterministic time advance
- **R** — Reward function: multi-objective composite of deadline adherence, energy-task alignment, vibe maintenance, and partial completion penalty
- **γ** — Discount factor: 0.99

The scheduling problem differs from standard RL benchmarks in three structural ways:

1. **Shrinking action space**: as tasks are completed, the number of valid actions decreases from up to 10 to 0 within each day. This requires action masking.
2. **Multi-day episodes**: each episode spans 5 days with day-to-day carryover of unfinished tasks via a buffer mechanism.
3. **User-conditioned policy**: the optimal policy depends on the user's behavioral profile, requiring the agent to learn a profile-conditioned mapping π(a|s, profile) rather than a single universal policy.

---

## 2. Theoretical Grounding

### 2.1 Circadian Performance Science

The energy curves used in this system are grounded in empirical circadian performance research:

**Analytical performance** follows the body temperature rhythm, peaking during the morning for morning chronotypes and during the evening for evening chronotypes. Valdez et al. (2012) demonstrated 15–30% performance differences between peak and trough times across attention, working memory, and executive function tasks using constant routine protocols.

**Creative/insight performance** exhibits a paradoxical pattern: Wieth & Zacks (2011) showed that non-optimal times of day (off-peak hours) produced 25 percentage-point improvements on insight problems compared to optimal times. This is attributed to reduced cognitive inhibition during off-peak periods, allowing broader associative thinking.

**Post-lunch dip** is endogenous and appears across all chronotypes, with performance decrements measurable in attention and reaction time tasks (Blatter & Cajochen, 2007). The dip is modeled as reduced energy (0.40–0.45) in the 12:00–15:00 window for morning chronotypes.

The three chronotype energy curves in our system:

| Chronotype | Wake | Analytical Peak | Post-Lunch Dip | Creative Window |
|---|---|---|---|---|
| Morning | 5–7 AM | 8–12 PM (0.85–0.95) | 12–15 (0.40–0.45) | 16–19 (0.65) |
| Intermediate | 7–8 AM | 10–14 (0.80–0.90) | 14–16 (0.50) | 16–17 (0.60) |
| Evening | 9–10 AM | 16–21 (0.85–0.90) | 9–11 (0.45) | 21–24 (0.65) |

### 2.2 RL for Scheduling

Bassen et al. (CHI 2020) demonstrated that PPO-based RL can schedule educational activities at scale, achieving higher learning gains with fewer assignments compared to both linear and self-directed baselines across 1,000+ learners.

Zhang & Ou (2025) introduced RL-MOTS, an adaptive-weight multi-objective reward function for task scheduling in cloud-edge environments, demonstrating that dynamic weight adjustment produces Pareto-optimal trade-offs between competing objectives (makespan, energy, cost). We adapted their dynamic weight concept for our multi-objective reward design.

### 2.3 Why DDQN Over Alternatives

| Method | Verdict | Reason |
|---|---|---|
| Tabular Q-learning | Infeasible | 85-dimensional continuous state space |
| Contextual Bandits | Insufficient | Cannot reason about delayed consequences (task ordering effects) |
| Standard DQN | Viable but flawed | Overestimates Q-values due to maximization bias (Van Hasselt et al., 2016) |
| **DDQN** | **Selected** | Decouples action selection from evaluation, reducing overestimation |
| PPO | Tested, inferior | Policy gradient suffers from invalid action masking in shrinking action spaces; random redirect corrupts gradient signal |
| SAC / HRL | Overengineered | Problem complexity doesn't justify; insufficient data for hierarchical decomposition |

---

## 3. Dataset Design and Generation

### 3.1 Overview

The dataset contains 4,320 task records generated from 18 synthetic user profiles (6 behavioral archetypes × 3 chronotypes), each performing 240 tasks over a simulated 30-day month (~8 tasks/day average).

### 3.2 Why Synthetic Data

Real user scheduling data with vibe annotations, energy levels, and circadian-aware completion patterns does not exist in any public dataset. Existing scheduling datasets (e.g., Google Calendar logs, Todoist exports) lack the critical variables our model requires: cognitive demand per task, energy level at assignment, user mood before/after, and chronotype classification.

The synthetic data is not arbitrary — every parameter is calibrated to produce behaviorally realistic patterns that match established findings in productivity psychology and circadian research. The generation process is deterministic given a seed (seed=42), ensuring full reproducibility.

### 3.3 Chronotype Energy Curves

Each chronotype defines a piecewise-constant energy function E(h) → [0, 1] mapping hour-of-day to energy level, plus a best-task-type label per block:

```
Morning:   (5,8)→0.50/routine  (8,10)→0.95/analytical  (10,12)→0.85/analytical
           (12,13)→0.40/routine (13,15)→0.45/routine   (15,16)→0.50/routine
           (16,19)→0.65/creative (19,22)→0.30/routine

Intermediate: (7,10)→0.50/routine  (10,12)→0.90/analytical  (12,14)→0.80/analytical
              (14,16)→0.50/routine (16,17)→0.60/creative    (17,18)→0.55/routine
              (18,23)→0.35/routine

Evening:   (9,11)→0.45/routine   (11,13)→0.50/creative    (13,16)→0.55/routine
           (16,19)→0.90/analytical (19,21)→0.85/analytical  (21,24)→0.65/creative
```

At runtime, base energy is modulated by current vibe: `effective_energy = base_energy × (0.5 + 0.5 × vibe)`. This ensures that vibe is an independent, non-circular input — a tired morning person at 9am (vibe=0.3) has effective energy 0.95 × 0.65 = 0.62, not the full 0.95.

### 3.4 User Archetypes

Six behavioral archetypes define the generation parameters:

| Archetype | completion_base | abandon_prob | buffer_accept | duration_ratio | vibe_trend |
|---|---|---|---|---|---|
| disciplined_planner | 0.92 | 0.03 | 0.85 | 0.95 | +0.10 |
| stressed_achiever | 0.85 | 0.08 | 0.70 | 1.25 | −0.10 |
| creative_sprinter | 0.72 | 0.20 | 0.50 | 1.10 | +0.05 |
| chronic_deadliner | 0.65 | 0.15 | 0.20 | 1.30 | −0.05 |
| steady_moderate | 0.78 | 0.10 | 0.60 | 1.05 | 0.00 |
| burnt_out | 0.50 | 0.30 | 0.35 | 1.40 | −0.20 |

Parameter definitions:

- **completion_base**: Base probability of completing a task on time, before alignment adjustments
- **abandon_prob**: Probability of abandoning a task midway through execution
- **buffer_accept**: Probability of accepting a buffer task (deadline > today) for today's schedule. High = planner behavior; low = deadliner behavior
- **duration_ratio**: Ratio of actual to estimated duration. Values > 1.0 indicate systematic underestimation of task duration
- **vibe_trend**: Daily bias applied to mood transitions. Negative values model declining mood trajectories

Additionally, each archetype has per-type completion preferences:

```
disciplined_planner:  analytical=0.90  routine=0.95  creative=0.88
stressed_achiever:    analytical=0.88  routine=0.85  creative=0.78
creative_sprinter:    analytical=0.55  routine=0.80  creative=0.92
chronic_deadliner:    analytical=0.60  routine=0.70  creative=0.65
steady_moderate:      analytical=0.75  routine=0.82  creative=0.76
burnt_out:            analytical=0.45  routine=0.55  creative=0.50
```

These preferences serve dual purposes: (1) they weight the task type distribution generated for each user (via multinomial sampling with normalized preferences as probabilities), and (2) they modulate the on-time probability during simulation.

### 3.5 Task Generation Process

For each user (archetype × chronotype), 240 tasks are generated:

1. **Task type**: sampled from multinomial distribution weighted by archetype's type_prefs
2. **Duration**: sampled uniformly — analytical: U(1.0, 3.5)h, routine: U(0.25, 1.5)h, creative: U(0.5, 2.5)h
3. **Cognitive demand**: sampled uniformly — analytical: U(0.7, 1.0), routine: U(0.1, 0.4), creative: U(0.4, 0.7)
4. **Importance**: U(0.1, 1.0) across all types
5. **Assigned day**: distributed roughly uniformly across 30 days (240/30 ≈ 8/day)
6. **Deadline offset**: sampled from discrete distribution, shaped by buffer_accept — planners get more spread [0,0,1,1,2,2,3,4,5], deadliners get tighter [0,0,0,0,1,1,2,3,5]
7. **Deadline hour**: U(wake_hour + 4, min(sleep_hour, 23))

### 3.6 Completion Simulation

For each scheduled task, the completion outcome is determined:

1. **Abandonment check**: Bernoulli(abandon_prob). If abandoned, completion_fraction ∈ U(0.3, 0.7)
2. **On-time probability** (if not abandoned): `P(on_time) = clip(completion_base + 0.15×aligned − 0.10×¬aligned + 0.10×effective_energy, 0.2, 0.98)`
3. **Actual duration**: `duration × U(ratio − 0.15, ratio + 0.05)` if on-time, `duration × U(ratio, ratio + 0.30)` if late
4. **Vibe update**: `vibe_after = clip(vibe_before + alignment_bonus + on_time_bonus + noise, 0.05, 1.0)` where alignment_bonus ∈ U(0.05, 0.15) if aligned, U(−0.15, −0.02) if misaligned; on_time_bonus = +0.05 or −0.10; noise ∼ N(0, 0.06)

### 3.7 Dataset Columns

23 columns per row:

| Column | Type | Description |
|---|---|---|
| user_id | str | `{chronotype}_{archetype}` |
| chronotype | str | morning / intermediate / evening |
| archetype | str | One of 6 archetype names |
| day | int | Day 1–30 |
| day_of_week | str | Mon–Sun |
| wake_time | float | Hour of wake (e.g. 6.3) |
| task_id | str | Unique identifier |
| task_name | str | Sampled from pool of 45 task names |
| task_type | str | analytical / routine / creative |
| duration_hours | float | Estimated duration |
| deadline_day | int | Day number of deadline |
| deadline_hour | int | Hour of deadline |
| importance | float | 0.1–1.0 |
| cognitive_demand | float | 0.1–1.0 |
| is_buffer | bool | True if deadline > assigned_day |
| user_accepted_buffer | bool/None | True/False for buffer tasks, None for same-day |
| assigned_block_type | str/None | Energy block type at scheduled time (None if rejected) |
| assigned_hour | float/None | Hour when task was scheduled |
| energy_at_assignment | float/None | Effective energy at assignment time |
| vibe_before | float | Vibe prior to task |
| vibe_after | float/None | Vibe after completion (None if rejected buffer) |
| completed_on_time | int/None | 1 or 0 (None if rejected buffer) |
| actual_duration_hours | float/None | Actual time spent |
| was_abandoned | bool | Whether user abandoned task |
| profile_* (4 cols) | float | Key profile features for reference |

### 3.8 Dataset Validation

Post-generation validation confirms behavioral consistency:

| Validation Check | Result |
|---|---|
| Aligned task on-time rate vs misaligned | 79.4% vs 64.1% (15.3pp gap) |
| Disciplined planner vs burnt_out completion | 86.7% vs 39.9% |
| Disciplined planner vs burnt_out abandon rate | 1.9% vs 17.9% |
| Total scheduled tasks (excluding rejected buffer) | 3,173 of 4,320 |
| Buffer acceptance range | 20% (deadliner) to 85% (planner) |

The 15.3 percentage-point alignment gap is the core signal the DDQN exploits: scheduling tasks in energy-appropriate windows measurably improves completion.

---

## 4. Environment Specification

### 4.1 Episode Structure

One episode = 5 working days. Each day:

1. Wake time sampled from chronotype range + 0.5h wake-up buffer
2. Daily tasks generated (4–10 per day, variable)
3. Buffer tasks with deadline ≤ current_day + 1 merged into task pool
4. Agent sequences tasks until clock exceeds 22:00 or pool is empty
5. Remaining tasks with future deadlines transfer to buffer
6. Day advances; vibe carries over with N(0, 0.1) noise

### 4.2 Day Termination Conditions

A day ends when any of these conditions is met:

- All tasks in the current pool are completed
- The hour-of-day clock exceeds 22:00 (past working hours)
- The agent selects the abandon action with an empty task pool

### 4.3 Task Properties (Per Task)

| Property | Type | Range | Source |
|---|---|---|---|
| duration | float | 0.25–3.5 h | Type-dependent uniform |
| deadline | float | Absolute hour (day × 24 + hour) | Day offset + hour |
| deadline_day | int | 0 to n_days | Offset from assignment day |
| importance | float | 0.1–1.0 | Uniform |
| cognitive_demand | float | 0.1–1.0 | Type-dependent uniform |
| task_type | str | analytical/routine/creative | Multinomial by profile |
| partial_done | float | 0.0–1.0 | Updated on abandonment |

### 4.4 Vibe Dynamics

Initial vibe on day 0: `clip(U(0.3, 0.7) + profile[vibe_trend], 0.15, 0.9)`

Subsequent days: `clip(previous_day_end_vibe + N(0, 0.1), 0.15, 0.9)`

Within-day updates: computed by the reward function based on alignment and completion (see Section 7).

---

## 5. State Representation

Total dimensionality: **85** = (10 × 7) + 5 + 10

### 5.1 Per-Task Features (7 features × 10 task slots = 70)

For each task slot i ∈ {0, ..., 9}:

| Feature | Formula | Range |
|---|---|---|
| time_to_deadline | task.deadline − current_hour | (-∞, +∞) |
| duration_remaining | task.duration × (1 − task.partial_done) | [0.1, 3.5] |
| importance | task.importance | [0.1, 1.0] |
| slack | time_to_deadline − duration_remaining | (-∞, +∞) |
| cognitive_demand | task.cognitive_demand | [0.1, 1.0] |
| effective_energy | base_energy × (0.5 + 0.5 × vibe) | [0.05, 1.0] |
| type_match | 1.0 if task.type == best_type_for_hour else 0.0 | {0, 1} |

Unused task slots (when fewer than 10 tasks available) are zero-padded. The DDQN uses action masking (Q-values set to −∞ for invalid indices) rather than ignoring padding, ensuring no gradient signal flows from padded slots.

### 5.2 Global Features (5)

| Feature | Formula | Range |
|---|---|---|
| current_vibe | self.current_vibe | [0.05, 1.0] |
| hour_sin | sin(2π × hour_of_day / 24) | [−1, 1] |
| hour_cos | cos(2π × hour_of_day / 24) | [−1, 1] |
| day_progress | current_day / (n_days − 1) | [0, 1] |
| buffer_count | min(len(buffer) / 5, 1) | [0, 1] |

The time-of-day encoding uses sine/cosine rather than raw hour to provide smooth periodicity — hour 23 and hour 0 are adjacent in the encoding despite being 23 apart in raw value.

### 5.3 User Profile Features (10)

These features are static within an episode (computed once from historical data, injected into every state):

| Index | Feature | Description | Range |
|---|---|---|---|
| 0 | completion_rate | Fraction of tasks completed on time (14-day window) | [0, 1] |
| 1 | avg_lateness_norm | Mean lateness for late tasks, normalized by /4 | [0, 1] |
| 2 | chrono_confidence | 1 − 2×std(daily_completion_rate) | [0, 1] |
| 3 | vibe_trend | Linear slope of vibe_after over recent period × 10 | [−0.3, 0.3] |
| 4 | abandon_rate | Fraction of started tasks that were abandoned | [0, 1] |
| 5 | pref_analytical | Completion rate for analytical tasks specifically | [0, 1] |
| 6 | pref_routine | Completion rate for routine tasks specifically | [0, 1] |
| 7 | pref_creative | Completion rate for creative tasks specifically | [0, 1] |
| 8 | buffer_accept_rate | Fraction of buffer tasks accepted for early work | [0, 1] |
| 9 | duration_ratio | Median(actual_duration / estimated_duration) | [0.5, 2.0] |

For cold-start users (< 7 days of history), the population average profile is used: `[0.70, 0.20, 0.65, 0.00, 0.12, 0.70, 0.78, 0.72, 0.55, 1.10]`.

### 5.4 State Normalization

Online running normalization is applied during training:

```
mean ← Σ states / n
var ← Σ states² / n − mean²
std ← √max(var, 1e-8)
normalized_state ← (state − mean) / std
```

After training completes, `freeze_norm()` is called to fix the mean and std, preventing normalization drift during evaluation. This is critical because `select_action()` updates running statistics during training but `select_greedy()` (evaluation) should not.

---

## 6. Action Space

|A| = 11, discrete.

| Action | Semantics |
|---|---|
| 0–9 | Execute task at index i from current task pool |
| 10 | Abandon/skip — stop current first task at 50% completion, return to pool |

### 6.1 Action Masking

Invalid actions (indices beyond the current task pool size) are masked by setting their Q-values to −∞ before argmax. During ε-greedy exploration, random actions are sampled only from the valid action set.

### 6.2 Abandon Mechanics

When action 10 (abandon) is selected:

1. The first task in the pool is selected as the target
2. `partial_done += 0.5 × (1 − partial_done)` — i.e., 50% of remaining work is completed
3. The task is moved to the back of the pool (deprioritized)
4. Time advances by the actual duration of the partial work
5. A partial completion penalty is applied to the reward

---

## 7. Reward Function

The reward is a four-component sum: R = R_deadline + R_alignment + R_vibe + R_partial

### 7.1 Deadline Component R_deadline ∈ [−2.0, +1.0]

```
if partial_completion:
    R_deadline = 0.0
elif on_time:
    R_deadline = importance                          # [0.1, 1.0]
else:
    lateness = finish_hour − deadline
    R_deadline = −importance × min(lateness, 4.0) / 2.0   # [−2.0, 0)
```

Design rationale: The lateness penalty scales with severity — being 4 hours late is 4× worse than being 1 hour late. The cap at 4 hours prevents infinite penalties from dominating. In v2 of the notebook, this component was capped at −1.0, which made the agent indifferent between "slightly late" and "very late." The uncapped (up to −2.0) version was implemented following technical review.

### 7.2 Alignment Component R_alignment ∈ [−0.4, +0.8]

```
if task_type == best_type_for_current_hour:
    R_alignment = 0.8 × effective_energy              # [0.04, 0.8]
else:
    R_alignment = −0.4                                 # constant penalty
```

Design rationale: In the original implementation (v1), alignment bonus was 0.3 × energy (max +0.285) against a deadline bonus of up to +1.0 — a 3.5:1 ratio that caused the agent to ignore alignment entirely. The rebalanced version (max +0.8 vs max +1.0, ratio 1:1.25) ensures alignment meaningfully competes with deadline pressure for the agent's attention. The asymmetric design (bonus scales with energy but penalty is constant) means misalignment always hurts, but alignment at peak energy is rewarded more than alignment at low energy.

### 7.3 Vibe Component R_vibe ∈ [−0.5, +0.5]

```
if aligned:
    vibe_delta = U(0.03, 0.12)
else:
    vibe_delta = U(−0.12, −0.02)

if completed: vibe_delta += 0.04
else: vibe_delta −= 0.06                    # abandonment frustration

vibe_delta += N(0, 0.08)                     # independent mood noise
vibe_delta = clip(vibe_delta, −0.25, 0.25)

R_vibe = 2.0 × vibe_delta
```

Design rationale: The N(0, 0.08) independent noise term breaks the circularity identified in technical review — without it, vibe is a deterministic function of alignment (making it redundant in the state vector). With noise, the agent must learn that vibe is a noisy, partially-predictable signal rather than a perfect proxy for alignment.

### 7.4 Partial Completion Penalty R_partial ∈ [−0.3, 0.0]

```
R_partial = −0.3 × (1 − completed_fraction)
```

Applies only when the abandon action is used. A task abandoned at 50% completion receives −0.15; at 30% completion, −0.21.

### 7.5 Reward Balance Analysis

All four components now operate on comparable scales:

| Component | Min | Max | Range | Role |
|---|---|---|---|---|
| R_deadline | −2.0 | +1.0 | 3.0 | Primary scheduling signal |
| R_alignment | −0.4 | +0.8 | 1.2 | Energy-aware task matching |
| R_vibe | −0.5 | +0.5 | 1.0 | User wellbeing maintenance |
| R_partial | −0.3 | 0.0 | 0.3 | Abandon disincentive |

Composite R_total range: [−3.2, +2.3]. The deadline component is intentionally the loudest signal (range 3.0) because meeting deadlines is the primary constraint, but alignment and vibe are now competitive rather than negligible.

---

## 8. DDQN Architecture

### 8.1 Network Architecture

Two identical Q-networks (online and target):

```
Input (85) → Linear(85, 128) → ReLU → Linear(128, 128) → ReLU → Linear(128, 11) → Q-values
```

Total parameters: 85×128 + 128 + 128×128 + 128 + 128×11 + 11 = **29,067 parameters** per network.

### 8.2 Double DQN Update Rule

Standard DQN target:
```
y = r + γ × max_a' Q_target(s', a')
```

DDQN target (Van Hasselt et al., 2016):
```
a* = argmax_a' Q_online(s', a')      ← online selects
y = r + γ × Q_target(s', a*)          ← target evaluates
```

This decoupling prevents the same network from both selecting and evaluating the best next action, reducing the maximization bias that causes Q-value overestimation.

### 8.3 Replay Buffer

Pre-allocated numpy arrays with capacity 60,000 transitions. Each transition stores: (normalized_state, action, reward, normalized_next_state, done, action_mask).

Action masks are pre-computed at storage time: a float array of size |A| with 0.0 for valid actions and −1e9 for invalid actions, added to Q-values during the target computation to enforce action masking.

### 8.4 Hyperparameters

| Parameter | Value | Justification |
|---|---|---|
| Learning rate | 5e-4 | Standard for small networks; Adam optimizer |
| Discount factor γ | 0.99 | Long episode horizon (5 days × ~7 steps/day ≈ 35 steps) |
| Initial ε | 1.0 | Full exploration at start |
| ε decay | 0.997 per episode | Reaches ~0.09 at episode 600 |
| Minimum ε | 0.02 | Maintains 2% exploration indefinitely |
| Batch size | 64 | Standard for replay-based methods |
| Buffer capacity | 60,000 | ≈ 600 episodes × ~35 transitions/episode × 2.8 coverage |
| Target network sync | Every 30 episodes | Stabilizes Q-targets |
| Hidden layer size | 128 | Two hidden layers, sufficient for 85-dim state |
| Gradient clipping | max_norm=5.0 | Prevents gradient explosion |
| Loss function | Smooth L1 (Huber) | Less sensitive to outlier rewards than MSE |

---

## 9. Training Procedure

### 9.1 Episode Generation

600 episodes, cycling through all 18 user profiles (ep % 18 selects the profile). Each episode:

1. Instantiate `PersonalizedTaskEnv` with the selected profile's chronotype and profile vector
2. Reset environment (generates day 0 tasks, sets initial vibe)
3. Loop until episode ends (5 days completed):
   - Observe state, select ε-greedy action from valid set
   - Execute action, observe reward and next state
   - Store normalized transition in replay buffer
   - Accumulate episode reward
4. Perform one gradient step (sample batch of 64 from buffer)
5. Decay ε
6. Sync target network every 30 episodes

### 9.2 Training Dynamics

The one-gradient-step-per-episode design is intentional: with ~35 transitions per episode, per-step training would oversample recent transitions. One step per episode maintains a balanced ratio of data collection to gradient updates.

### 9.3 Post-Training

After 600 episodes, `freeze_norm()` is called, fixing the normalization statistics (mean and std) computed during training. This prevents the running statistics from drifting during evaluation or deployment when the state distribution may differ slightly.

---

## 10. Heuristic Baselines

Four deterministic baselines are evaluated, none of which use the user profile:

| Baseline | Selection Rule | Uses Energy? | Uses Profile? |
|---|---|---|---|
| EDF | argmin(deadline) | No | No |
| SJF | argmin(remaining_duration) | No | No |
| HIF | argmax(importance) | No | No |
| EnergyAware | argmax(cognitive_demand) if energy ≥ 0.6, else argmin | Yes | No |

EnergyAware is the strongest heuristic because it uses energy information, but it cannot learn multi-factor interactions (e.g., "when vibe is low AND deadline is 3 hours away, do a quick easy task first to build momentum"). The DDQN's advantage comes from learning these conditional strategies.

---

## 11. Evaluation Protocol

- 30 test episodes per user profile, with seed offset 80000 (disjoint from training seeds)
- Deterministic policy (greedy action selection, no exploration)
- Frozen normalization statistics
- Metrics collected per episode: cumulative reward, deadline met rate, vibe delta, alignment rate, tasks completed

---

## 12. Results

### 12.1 DDQN vs EnergyAware (Best Heuristic)

Mean improvement across all 18 profiles, grouped by archetype:

| Archetype | Δ Reward vs EA | DDQN Deadline% | DDQN Vibe Δ |
|---|---|---|---|
| disciplined_planner | +2.1 | 98.0% | +0.424 |
| stressed_achiever | +1.7 | 97.6% | +0.387 |
| creative_sprinter | +1.9 | 96.4% | +0.366 |
| chronic_deadliner | +2.2 | 96.4% | +0.433 |
| steady_moderate | +1.4 | 96.7% | +0.376 |
| burnt_out | +1.5 | 96.4% | +0.409 |

### 12.2 Chronotype-Specific Findings

Evening chronotypes show the largest DDQN advantage: +2.9 to +7.2 reward improvement over EnergyAware. Morning and intermediate types show +0.5 to +2.0 improvement. This is because evening chronotypes have the most irregular energy pattern (productive only 4–9pm), which heuristic rules handle poorly.

### 12.3 Cold-Start Performance

Users with no history (population average profile): reward +25.0 to +26.2, deadline 96.5%–97.8%, vibe +0.42 to +0.45. The system degrades gracefully to chronotype-only scheduling.

### 12.4 Personalization Verification

Same tasks (seed 77777), morning chronotype, three different profiles:

```
disciplined_planner  → [7, 4, 4, 4, 4, 4, 2, 0]
chronic_deadliner    → [7, 4, 4, 4, 4, 0, 4, 7]
burnt_out            → [7, 4, 4, 4, 4, 7, 4, 4]
```

Action sequences diverge at step 5–6, confirming the agent reads profile features and adapts its policy accordingly.

---

## 13. Design Decisions and Justifications

### 13.1 Why Not a Manager-Worker Hierarchy?

The original design proposed a Manager (rule-based, creates time blocks) and Worker (RL, assigns tasks within blocks). In implementation, the Manager was absorbed into the environment's energy curve — the piecewise-constant energy function implicitly defines block types. A separate Manager component added architectural complexity without changing the agent's decision-making. The flat DDQN with energy-aware state features produces equivalent behavior with simpler code and clearer evaluation.

### 13.2 Why Profile Features Instead of User Embeddings?

User embeddings require: (a) a large user base to learn meaningful latent dimensions, (b) an embedding layer that must be jointly trained, and (c) a mechanism to handle new users. Profile features avoid all three issues — they are 10 hand-designed summary statistics computed from a SQL query, interpretable, and naturally handle cold start through population averages.

### 13.3 Why One Global Model Instead of Per-User Models?

Per-user models require sufficient per-user training data (hundreds of episodes), which is unrealistic for a consumer product. A single global model trained on all 18 profiles learns the profile-conditioned policy π(a|s, profile). The profile vector is what differentiates behavior — the same network weights serve all users.

### 13.4 Why Vibe-Modulated Energy Instead of Raw Vibe in State?

Original design: vibe is in the state, energy is computed from chronotype only. Problem: vibe_after was a deterministic function of alignment, making it a redundant copy of the type_match feature. Fix: vibe modulates the energy curve (effective_energy = base × (0.5 + 0.5 × vibe)), making it an independent causal input that changes the energy landscape, plus independent N(0, 0.08) noise breaks the deterministic relationship.

---

## 14. Known Limitations

1. **No task dependencies**: all tasks are independent. Real workflows have prerequisites.
2. **No context-switching cost**: transitioning between tasks is instantaneous. Real users need 10–15 minutes to refocus.
3. **Synthetic data only**: all behavioral patterns are simulated. Real-user validation is required for deployment claims.
4. **Fixed chronotype**: users cannot change chronotype within an episode. Real chronotypes shift with season, sleep debt, and life changes.
5. **No interruptions**: the environment assumes uninterrupted execution. Real days include meetings, phone calls, and disruptions.
6. **Limited to 10 tasks per day**: tasks beyond 10 are invisible to the agent. This is an engineering constraint of the fixed state dimension.

---

## 15. Deployment Architecture

```
┌──────────┐    ┌──────────────┐    ┌──────────────────┐    ┌────────────┐
│ Frontend │───▶│ Gemini LLM   │───▶│ convert_entries() │───▶│ DDQN Model │
│ (React)  │    │ (parse text) │    │ (data.py)         │    │ (.pth file)│
└──────────┘    └──────────────┘    └──────────────────┘    └─────┬──────┘
                                                                  │
    ┌─────────────────────────────────────────────────────────────┘
    │
    ▼
┌────────────────────┐    ┌──────────────────┐    ┌──────────────┐
│ compute_profile()  │───▶│ State Encoder    │───▶│ Schedule     │
│ (14-day history)   │    │ (85-dim vector)  │    │ (task order) │
└────────────────────┘    └──────────────────┘    └──────────────┘
```

Model file: `ddqn_model_final.pth` (234 KB)
Configuration: `deploy_config.json`
Inference latency: < 1ms per action on CPU

---

## 16. References

1. Van Hasselt, H., Guez, A., & Silver, D. (2016). Deep Reinforcement Learning with Double Q-learning. *AAAI Conference on Artificial Intelligence.*
2. Wieth, M.B. & Zacks, R.T. (2011). Time of day effects on problem solving: When the non-optimal is optimal. *Thinking & Reasoning, 17*(4), 387–401.
3. Valdez, P., Ramírez, C., & García, A. (2012). Circadian rhythms in cognitive performance: Implications for neuropsychological assessment. *ChronoPhysiology and Therapy, 2*, 81–92.
4. Blatter, K. & Cajochen, C. (2007). Circadian rhythms in cognitive performance: Methodological constraints, protocols, theoretical underpinnings. *Physiology & Behavior, 90*(2–3), 196–208.
5. Zhang, W. & Ou, H. (2025). Reinforcement learning based multi-objective task scheduling for energy efficient and cost effective cloud edge computing. *Scientific Reports, 15*, 41716.
6. Mao, L., Ma, Z., & Li, X. (2025). A Multi-Task Dynamic Weight Optimization Framework Based on Deep Reinforcement Learning. *Applied Sciences, 15*(5), 2473.
7. Bassen, J. et al. (2020). Reinforcement Learning for the Adaptive Scheduling of Educational Activities. *CHI '20: CHI Conference on Human Factors in Computing Systems.*
8. Schulman, J. et al. (2017). Proximal Policy Optimization Algorithms. *arXiv:1707.06347.*
