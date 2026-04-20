/**
 * db.js
 * Abstraction layer over localStorage to act as a structured database for APUAHRLS.
 * Handles the 5-day episode logic, buffer mechanism, and per-date schedule storage.
 */

const DB_KEY = "apuahrls_db_v4";

const defaultState = {
  user: {
    hasOnboarded: false,
    chronotype: "morning",
    current_day: 0, // 0 to 4 (5-day episode)
    buffer_accept_rate: 1.0, // Used by DDQN
    lastActiveDate: null, // ISO date string "2026-04-19" for day-change detection
  },
  activeTasks: [],
  fixedEvents: [],
  historyRecords: [],
  bufferPool: [], // Tasks rolled over from the previous day
  scheduleByDate: {}, // { "2026-04-19": [...schedule items] }
  fixedEventsByDate: {}, // { "2026-04-19": [...fixed events] }
  scheduleGrid: {
    0: [], 1: [], 2: [], 3: [], 4: [] // Legacy: Saved schedule arrays per day
  }
};

class Database {
  constructor() {
    this.data = this.load();
  }

  load() {
    try {
      const stored = localStorage.getItem(DB_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          ...defaultState,
          ...parsed,
          // Deep merge user to pick up new fields like lastActiveDate
          user: { ...defaultState.user, ...(parsed.user || {}) },
          // Ensure new objects exist even if not in stored data
          scheduleByDate: parsed.scheduleByDate || {},
          fixedEventsByDate: parsed.fixedEventsByDate || {},
        };
      }
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

  // Date-based schedule access (for week view history)
  getScheduleByDate(dateStr) {
    return (this.data.scheduleByDate && this.data.scheduleByDate[dateStr]) || [];
  }
  getFixedEventsByDate(dateStr) {
    return (this.data.fixedEventsByDate && this.data.fixedEventsByDate[dateStr]) || [];
  }

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

  // Date-based setters (for per-day history)
  setScheduleByDate(dateStr, schedule) {
    if (!this.data.scheduleByDate) this.data.scheduleByDate = {};
    this.data.scheduleByDate[dateStr] = schedule;
    this.save();
  }

  setFixedEventsByDate(dateStr, events) {
    if (!this.data.fixedEventsByDate) this.data.fixedEventsByDate = {};
    this.data.fixedEventsByDate[dateStr] = events;
    this.save();
  }

  // Prune old date entries (keep last 14 days)
  pruneOldDates() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    for (const key of Object.keys(this.data.scheduleByDate || {})) {
      if (key < cutoffStr) delete this.data.scheduleByDate[key];
    }
    for (const key of Object.keys(this.data.fixedEventsByDate || {})) {
      if (key < cutoffStr) delete this.data.fixedEventsByDate[key];
    }
    this.save();
  }

  // --- DAY TRANSITION LOGIC (MULTI-DAY ROLLOVER) ---
  advanceDay(todayStr) {
    const { user, activeTasks } = this.data;
    
    // Roll unfinished flexible tasks into the buffer pool
    const flexibleTasks = activeTasks.filter(t => !t.is_fixed && !t.is_archived);
    
    const bufferedTasks = flexibleTasks.map(t => ({
      ...t,
      is_buffer: true,
      buffered_from_date: user.lastActiveDate,
      // Reduce priority slightly for rolled-over tasks (RL signal)
      priority: Math.max(1, (t.priority || 3) - 1),
    }));
    
    this.data.bufferPool = [
      ...this.data.bufferPool.filter(b => !b.is_archived),
      ...bufferedTasks,
    ];
    
    // Clear active tasks for fresh day (buffer pool tasks can be re-accepted)
    this.data.activeTasks = [];
    
    // Move to next day (cap at 4 for 5-day episode, loop around)
    let nextDay = user.current_day + 1;
    if (nextDay > 4) {
      nextDay = 0;
      this.data.scheduleGrid = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    }
    
    this.data.user.current_day = nextDay;
    this.data.user.lastActiveDate = todayStr;
    
    this.pruneOldDates();
    this.save();
    return nextDay;
  }
}

export const db = new Database();
