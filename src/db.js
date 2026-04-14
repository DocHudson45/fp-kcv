/**
 * db.js
 * Abstraction layer over localStorage to act as a structured database for APUAHRLS.
 * Handles the 5-day episode logic and buffer mechanism.
 */

const DB_KEY = "apuahrls_db_v4";

const defaultState = {
  user: {
    hasOnboarded: false,
    chronotype: "morning",
    current_day: 0, // 0 to 4 (5-day episode)
    buffer_accept_rate: 1.0, // Used by DDQN
  },
  activeTasks: [],
  fixedEvents: [],
  historyRecords: [],
  bufferPool: [], // Tasks rolled over from the previous day
  scheduleGrid: {
    0: [], 1: [], 2: [], 3: [], 4: [] // Saved schedule arrays per day
  }
};

class Database {
  constructor() {
    this.data = this.load();
  }

  load() {
    try {
      const stored = localStorage.getItem(DB_KEY);
      if (stored) return { ...defaultState, ...JSON.parse(stored) };
    } catch(e) {}
    return JSON.parse(JSON.stringify(defaultState));
  }

  save() {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(this.data));
    } catch(e) {}
  }

  // --- GETTERS ---
  getUser() { return this.data.user; }
  getActiveTasks() { return this.data.activeTasks; }
  getFixedEvents() { return this.data.fixedEvents; }
  getHistory() { return this.data.historyRecords; }
  getBufferPool() { return this.data.bufferPool; }
  getScheduleForDay(day) { return this.data.scheduleGrid[day] || []; }
  getFullScheduleGrid() { return this.data.scheduleGrid; }

  // --- SETTERS ---
  updateUser(updates) {
    this.data.user = { ...this.data.user, ...updates };
    this.save();
  }

  setActiveTasks(tasks) {
    this.data.activeTasks = tasks;
    this.save();
  }

  setFixedEvents(events) {
    this.data.fixedEvents = events;
    this.save();
  }

  addHistoryRecord(record) {
    this.data.historyRecords.push(record);
    this.save();
  }

  setBufferPool(tasks) {
    this.data.bufferPool = tasks;
    this.save();
  }
  
  setScheduleForDay(day, scheduleList) {
    this.data.scheduleGrid[day] = scheduleList;
    this.save();
  }

  // --- DAY TRANSITION LOGIC (MULTI-DAY ROLLOVER) ---
  advanceDay() {
    const { user, activeTasks, scheduleGrid } = this.data;
    
    // Check which tasks were unfinished today
    const currentDay = user.current_day;
    const scheduleToday = scheduleGrid[currentDay] || [];
    
    // If a task exists in activeTasks and wasn't finished today, it rolls into the buffer
    // For simplicity, we just roll all activeTasks (that aren't fixed) into the buffer
    // because any finished tasks should already be archived/deleted from activeTasks.
    const flexibleTasks = activeTasks.filter(t => !t.is_fixed);
    
    this.data.bufferPool = [...this.data.bufferPool, ...flexibleTasks];
    
    // Clear them from activeTasks for the new day
    this.data.activeTasks = activeTasks.filter(t => t.is_fixed); 
    
    // Move to next day (cap at 4 for 5-day episode, or loop around if desired)
    let nextDay = currentDay + 1;
    if (nextDay > 4) {
      // End of episode -> Reset or keep accumulating?
      // For now, reset episode to Day 0
      nextDay = 0;
      this.data.scheduleGrid = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    }
    
    this.data.user.current_day = nextDay;
    this.save();
    return nextDay;
  }
}

export const db = new Database();
