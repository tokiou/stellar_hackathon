import type { HistoryEntry } from './types';

const STORAGE_KEY = 'intent-wallet-copilot-history';
const MAX_ENTRIES = 50;

/** Load history from localStorage */
export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as HistoryEntry[];
  } catch {
    return [];
  }
}

/** Save a new entry to history */
export function saveHistoryEntry(entry: HistoryEntry): void {
  const history = loadHistory();
  history.unshift(entry);
  // Keep only the most recent entries
  const trimmed = history.slice(0, MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

/** Update an existing entry by ID */
export function updateHistoryEntry(id: string, updates: Partial<HistoryEntry>): void {
  const history = loadHistory();
  const index = history.findIndex(e => e.id === id);
  if (index !== -1) {
    history[index] = { ...history[index], ...updates };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  }
}

/** Clear all history */
export function clearHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Generate a unique ID */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}