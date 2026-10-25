// Статистика репетицій.

import { db } from './db.js';

export const DEFAULT_WPM = 130;

// Середній темп за останніми 10 репетиціями (для оцінки часу читання).
export async function averageWpm() {
  try {
    const recent = (await db.all('rehearsals'))
      .filter(r => r.wpm > 0)
      .sort((a, b) => b.date - a.date)
      .slice(0, 10);
    if (!recent.length) return DEFAULT_WPM;
    return Math.round(recent.reduce((sum, r) => sum + r.wpm, 0) / recent.length);
  } catch {
    return DEFAULT_WPM;
  }
}
