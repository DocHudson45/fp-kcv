#!/bin/bash

# API URL from .env.local
API_URL="https://discordhoma--apuahrls-scheduler-api-schedulerapi-api.modal.run/prioritize"

# Two test tasks
TASK1='{
  "id": "analytical_task",
  "duration": 1.5,
  "deadline": 23.98,
  "importance": 0.8,
  "cognitive_demand": 0.9,
  "task_type": "analytical",
  "partial_done": 0.0
}'

TASK2='{
  "id": "routine_task",
  "duration": 0.5,
  "deadline": 23.98,
  "importance": 0.4,
  "cognitive_demand": 0.2,
  "task_type": "routine",
  "partial_done": 0.0
}'

CHRONOTYPES=("morning" "intermediate" "evening")

echo "Starting APUAHRLS Chronotype Comparison Test (Two Tasks)..."
echo "API URL: $API_URL"
echo "Current Hour: 9.0 (9:00 AM)"
echo "Tasks: [1] Analytical (1.5h, demand 0.9) vs [2] Routine (0.5h, demand 0.2)"
echo "--------------------------------------------------"

for CT in "${CHRONOTYPES[@]}"; do
  echo "Testing Chronotype: $CT"
  
  PAYLOAD=$(cat <<EOF
{
  "user_id": "test_user_curl",
  "current_hour": 9.0,
  "current_day": 0,
  "chronotype": "$CT",
  "current_vibe": 0.7,
  "tasks_today": [$TASK1, $TASK2],
  "user_history_records": []
}
EOF
)

  # Use timeout to prevent hanging in restricted environments
  RESPONSE=$(timeout 30s curl -s -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")

  if [ $? -eq 124 ]; then
    echo "Error: API Request timed out after 30 seconds."
  else
    echo "Response for $CT:"
    echo "$RESPONSE" | python3 -m json.tool || echo "$RESPONSE"
  fi
  echo "--------------------------------------------------"
done

echo "Test completed."
