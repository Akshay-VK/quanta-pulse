import { describe, expect, it } from 'vitest';
import { agendaEntries, dueSoon, resolveTimezone } from '../src/lib/agenda';
import { resource } from './helpers/data';
import type { DueResource } from '../src/lib/types';
const due = (dueAt: string, id = 1, dateKind: 'date' | 'instant' = 'instant'): DueResource => ({ resource: resource({ id, externalResourceId: `r${id}`, dueAt }), dateKind, coursePaused: false });
describe('controlled agenda selectors', () => {
  it('resolves invalid configured zones through OS then UTC', () => {
    expect(resolveTimezone('bad', 'Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(resolveTimezone('bad', 'bad')).toBe('UTC');
  });
  it('keeps date-only sources without a fabricated time and omits invalid values', () => {
    const entries = agendaEntries([due('2026-11-15', 1, 'date'), due('2026-02-30', 2, 'date'), due('bad', 3)], new Date('2026-11-14T23:00:00Z'), 'America/New_York');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ group: 'Tomorrow', label: '15 Nov 2026' });
  });
  it('handles both instants in the repeated DST hour and local midnight', () => {
    const entries = agendaEntries([due('2026-11-01T05:30:00Z'), due('2026-11-01T06:30:00Z', 2)], new Date('2026-11-01T04:00:00Z'), 'America/New_York');
    expect(entries.map(e => e.group)).toEqual(['Today', 'Today']);
    expect(entries[0].label).toContain('01:30');
    expect(entries[0].label).not.toBe(entries[1].label);
    expect(agendaEntries([due('2026-11-02T04:59:00Z')], new Date('2026-11-02T05:00:00Z'), 'America/New_York')[0].group).toBe('Past due dates');
  });
  it('uses Monday-first weeks across year boundaries and preserves unrelated same titles', () => {
    const now = new Date('2026-12-30T00:00:00Z');
    expect(agendaEntries([due('2027-01-01', 1, 'date'), due('2027-01-04', 2, 'date'), due('2027-01-01', 3, 'date')], now, 'UTC').map(e => e.group)).toEqual(['This week', 'This week', 'Later']);
  });
  it('deduplicates canonical identities and limits due soon to five in seven local days', () => {
    const items = Array.from({ length: 9 }, (_, i) => due(`2026-11-${15 + i}`, i + 1, 'date'));
    expect(dueSoon([...items, items[0]], new Date('2026-11-14T00:00:00Z'), 'UTC')).toHaveLength(5);
    expect(agendaEntries([items[0], items[0]], new Date(), 'UTC')).toHaveLength(1);
  });
});
