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
from typing import List, Optional

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

    
# --- Helper Functions ---
def parse_duration(dur_str: str) -> float:
    if not dur_str: return 1.0
    h_match = re.search(r'(\d+)h', dur_str)
    m_match = re.search(r'(\d+)m', dur_str)
    hours = float(h_match.group(1)) if h_match else 0.0
    mins = float(m_match.group(1)) if m_match else 0.0
    return hours + (mins / 60.0)

def parse_deadline(dl_str: str, current_time_str: str) -> float:
    if not dl_str: return 24.0
    try:
        fmt = "%Y-%m-%dT%H:%M:%S"
        dl_dt = datetime.strptime(dl_str.split('Z')[0], fmt)
        curr_dt = datetime.strptime(current_time_str.split('Z')[0], fmt)
        return max((dl_dt - curr_dt).total_seconds() / 3600.0, 1.0)
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
                curr_dt = datetime.strptime(req.current_time_iso.split('Z')[0], "%Y-%m-%dT%H:%M:%S")
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
            gl = np.array([req.current_vibe, np.sin(2*np.pi*curr_hour/24.0), np.cos(2*np.pi*curr_hour/24.0), 0.0, 0.0], dtype=np.float32)
            state = np.concatenate([flat, gl, self.cold_start_profile])
            
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