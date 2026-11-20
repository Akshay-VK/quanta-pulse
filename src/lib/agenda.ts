import type { DueResource } from './types';

/** All grouping is controlled by the caller's clock and resolved IANA zone. */
export function resolveTimezone(configured?: string, os = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  for (const zone of [configured, os, 'UTC']) {
    if (!zone) continue;
    try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(0); return zone; } catch { /* try fallback */ }
  }
  return 'UTC';
}
export function localDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function ordinal(key: string): number { return Date.parse(`${key}T00:00:00Z`) / 86400000; }
function validDate(key: string): boolean {
  const time = Date.parse(`${key}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === key;
}
export type AgendaGroup = 'Past due dates' | 'Today' | 'Tomorrow' | 'This week' | 'Later';
export interface AgendaEntry { item: DueResource; day: string; group: AgendaGroup; label: string; sort: number }
export const AGENDA_GROUPS: AgendaGroup[] = ['Today', 'Tomorrow', 'This week', 'Later', 'Past due dates'];
export function agendaEntries(items: DueResource[], now: Date, timeZone: string): AgendaEntry[] {
  const today = localDateKey(now, timeZone);
  const dayNumber = ordinal(today);
  const seen = new Set<string>();
  return items.flatMap(item => {
    const raw = item.resource.dueAt;
    if (!raw) return [];
    const dateOnly = item.dateKind === 'date';
    const timestamp = Date.parse(raw);
    if (dateOnly ? !validDate(raw) : !Number.isFinite(timestamp)) return [];
    const day = dateOnly ? raw : localDateKey(new Date(timestamp), timeZone);
    const delta = ordinal(day) - dayNumber;
    const past = dateOnly ? delta < 0 : timestamp < now.getTime();
    const group: AgendaGroup = past ? 'Past due dates' : delta === 0 ? 'Today' : delta === 1 ? 'Tomorrow' : delta < 7 ? 'This week' : 'Later';
    const identity = item.resource.externalResourceId;
    if (seen.has(identity)) return [];
    seen.add(identity);
    const exactDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${day}T12:00:00Z`));
    const time = dateOnly ? '' : `, ${new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(timestamp))}`;
    return [{ item, day, group, label: `${exactDate}${time}`, sort: dateOnly ? ordinal(day) * 86400000 : timestamp }];
  }).sort((a, b) => a.day.localeCompare(b.day) || a.sort - b.sort || (a.item.resource.courseName ?? '').localeCompare(b.item.resource.courseName ?? '') || a.item.resource.title.localeCompare(b.item.resource.title) || a.item.resource.externalResourceId.localeCompare(b.item.resource.externalResourceId));
}
export function dueSoon(items: DueResource[], now: Date, timeZone: string): AgendaEntry[] {
  const today = ordinal(localDateKey(now, timeZone));
  return agendaEntries(items, now, timeZone).filter(entry => entry.group !== 'Past due dates' && ordinal(entry.day) - today < 7).slice(0, 5);
}
