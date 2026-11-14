import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appApi, button, change, click, deferred, emitAppEvent, renderApp, resource, setupApp } from './helpers/renderApp';
import type { InboxPage } from '../src/lib/types';
const page = (id = 10, unread = true): InboxPage => ({ items: [{ key: 'resource:1', resourceId: 1, courseId: 1, latestEvent: change({ id }), eventIds: [id, id + 1], changeTypes: ['new', 'updated'], unread }], total: 120, unreadTotal: 80, courseCounts: [{ courseId: 1, total: 120, unreadTotal: 80 }] });
let app: Awaited<ReturnType<typeof renderApp>>;
beforeEach(() => { setupApp(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-14T12:00:00Z')); appApi.queryInbox.mockResolvedValue(page()); appApi.queryDueResources.mockResolvedValue({ items: [], total: 0 }); });
afterEach(() => { app?.unmount(); vi.useRealTimers(); });
describe('complete attention workflows through App', () => {
  it('uses complete grouped badges and explicit desired read state without acknowledging inspection', async () => {
    app = await renderApp();
    expect(document.querySelector('.nav-item')?.textContent).toContain('80');
    await click(button('Show details for Lecture 4'));
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
    await click(button('Mark item read'));
    expect(appApi.setEventReadState).toHaveBeenCalledWith([10, 11], true);
    appApi.queryInbox.mockResolvedValue(page(10, false));
    await emitAppEvent('sync:done', {});
    await click(button('Mark item unread'));
    expect(appApi.setEventReadState).toHaveBeenLastCalledWith([10, 11], false);
  });
  it('captures all matching IDs before confirming and ignores later arrivals', async () => {
    appApi.snapshotInboxEventIds.mockResolvedValue([10, 11, 999]);
    app = await renderApp();
    await click(button('Mark all Inbox items read'));
    expect(appApi.snapshotInboxEventIds).toHaveBeenCalledWith({});
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
    appApi.queryInbox.mockResolvedValue(page(50));
    await emitAppEvent('sync:done', {});
    await click(button('Mark captured items read'));
    expect(appApi.setEventReadState).toHaveBeenCalledTimes(1);
    expect(appApi.setEventReadState).toHaveBeenCalledWith([10, 11, 999], true);
  });
  it('retains rows on refresh failure and retries from page zero', async () => {
    app = await renderApp();
    await click(button('Load more Inbox items'));
    expect(appApi.queryInbox).toHaveBeenCalledWith(expect.objectContaining({ offset: 1 }));
    appApi.queryInbox.mockRejectedValue(new Error('Offline'));
    await emitAppEvent('sync:done', {});
    expect(button('Show details for Lecture 4')).toBeTruthy();
    expect(document.querySelector('main')?.textContent).toContain('Showing saved results');
    expect(appApi.queryInbox.mock.calls.slice(-2)).toContainEqual([expect.objectContaining({ offset: 0 })]);
  });
  it('distinguishes stale badge counts from successfully refreshed Inbox rows', async () => {
    app = await renderApp();
    const fresh = page(20);
    fresh.items[0].latestEvent.resourceTitle = 'Fresh lecture';
    appApi.queryInbox.mockImplementation(async filter => {
      if (filter?.limit) return fresh;
      throw new Error('Counts offline');
    });
    await emitAppEvent('sync:done', {});
    expect(button('Show details for Fresh lecture')).toBeTruthy();
    expect(document.querySelector('main')?.textContent).toContain('Unread counts could not refresh');
    expect(document.querySelector('main')?.textContent).not.toContain('Showing saved results');
    expect(document.querySelector('main')?.textContent).not.toContain('Inbox could not refresh');
    expect(button('Inbox').textContent).toContain('80');
    appApi.queryInbox.mockResolvedValue({ ...fresh, unreadTotal: 12 });
    await click(button('Retry counts'));
    expect(document.querySelector('main')?.textContent).not.toContain('Unread counts could not refresh');
    expect(button('Inbox').textContent).toContain('12');
  });
  it('distinguishes a failed Inbox refresh from successfully refreshed badge counts', async () => {
    app = await renderApp();
    appApi.queryInbox.mockImplementation(async filter => {
      if (filter?.limit) throw new Error('Rows offline');
      return { ...page(), unreadTotal: 12 };
    });
    await emitAppEvent('sync:done', {});
    expect(button('Show details for Lecture 4')).toBeTruthy();
    expect(document.querySelector('main')?.textContent).toContain('Showing saved results');
    expect(document.querySelector('main')?.textContent).not.toContain('Unread counts could not refresh');
    expect(button('Inbox').textContent).toContain('12');
  });
  it('rejects a late page when a newer filter has become authoritative', async () => {
    app = await renderApp();
    const old = deferred<InboxPage>();
    appApi.queryInbox.mockImplementation(async (filter) => filter?.offset ? old.promise : { ...page(60), items: [] });
    await click(button('Load more Inbox items'));
    await click(button('Unread'));
    await act(async () => { old.resolve(page(20)); });
    expect(document.querySelector('main')?.textContent).not.toContain('Lecture 4');
  });
  it('loads baseline deadlines independently and preserves date-only source and warnings', async () => {
    appApi.queryInbox.mockResolvedValue({ items: [], total: 0, unreadTotal: 0, courseCounts: [] });
    appApi.queryDueResources.mockResolvedValue({ items: [{ resource: resource({ dueAt: '2026-11-15', availabilityStatus: 'unavailable' }), dateKind: 'date', coursePaused: false }], total: 1 });
    app = await renderApp();
    await click(button('Calendar'));
    expect(document.querySelector('main')?.textContent).toContain('Agenda');
    expect(document.querySelector('main')?.textContent).toContain('15 Nov 2026');
    expect(document.querySelector('main')?.textContent).toContain('Source unavailable');
    await click(button('Show details for Lecture 4'));
    expect(document.querySelector('.peek')?.textContent).toContain('2026-11-15');
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
  });
});

describe('snapshot mutation and retained inventory protections', () => {
  it('stops a failed snapshot, and blocks duplicate activation while capturing', async () => {
    const pending = deferred<number[]>();
    appApi.snapshotInboxEventIds.mockReturnValue(pending.promise);
    app = await renderApp();
    await act(async () => { button('Mark all Inbox items read').click(); button('Mark all Inbox items read').click(); });
    expect(appApi.snapshotInboxEventIds).toHaveBeenCalledTimes(1);
    await act(async () => { pending.reject(new Error('Cannot snapshot')); });
    expect(document.querySelector('main')?.textContent).toContain('Could not capture Inbox scope');
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
  it('retains failed read operations visibly and never claims success', async () => {
    appApi.setEventReadState.mockRejectedValue(new Error('Disk full'));
    app = await renderApp();
    await click(button('Mark item read'));
    expect(button('Mark item read')).toBeTruthy();
    expect(document.querySelector('main')?.textContent).toContain('Disk full');
    expect(document.querySelector('.row-unread')).toBeTruthy();
  });
  it('dismisses captured changes independently from History; incoming resource changes reappear', async () => {
    appApi.snapshotInboxEventIds.mockResolvedValue([10, 11]);
    appApi.dismissInboxEvents.mockImplementation(async () => { appApi.queryInbox.mockResolvedValue({ items: [], total: 0, unreadTotal: 0, courseCounts: [] }); });
    app = await renderApp();
    await click(button('Dismiss all Inbox items…'));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('History and saved files remain');
    await click(button('Dismiss captured items'));
    expect(appApi.dismissInboxEvents).toHaveBeenCalledWith([10, 11]);
    expect(appApi.deleteHistory).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.resource-row')).toHaveLength(0);
    appApi.queryInbox.mockResolvedValue(page(90));
    await emitAppEvent('sync:done', {});
    expect(button('Show details for Lecture 4')).toBeTruthy();
    await click(button('History'));
    expect(button('Show details for Lecture 4')).toBeTruthy();
  });
  it('inspects orphan changes without inventing a resource or local actions', async () => {
    appApi.queryInbox.mockResolvedValue({ ...page(), items: [{ ...page().items[0], key: 'event:10', resourceId: null, latestEvent: change({ resourceId: null, resourceTitle: null, title: 'Removed notice', resourceUrl: null }), eventIds: [10] }] });
    app = await renderApp();
    await click(button('Show details for Removed notice'));
    expect(document.querySelector('.peek-title')?.textContent).toBe('Removed notice');
    expect(document.querySelector('.peek')?.textContent).not.toContain('Download now');
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
  });
  it('keeps global badges unfiltered while the bulk snapshot uses active attention', async () => {
    appApi.queryInbox.mockImplementation(async filter => filter?.attention ? { ...page(), items: [], total: 0, unreadTotal: 0 } : page());
    app = await renderApp();
    await click(button('Unread'));
    expect(document.querySelector('.nav-badge')?.textContent).toBe('80');
    expect(document.querySelector('main')?.textContent).toContain('No unread changes');
    expect(appApi.queryInbox).toHaveBeenCalledWith({ attention: 'unread', offset: 0, limit: 50 });
  });
  it('reads every due inventory page, including baseline resources beyond the first thousand', async () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({ resource: resource({ id: i + 1, externalResourceId: `due:${i}`, title: `Baseline ${i}`, dueAt: '2027-01-01' }), dateKind: 'date' as const, coursePaused: false }));
    appApi.queryDueResources.mockImplementation(async filter => ({ items: filter?.offset ? [{ ...items[0], resource: resource({ id: 2001, externalResourceId: 'last', title: 'Final baseline assignment', dueAt: '2027-01-02' }) }] : items, total: 1001 }));
    app = await renderApp();
    await click(button('Calendar'));
    expect(document.querySelector('main')?.textContent).toContain('1001 dated resources');
    expect(appApi.queryDueResources).toHaveBeenCalledWith({ offset: 1000, limit: 1000 });
  });
  it('refreshes changed due dates in the shared selection and retains them after failure', async () => {
    const item = { resource: resource({ dueAt: '2026-11-15' }), dateKind: 'date' as const, coursePaused: false };
    appApi.queryDueResources.mockResolvedValue({ items: [item], total: 1 });
    app = await renderApp();
    await click(button('Calendar'));
    await click(button('Show details for Lecture 4'));
    appApi.queryDueResources.mockResolvedValue({ items: [{ ...item, resource: resource({ dueAt: '2026-11-16' }) }], total: 1 });
    await emitAppEvent('sync:done', {});
    expect(document.querySelector('.peek')?.textContent).toContain('2026-11-16');
    appApi.queryDueResources.mockRejectedValue(new Error('Offline'));
    await emitAppEvent('sync:done', {});
    expect(document.querySelector('main')?.textContent).toContain('Showing saved dates');
    expect(document.querySelector('.peek')?.textContent).toContain('2026-11-16');
  });
});

describe('filter scope and due request authority', () => {
  it('captures course, announcement and search together across unloaded results', async () => {
    appApi.snapshotInboxEventIds.mockResolvedValue([10, 9999]);
    app = await renderApp();
    await click(document.querySelector<HTMLElement>('[aria-label="Filter by change type"]')!);
    await click([...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent === 'Announcements')!);
    await click(document.querySelector<HTMLElement>('[aria-label="Filter by course"]')!);
    await click([...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent !== 'All courses')!);
    const search = document.querySelector<HTMLInputElement>('[aria-label="Search Inbox"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'tutorial'); search.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
    await click(button('Mark filtered results read'));
    expect(appApi.snapshotInboxEventIds).toHaveBeenCalledWith({ courseId: 1, changeType: 'announcement', search: 'tutorial' });
    await click(button('Mark captured items read'));
    expect(appApi.setEventReadState).toHaveBeenCalledWith([10, 9999], true);
  });
  it('guards old due responses when explicitly opening a paused course', async () => {
    appApi.listCourses.mockResolvedValue([{ id: 2, externalCourseId: 'paused', name: 'Paused Physics', shortName: 'Physics', url: '', firstSeenAt: '', lastScannedAt: null, lastScanStatus: null, monitoringStatus: 'paused', resourceCount: 1 }]);
    app = await renderApp();
    await click(button('Calendar'));
    const old = deferred<{ items: []; total: number }>();
    appApi.queryDueResources.mockImplementation(async filter => filter?.courseId ? { items: [{ resource: resource({ id: 2, externalResourceId: 'paused', courseId: 2, title: 'Paused assignment', dueAt: '2027-01-01' }), dateKind: 'date', coursePaused: true }], total: 1 } : old.promise);
    await emitAppEvent('sync:done', {});
    await click(document.querySelector<HTMLElement>('[aria-label="Agenda course"]')!);
    await click([...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent?.includes('(paused)'))!);
    expect(button('Show details for Paused assignment')).toBeTruthy();
    await act(async () => { old.resolve({ items: [], total: 0 }); });
    expect(button('Show details for Paused assignment')).toBeTruthy();
    expect(appApi.queryDueResources).toHaveBeenCalledWith({ courseId: 2, offset: 0, limit: 1000 });
  });
  it('distinguishes initial agenda failure from a successful empty inventory', async () => {
    appApi.queryDueResources.mockRejectedValue(new Error('Unavailable inventory'));
    app = await renderApp();
    await click(button('Calendar'));
    expect(document.querySelector('main')?.textContent).toContain('Could not load Agenda');
    expect(document.querySelector('main')?.textContent).not.toContain('No due dates recorded');
    appApi.queryDueResources.mockResolvedValue({ items: [], total: 0 });
    await click(button('Retry Agenda'));
    expect(document.querySelector('main')?.textContent).toContain('No due dates recorded');
  });
  it('uses Inbox for both legacy routes and distinguishes a successful no-course state', async () => {
    appApi.listCourses.mockResolvedValue([]);
    appApi.queryInbox.mockResolvedValue({ items: [], total: 0, unreadTotal: 0, courseCounts: [] });
    app = await renderApp();
    expect(document.querySelector('main')?.textContent).toContain('No courses yet');
    await click(button('History'));
    await emitAppEvent('ui:navigate', 'dashboard');
    expect(document.querySelector('main h1')?.textContent).toBe('Inbox');
    await emitAppEvent('ui:navigate', 'today');
    expect(document.querySelector('main h1')?.textContent).toBe('Inbox');
  });
});

describe('permanent History scope', () => {
  it('names the complete deletion and retains a failed confirmation for retry', async () => {
    appApi.deleteHistory.mockRejectedValueOnce(new Error('Locked database'));
    app = await renderApp();
    await click(button('History'));
    const actions = button('History actions');
    await act(async () => { actions.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); });
    await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent?.includes('Delete recorded history'))!);
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('including dismissed Inbox changes');
    await click(button('Delete changes and scans'));
    expect(appApi.deleteHistory).toHaveBeenCalledWith(true);
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Locked database');
    await click(button('Delete changes and scans'));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(appApi.deleteHistory).toHaveBeenCalledTimes(2);
    expect(appApi.clearHistoryActivity).not.toHaveBeenCalled();
  });
});

describe('complete inspector enrichment', () => {
  it('does not mistake a surviving resource beyond the old default page for an orphan', async () => {
    const first = Array.from({ length: 2000 }, (_, i) => resource({ id: i + 1, externalResourceId: `resource:${i}` }));
    const last = resource({ id: 2001, externalResourceId: 'last', title: 'Beyond the default cap' });
    appApi.listResources.mockImplementation(async filter => filter?.offset ? [last] : first);
    appApi.queryInbox.mockResolvedValue({ ...page(), items: [{ ...page().items[0], key: 'resource:2001', resourceId: 2001, latestEvent: change({ resourceId: 2001, resourceTitle: last.title }) }] });
    app = await renderApp();
    await click(button('Show details for Beyond the default cap'));
    expect(appApi.listResources).toHaveBeenCalledWith({ offset: 2000, limit: 2000 });
    expect(button('Download and open', document.querySelector('.peek')!)).toBeTruthy();
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
  });
});

describe('Agenda past dates and metadata errors', () => {
  it('collapses and paginates past due dates without claiming submission status', async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ resource: resource({ id: i + 1, externalResourceId: `past:${i}`, title: `Past date ${i}`, dueAt: '2026-11-12' }), dateKind: 'date' as const, coursePaused: false }));
    appApi.queryDueResources.mockResolvedValue({ items, total: items.length });
    app = await renderApp();
    await click(button('Calendar'));
    expect(document.querySelectorAll('.resource-row')).toHaveLength(0);
    const expand = document.querySelector<HTMLButtonElement>('[aria-expanded="false"].agenda-collapse')!;
    await click(expand);
    expect(document.querySelectorAll('.resource-row')).toHaveLength(20);
    await click(button('Show more past due dates'));
    expect(document.querySelectorAll('.resource-row')).toHaveLength(25);
    expect(document.querySelector('main')?.textContent).toContain('Confirm status in Quanta');
    expect(document.querySelector('main')?.textContent).not.toMatch(/overdue|unsubmitted|completed/i);
  });
  it('does not describe a failed course load as successful no-course discovery', async () => {
    appApi.listCourses.mockRejectedValue(new Error('Course lookup failed'));
    appApi.queryInbox.mockResolvedValue({ items: [], total: 0, unreadTotal: 0, courseCounts: [] });
    app = await renderApp();
    expect(document.querySelector('main')?.textContent).toContain('Course information unavailable');
    expect(document.querySelector('main')?.textContent).not.toContain('No courses yet');
    expect(button('Retry course information')).toBeTruthy();
  });
});
