"""
APUAHRLS — Data Schemas & Conversion
======================================
Two layers:
  1. Entry / UserAnalysis — what the LLM parser outputs (human-readable)
  2. SchedulerTask — what the DDQN model expects (numeric)
  
The convert_entries_to_scheduler_tasks() function bridges them.
"""

from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime


# ═══════════════════════════════════════════════════════════════
# LAYER 1: LLM Parser Output (what Gemini returns)
# ═══════════════════════════════════════════════════════════════

class EnergyLevel(BaseModel):
    """User's self-reported or inferred energy at a specific time."""
    time: str = Field(description="Time of day in HH:MM format, e.g. '14:00'")
    potential_energy_level: int = Field(
        description="Energy scale: -2=exhausted, -1=tired, 0=normal, 1=good, 2=energized"
    )


class Entry(BaseModel):
    """A single task or event parsed from user input."""
    timestamp: str = Field(description="Current ISO timestamp when parsed")
    number_key: int = Field(description="Unique identifier for this entry")
    entry_type: str = Field(
        alias="type",
        description="'fixed' (immovable event) or 'flexible' (schedulable task)"
    )
    title: str = Field(description="Task/event name")
    category: str = Field(
        description="One of: 'analytical', 'routine', 'creative'. "
                    "Map user categories: study/work→analytical, "
                    "errands/exercise→routine, leisure→creative"
    )
    duration: str = Field(
        description="Estimated duration as string, e.g. '30m', '1h', '1h30m', '2h'"
    )
    priority: int = Field(
        description="1-5 scale, where 5 is most important. "
                    "Maps to importance: priority/5 = importance [0.2-1.0]"
    )
    cognitive_demand: int = Field(
        description="1-5 scale, where 5 is highest cognitive load. "
                    "Maps to cognitive_demand: value/5 = [0.2-1.0]"
    )
    deadline: Optional[str] = Field(
        default=None,
        description="ISO datetime string for deadline, or null if no deadline"
    )
    start: Optional[str] = Field(
        default=None,
        description="ISO datetime for fixed events only (start time)"
    )
    end: Optional[str] = Field(
        default=None,
        description="ISO datetime for fixed events only (end time)"
    )


class UserAnalysis(BaseModel):
    """Complete LLM parser output."""
    entries: List[Entry]
    energy_forecast: List[EnergyLevel]


# ═══════════════════════════════════════════════════════════════
# LAYER 2: DDQN Scheduler Input (what the model expects)
# ═══════════════════════════════════════════════════════════════

class SchedulerTask(BaseModel):
    """Task format expected by the DDQN environment."""
    id: str
    title: str
    duration: float = Field(description="Duration in hours (e.g. 2.0)")
    deadline: float = Field(description="Deadline as hour-of-day (e.g. 23.98 for 23:59)")
    deadline_day: int = Field(description="Which day (0=today, 1=tomorrow, ...)")
    importance: float = Field(description="0.0-1.0 scale")
    cognitive_demand: float = Field(description="0.0-1.0 scale")
    task_type: str = Field(description="'analytical', 'routine', or 'creative'")
    is_fixed: bool = Field(description="True if immovable event")
    fixed_start: Optional[float] = Field(
        default=None, description="Start hour for fixed events"
    )
    fixed_end: Optional[float] = Field(
        default=None, description="End hour for fixed events"
    )
    partial_done: float = Field(default=0.0)


# ═══════════════════════════════════════════════════════════════
# CONVERSION: LLM Output → Scheduler Input
# ═══════════════════════════════════════════════════════════════

# Category mapping: user-friendly categories → DDQN task types
CATEGORY_TO_TASK_TYPE = {
    # Analytical — high cognitive load, focused thinking
    "study": "analytical",
    "work": "analytical",
    "analytical": "analytical",
    "education": "analytical",
    "research": "analytical",
    
    # Routine — low cognitive load, procedural
    "errands": "routine",
    "exercise": "routine",
    "routine": "routine",
    "health & fitness": "routine",
    "health": "routine",
    "admin": "routine",
    "chores": "routine",
    
    # Creative — moderate cognitive, divergent thinking
    "leisure": "creative",
    "creative": "creative",
    "social": "creative",
    "hobby": "creative",
    "planning": "creative",
}


def parse_duration_to_hours(duration_str: str) -> float:
    """
    Convert duration string to hours.
    '30m' → 0.5, '1h' → 1.0, '1h30m' → 1.5, '2h' → 2.0
    """
    duration_str = duration_str.strip().lower()
    hours = 0.0
    
    if "h" in duration_str:
        parts = duration_str.split("h")
        hours += float(parts[0]) if parts[0] else 0
        if len(parts) > 1 and parts[1]:
            # Handle "1h30m" format
            mins_str = parts[1].replace("m", "").strip()
            if mins_str:
                hours += float(mins_str) / 60.0
    elif "m" in duration_str:
        mins_str = duration_str.replace("m", "").strip()
        hours = float(mins_str) / 60.0
    else:
        # Try as raw number (assume hours)
        try:
            hours = float(duration_str)
        except ValueError:
            hours = 1.0  # fallback
    
    return round(max(hours, 0.1), 2)


def iso_to_hour(iso_str: str) -> float:
    """Convert ISO datetime string to hour-of-day. '2026-04-14T23:59:00' → 23.98"""
    try:
        dt = datetime.fromisoformat(iso_str)
        return round(dt.hour + dt.minute / 60.0, 2)
    except (ValueError, TypeError):
        return 23.99


def iso_to_day_offset(iso_str: str, reference_date: datetime = None) -> int:
    """Convert ISO datetime to day offset from today. Today=0, tomorrow=1, etc."""
    try:
        dt = datetime.fromisoformat(iso_str)
        ref = reference_date or datetime.now()
        delta = (dt.date() - ref.date()).days
        return max(delta, 0)
    except (ValueError, TypeError):
        return 0


def convert_entries_to_scheduler_tasks(
    entries: List[Entry],
    reference_time: datetime = None
) -> List[SchedulerTask]:
    """
    ┌─────────────────────────────────────────────────────────────┐
    │  BRIDGE FUNCTION: LLM output → DDQN input                  │
    │                                                             │
    │  Call this after Gemini parses user input.                  │
    │  Feed the output list into the DDQN environment.           │
    └─────────────────────────────────────────────────────────────┘
    
    Conversions:
      category → task_type  (via CATEGORY_TO_TASK_TYPE mapping)
      priority (1-5) → importance (0.2-1.0)
      cognitive_demand (1-5) → cognitive_demand (0.2-1.0)
      duration string → hours float
      deadline ISO → hour float + day offset
    """
    if reference_time is None:
        reference_time = datetime.now()
    
    scheduler_tasks = []
    
    for entry in entries:
        # Map category to task_type
        cat_lower = entry.category.lower().strip()
        task_type = CATEGORY_TO_TASK_TYPE.get(cat_lower, "routine")
        
        # Convert scales
        importance = round(entry.priority / 5.0, 2)
        cog_demand = round(entry.cognitive_demand / 5.0, 2)
        duration_hours = parse_duration_to_hours(entry.duration)
        
        # Fixed vs flexible
        is_fixed = entry.entry_type.lower() == "fixed"
        
        # Deadline
        if entry.deadline:
            deadline_hour = iso_to_hour(entry.deadline)
            deadline_day = iso_to_day_offset(entry.deadline, reference_time)
        else:
            # No deadline → end of today
            deadline_hour = 23.99
            deadline_day = 0
        
        # Fixed event times
        fixed_start = iso_to_hour(entry.start) if entry.start else None
        fixed_end = iso_to_hour(entry.end) if entry.end else None
        
        # For fixed events, deadline = end time
        if is_fixed and fixed_end is not None:
            deadline_hour = fixed_end
        
        scheduler_tasks.append(SchedulerTask(
            id=f"task_{entry.number_key}",
            title=entry.title,
            duration=duration_hours,
            deadline=deadline_hour,
            deadline_day=deadline_day,
            importance=importance,
            cognitive_demand=cog_demand,
            task_type=task_type,
            is_fixed=is_fixed,
            fixed_start=fixed_start,
            fixed_end=fixed_end,
            partial_done=0.0,
        ))
    
    return scheduler_tasks


def energy_forecast_to_vibe(energy_levels: List[EnergyLevel]) -> float:
    """
    Convert LLM energy forecast to a single vibe value for the DDQN.
    
    Energy scale: -2 to +2 → Vibe scale: 0.1 to 0.9
    If no energy data, return 0.5 (neutral).
    """
    if not energy_levels:
        return 0.5
    
    avg_energy = sum(e.potential_energy_level for e in energy_levels) / len(energy_levels)
    # Map [-2, +2] → [0.1, 0.9]
    vibe = 0.5 + avg_energy * 0.2
    return round(max(0.1, min(0.9, vibe)), 2)


def scheduler_tasks_to_env_format(tasks: List[SchedulerTask]) -> list:
    """
    Convert SchedulerTask list to the dict format the DDQN environment expects.
    
    This is what you pass to env.tasks directly for inference.
    """
    env_tasks = []
    for i, t in enumerate(tasks):
        if t.is_fixed:
            continue  # Fixed events are constraints, not schedulable
        
        # Convert deadline to absolute hours (day * 24 + hour)
        abs_deadline = t.deadline_day * 24.0 + t.deadline
        
        env_tasks.append({
            "id": t.id,
            "title": t.title,
            "duration": t.duration,
            "deadline": abs_deadline,
            "deadline_day": t.deadline_day,
            "importance": t.importance,
            "cognitive_demand": t.cognitive_demand,
            "task_type": t.task_type,
            "partial_done": t.partial_done,
        })
    
    return env_tasks


# ═══════════════════════════════════════════════════════════════
# QUICK TEST
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    today = datetime.now().strftime("%Y-%m-%d")
    
    # Simulate what Gemini would return
    test_entries = [
        Entry(
            timestamp=f"{today}T10:00:00",
            number_key=1,
            type="fixed",
            title="Class with Presentation",
            category="study",
            duration="1h",
            priority=4,
            cognitive_demand=4,
            deadline=f"{today}T13:00:00",
            start=f"{today}T12:00:00",
            end=f"{today}T13:00:00",
        ),
        Entry(
            timestamp=f"{today}T10:00:00",
            number_key=2,
            type="flexible",
            title="Prepare presentation",
            category="study",
            duration="2h",
            priority=5,
            cognitive_demand=5,
            deadline=f"{today}T12:00:00",
            start=None,
            end=None,
        ),
        Entry(
            timestamp=f"{today}T10:00:00",
            number_key=3,
            type="fixed",
            title="Gym",
            category="exercise",
            duration="1h",
            priority=3,
            cognitive_demand=2,
            deadline=None,
            start=f"{today}T15:00:00",
            end=f"{today}T16:00:00",
        ),
        Entry(
            timestamp=f"{today}T10:00:00",
            number_key=4,
            type="flexible",
            title="Buy Baygon",
            category="errands",
            duration="30m",
            priority=2,
            cognitive_demand=1,
            deadline=None,
            start=None,
            end=None,
        ),
        Entry(
            timestamp=f"{today}T10:00:00",
            number_key=5,
            type="flexible",
            title="Resume PAA",
            category="study",
            duration="2h",
            priority=4,
            cognitive_demand=4,
            deadline=f"{today}T23:59:00",
            start=None,
            end=None,
        ),
        Entry(
            timestamp=f"{today}T10:00:00",
            number_key=6,
            type="flexible",
            title="K-means ML Assignment",
            category="study",
            duration="2h",
            priority=4,
            cognitive_demand=4,
            deadline=f"{today}T23:59:00",
            start=None,
            end=None,
        ),
    ]
    
    test_energy = [
        EnergyLevel(time="10:00", potential_energy_level=0),
    ]
    
    # Convert
    scheduler_tasks = convert_entries_to_scheduler_tasks(test_entries)
    vibe = energy_forecast_to_vibe(test_energy)
    env_tasks = scheduler_tasks_to_env_format(scheduler_tasks)
    
    print("=" * 60)
    print("LLM → Scheduler Conversion Test")
    print("=" * 60)
    
    print(f"\nVibe from energy forecast: {vibe}")
    
    print(f"\nFixed events (constraints, not scheduled):")
    for t in scheduler_tasks:
        if t.is_fixed:
            print(f"  {t.title}: {t.fixed_start:.1f}-{t.fixed_end:.1f}")
    
    print(f"\nFlexible tasks (for DDQN to schedule):")
    print(f"  {'Title':<25} {'Type':<12} {'Dur':>5} {'Imp':>5} {'Cog':>5} {'Deadline':>10}")
    for t in env_tasks:
        print(f"  {t['title']:<25} {t['task_type']:<12} {t['duration']:>5.1f} {t['importance']:>5.2f} {t['cognitive_demand']:>5.2f} {t['deadline']:>10.1f}")
