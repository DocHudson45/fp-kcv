import modal
import torch
import torch.nn as nn
import numpy as np
import json
import re
from datetime import datetime
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, Dict, List, Optional

# --- 1. Infrastruktur Modal ---
image = (
    modal.Image.debian_slim()
    .pip_install("torch", "numpy", "pandas", "fastapi[standard]", "pydantic")
    .add_local_file("ddqn_model_final.pth", remote_path="/models/ddqn_model_final.pth")
    .add_local_file("deploy_config.json", remote_path="/models/deploy_config.json")
)

app = modal.App("apuahrls-api", image=image)

# --- 2. Setup FastAPI & CORS ---
web_app = FastAPI()
web_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 3. Skema Frontend JSON ---
class FrontendTask(BaseModel):
    id: Optional[str] = None
    type: str
    title: str
    category: str
    duration: str  
    priority: int  
    cognitive_demand: int 
    start: Optional[str] = None
    deadline: Optional[str] = None

class FrontendRequest(BaseModel):
    user_id: str = "guest"
    current_time_iso: str  
    chronotype: str = "morning"
    current_vibe: float = 0.5
    entries: List[FrontendTask]
    user_history_records: Optional[List[Dict[str, Any]]] = None
    user_profile: Optional[List[float]] = None

    
# --- Helper Functions ---
def parse_duration(dur_str: str) -> float:
    if not dur_str: return 1.0
    h_match = re.search(r'(\d+)h', dur_str)
    m_match = re.search(r'(\d+)m', dur_str)
    hours = float(h_match.group(1)) if h_match else 0.0
    mins = float(m_match.group(1)) if m_match else 0.0
    return hours + (mins / 60.0)

def _parse_iso(s: str) -> datetime:
    """Parse ISO datetime with or without milliseconds."""
    clean = s.split('Z')[0].split('+')[0]
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"):
        try:
            return datetime.strptime(clean, fmt)
        except ValueError:
            continue
    raise ValueError(f"Cannot parse datetime: {s}")

def parse_deadline(dl_str: str, current_time_str: str) -> float:
    if not dl_str: return 24.0
    try:
        # Handle HH:MM format (sent by frontend for flexible task deadlines)
        if re.match(r'^\d{1,2}:\d{2}$', dl_str.strip()):
            h, m = dl_str.strip().split(':')
            curr_dt = _parse_iso(current_time_str)
            dl_hour = int(h) + int(m) / 60.0
            curr_hour = curr_dt.hour + curr_dt.minute / 60.0
            remaining = dl_hour - curr_hour
            return max(remaining, 0.5) if remaining > 0 else 0.5
        # Handle full ISO datetime
        dl_dt = _parse_iso(dl_str)
        curr_dt = _parse_iso(current_time_str)
        return max((dl_dt - curr_dt).total_seconds() / 3600.0, 0.5)
    except:
        return 24.0

CHRONOTYPE_CURVES = {
    "morning": {"blocks":[(5,8,0.50,"routine"),(8,10,0.95,"analytical"),(10,12,0.85,"analytical"),(12,13,0.40,"routine"),(13,15,0.45,"routine"),(15,16,0.50,"routine"),(16,19,0.65,"creative"),(19,22,0.30,"routine")],"wake_range":(5,7)},
    "intermediate": {"blocks":[(7,10,0.50,"routine"),(10,12,0.90,"analytical"),(12,14,0.80,"analytical"),(14,16,0.50,"routine"),(16,17,0.60,"creative"),(17,18,0.55,"routine"),(18,23,0.35,"routine")],"wake_range":(7,8)},
    "evening": {"blocks":[(9,11,0.45,"routine"),(11,13,0.50,"creative"),(13,16,0.55,"routine"),(16,19,0.90,"analytical"),(19,21,0.85,"analytical"),(21,24,0.65,"creative")],"wake_range":(9,10)},
}

def get_effective_energy(ct, h, vibe):
    for s, e, en, bt in CHRONOTYPE_CURVES[ct]["blocks"]:
        if s <= h < e: return float(np.clip(en * (0.5 + 0.5 * vibe), 0.05, 1.0)), bt
    return 0.2, "routine"


def _to_float(v, default=0.0):
    try:
        if v is None:
            return default
        return float(v)
    except:
        return default


def _compute_profile_from_history(records: List[Dict[str, Any]], window_days: int, cold_start_profile: np.ndarray) -> np.ndarray:
    """
    Compute profile features from user history records.
    Expected feature order follows deploy_config.json -> profile_features.
    """
    if not records or len(records) < 7:
        return cold_start_profile.copy()

    # Recent window filtering by `day` if available.
    days = [r.get("day") for r in records if r.get("day") is not None]
    if days:
        try:
            max_day = int(max(days))
            recent = [r for r in records if r.get("day") is not None and int(r.get("day")) >= max_day - int(window_days)]
        except:
            recent = records[-window_days * 8:]
    else:
        recent = records[-window_days * 8:]

    # Scheduled tasks (exclude rows where completion is unknown).
    sched = [r for r in recent if r.get("completed_on_time") is not None]
    if len(sched) < 3:
        return cold_start_profile.copy()

    completed = [_to_float(r.get("completed_on_time"), 0.0) for r in sched]
    completion_rate = float(np.mean(completed))

    # [1] avg_lateness_norm
    late_vals = []
    for r in sched:
        if _to_float(r.get("completed_on_time"), 0.0) == 0.0:
            actual = _to_float(r.get("actual_duration_hours"), np.nan)
            est = _to_float(r.get("duration_hours"), np.nan)
            if not np.isnan(actual) and not np.isnan(est):
                late_vals.append(actual - est)
    avg_lateness_norm = float(np.clip((np.mean(late_vals) / 4.0) if late_vals else 0.0, 0.0, 1.0))

    # [2] chrono_confidence
    day_buckets = {}
    for r in sched:
        d = r.get("day")
        if d is None:
            continue
        day_buckets.setdefault(int(d), []).append(_to_float(r.get("completed_on_time"), 0.0))
    if day_buckets:
        daily_rates = [float(np.mean(v)) for v in day_buckets.values()]
        chrono_confidence = float(1.0 - min(float(np.std(daily_rates)), 0.5) * 2.0)
    else:
        chrono_confidence = 0.65

    # [3] vibe_trend
    vibes = [_to_float(r.get("vibe_after"), np.nan) for r in sched if r.get("vibe_after") is not None]
    vibes = [v for v in vibes if not np.isnan(v)]
    if len(vibes) >= 5:
        x = np.arange(len(vibes), dtype=np.float32)
        slope = float(np.polyfit(x, np.array(vibes, dtype=np.float32), 1)[0])
        vibe_trend = float(np.clip(slope * 10.0, -0.3, 0.3))
    else:
        vibe_trend = 0.0

    # [4] abandon_rate
    abandon_rate = float(np.mean([_to_float(r.get("was_abandoned"), 0.0) for r in recent])) if recent else 0.1

    # [5-7] preference by task_type
    def _pref(ttype):
        subset = [r for r in sched if str(r.get("task_type", "")).lower() == ttype]
        if len(subset) >= 2:
            return float(np.mean([_to_float(r.get("completed_on_time"), 0.0) for r in subset]))
        return completion_rate

    pref_analytical = _pref("analytical")
    pref_routine = _pref("routine")
    pref_creative = _pref("creative")

    # [8] buffer_accept_rate
    buffer_rows = [r for r in recent if bool(r.get("is_buffer"))]
    accepted = [_to_float(r.get("user_accepted_buffer"), np.nan) for r in buffer_rows if r.get("user_accepted_buffer") is not None]
    accepted = [x for x in accepted if not np.isnan(x)]
    buffer_accept_rate = float(np.mean(accepted)) if accepted else 0.5

    # [9] duration_ratio
    ratios = []
    for r in sched:
        actual = _to_float(r.get("actual_duration_hours"), np.nan)
        est = _to_float(r.get("duration_hours"), np.nan)
        if not np.isnan(actual) and not np.isnan(est) and actual > 0 and est > 0:
            ratios.append(actual / est)
    duration_ratio = float(np.median(ratios)) if len(ratios) >= 3 else 1.0

    profile = np.array([
        completion_rate,
        avg_lateness_norm,
        chrono_confidence,
        vibe_trend,
        abandon_rate,
        pref_analytical,
        pref_routine,
        pref_creative,
        buffer_accept_rate,
        duration_ratio,
    ], dtype=np.float32)
    return profile

# --- 4. Kelas Model PyTorch ---
class QNet(nn.Module):
    def __init__(self, sd, na, h=128):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(sd,h),nn.ReLU(),nn.Linear(h,h),nn.ReLU(),nn.Linear(h,na))
    def forward(self, x): return self.net(x)

# --- 5. Kelas API Modal ---
@app.cls(cpu=1.0, memory=2048)
class SchedulerAPI:
    @modal.enter()
    def load(self):
        print("Memuat model...")
        with open("/models/deploy_config.json", "r") as f: 
            self.cfg = json.load(f)
        
        checkpoint = torch.load("/models/ddqn_model_final.pth", map_location="cpu", weights_only=False)
        self.qn = QNet(self.cfg["state_dim"], self.cfg["n_actions"], checkpoint.get("hidden", 128))
        self.qn.load_state_dict(checkpoint["q_net_state_dict"])
        self.qn.eval()
        self.m, self.s = checkpoint["norm_mean"], checkpoint["norm_std"]
        self.cold_start_profile = np.array(self.cfg["cold_start_profile"], dtype=np.float32)

    @modal.asgi_app()
    def api(self):
        web_app.add_api_route("/prioritize", self.predict, methods=["POST"])
        return web_app

    def predict(self, req: FrontendRequest):
        try:
            try:
                curr_dt = _parse_iso(req.current_time_iso)
                curr_hour = curr_dt.hour + (curr_dt.minute / 60.0)
            except:
                curr_hour = 12.0 
            
            feats = []
            flex_tasks = [t for t in req.entries if t.type == "flexible"]
            
            for t in flex_tasks[:self.cfg["max_tasks"]]:
                rem = parse_duration(t.duration)
                ttd = parse_deadline(t.deadline, req.current_time_iso)
                imp = t.priority / 5.0
                cog = t.cognitive_demand / 5.0
                ef, bt = get_effective_energy(req.chronotype, curr_hour, req.current_vibe)
                tm = 1.0 if t.category == bt else 0.0
                feats.append([ttd, rem, imp, ttd - rem, cog, ef, tm])

            while len(feats) < self.cfg["max_tasks"]:
                feats.append([0.0] * 7)
                
            flat = np.array(feats[:self.cfg["max_tasks"]], dtype=np.float32).flatten()

            # Optional personalization from frontend payload.
            profile = self.cold_start_profile
            if req.user_profile and len(req.user_profile) == self.cfg.get("profile_dim", 10):
                profile = np.array(req.user_profile, dtype=np.float32)
            elif req.user_history_records:
                profile = _compute_profile_from_history(
                    req.user_history_records,
                    int(self.cfg.get("profile_window_days", 14)),
                    self.cold_start_profile,
                )

            day_progress = float(np.clip(curr_hour / 24.0, 0.0, 1.0))
            buffer_count = float(np.clip(sum(1 for t in req.entries if t.type == "fixed") / 5.0, 0.0, 1.0))
            gl = np.array([
                req.current_vibe,
                np.sin(2*np.pi*curr_hour/24.0),
                np.cos(2*np.pi*curr_hour/24.0),
                day_progress,
                buffer_count,
            ], dtype=np.float32)

            state = np.concatenate([flat, gl, profile])
            
            norm_state = (state - self.m) / self.s
            with torch.no_grad(): 
                q = self.qn(torch.FloatTensor(norm_state)).numpy()
                
            available_actions = list(range(len(flex_tasks)))
            if not available_actions:
                return {"status": "success", "message": "Tidak ada tugas flexible."}
                
            masked_q = np.full(self.cfg["n_actions"], -np.inf)
            for a in available_actions:
                masked_q[a] = q[a]
                
            best = int(np.argmax(masked_q))
            
            return {
                "status": "success",
                "recommended_task_id": flex_tasks[best].id or flex_tasks[best].title,
                "recommended_task_title": flex_tasks[best].title,
                "recommended_task_index": best,
            }
        except Exception as e:
            return {"status": "error", "message": str(e)}