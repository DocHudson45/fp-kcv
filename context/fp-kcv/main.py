"""
APUAHRLS — LLM Parser (Gemini)
================================
Parses natural language user input into structured tasks
that feed directly into the DDQN scheduler.

Pipeline:
  User text → Gemini → UserAnalysis (JSON) → convert → SchedulerTask[] → DDQN
"""

import os
import json
import datetime

from dotenv import load_dotenv
from google import genai
from google.genai import types

from data import (
    UserAnalysis,
    convert_entries_to_scheduler_tasks,
    energy_forecast_to_vibe,
    scheduler_tasks_to_env_format,
)

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("Missing GEMINI_API_KEY in environment or .env file")

client = genai.Client(api_key=api_key)


def parse_user_input(user_input: str) -> dict:
    """
    Parse natural language input into scheduler-ready format.
    
    Returns:
        {
            "scheduler_tasks": [...],   # SchedulerTask objects
            "env_tasks": [...],         # Dict format for DDQN env
            "fixed_events": [...],      # Immovable events (constraints)
            "vibe": float,              # 0.1-0.9 from energy forecast
            "raw_analysis": {...},      # Original Gemini output
        }
    """
    now = datetime.datetime.now()
    
    prompt = f"""Current timestamp (ISO): {now.isoformat()}

You are a task parser for an AI scheduling system. Extract tasks and events from the user's input.

RULES:
1. Extract every task, event, and deadline mentioned.
2. Categorize each into EXACTLY ONE of these categories:
   - "analytical" — studying, coding, writing reports, homework, research, problem-solving, exams
   - "routine" — errands, shopping, cleaning, exercise, gym, commute, admin tasks, emails
   - "creative" — brainstorming, design, planning, leisure activities, social events, hobbies
3. Mark events with specific times as "fixed" (type="fixed", include start/end).
4. Mark tasks that can be scheduled flexibly as "flexible" (type="flexible").
5. Set priority 1-5 (5=most urgent/important) based on:
   - Has a tight deadline today → 4-5
   - Has a deadline but not urgent → 3
   - No deadline, just a task → 1-2
6. Set cognitive_demand 1-5 based on how much mental focus is needed:
   - Deep study, complex coding, writing → 4-5
   - Moderate tasks, presentations → 3
   - Errands, exercise, simple admin → 1-2
7. Duration: estimate if not specified. Use formats like "30m", "1h", "2h", "1h30m".
8. Deadline: use ISO format. If user says "jam 23.59" today, use today's date at 23:59.

ENERGY/MOOD:
9. If the user expresses tiredness, stress, or excitement:
   - Add to energy_forecast with the inferred time
   - Scale: -2=exhausted, -1=tired, 0=normal, 1=good, 2=energized
10. If no mood is mentioned, leave energy_forecast empty.

IMPORTANT:
- Use the EXACT category names: "analytical", "routine", or "creative"
- All times in ISO 8601 format
- Indonesian language input is expected — parse naturally
"""

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=f"{prompt}\n\nUser input: {user_input}",
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=UserAnalysis,
        ),
    )
    
    # Parse Gemini response
    analysis = UserAnalysis.model_validate_json(response.text)
    
    # Convert to scheduler format
    scheduler_tasks = convert_entries_to_scheduler_tasks(analysis.entries, now)
    vibe = energy_forecast_to_vibe(analysis.energy_forecast)
    env_tasks = scheduler_tasks_to_env_format(scheduler_tasks)
    
    # Separate fixed events (constraints for the scheduler)
    fixed_events = [
        {
            "title": t.title,
            "start": t.fixed_start,
            "end": t.fixed_end,
            "task_type": t.task_type,
        }
        for t in scheduler_tasks if t.is_fixed
    ]
    
    return {
        "scheduler_tasks": [t.model_dump() for t in scheduler_tasks],
        "env_tasks": env_tasks,
        "fixed_events": fixed_events,
        "vibe": vibe,
        "raw_analysis": json.loads(response.text),
    }


# ═══════════════════════════════════════════════════════════════
# MAIN — Test with example input
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    user_input = (
        "Aku ada kelas jam 12-13 hari ini, ada presentasi jadi aku harus "
        "belajar dulu. Aku blm pelajari presentasinya samsek lol. "
        "Trus aku harus nge gym jam 15-16. Aku haruss beli baygon juga "
        "hadeuh. Trus ada tugas resum PAA pak rully jam 23.59. Rada sulit sih. "
        "Trus ada lagi dl 23.59 tentang K-means ML."
    )
    
    print("=" * 60)
    print("APUAHRLS — LLM Parser Test")
    print("=" * 60)
    print(f"\nUser: {user_input}\n")
    
    result = parse_user_input(user_input)
    
    print(f"Vibe (from energy forecast): {result['vibe']}")
    
    print(f"\nFixed events (blocked time):")
    for fe in result["fixed_events"]:
        print(f"  {fe['title']}: {fe['start']:.1f}–{fe['end']:.1f} ({fe['task_type']})")
    
    print(f"\nFlexible tasks (for DDQN):")
    print(f"  {'Title':<25} {'Type':<12} {'Dur':>5} {'Imp':>5} {'Cog':>5} {'DL':>8}")
    print(f"  {'─'*25} {'─'*12} {'─'*5} {'─'*5} {'─'*5} {'─'*8}")
    for t in result["env_tasks"]:
        print(f"  {t['title']:<25} {t['task_type']:<12} {t['duration']:>5.1f} "
              f"{t['importance']:>5.2f} {t['cognitive_demand']:>5.2f} {t['deadline']:>8.1f}")
    
    print(f"\n── JSON for DDQN (what gets sent to the model) ──")
    print(json.dumps({
        "env_tasks": result["env_tasks"],
        "fixed_events": result["fixed_events"],
        "vibe": result["vibe"],
    }, indent=2))
