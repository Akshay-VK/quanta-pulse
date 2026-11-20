import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appApi, button, click, deferred, emitAppEvent, flushApp, renderApp, setupApp } from './helpers/renderApp';
import { resource } from './helpers/data';

let app: Awaited<ReturnType<typeof renderApp>> | undefined;
beforeEach(() => { setupApp(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-16T12:00:00Z')); });
afterEach(() => { app?.unmount(); app = undefined; vi.useRealTimers(); });
function key(target: Element, value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}
function due(index: number, dueAt = '2026-11-20') {
  const item = resource({ id: index + 1, externalResourceId: `agenda-${index + 1}`, title: `Agenda item ${index + 1}`, dueAt });
  return { resource: item, dateKind: 'date' as const, coursePaused: false };
}
async function openAgenda(items = [due(0), due(1)]) {
  appApi.queryDueResources.mockImplementation(async (filter = {}) => {
    const filtered = filter.search ? items.filter(item => item.resource.title.toLowerCase().includes(filter.search!.toLowerCase())) : items;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? filtered.length;
    return { items: filtered.slice(offset, offset + limit), total: filtered.length };
  });
  app = await renderApp();
  await click(button('Calendar'));
  return app;
}

describe('Agenda keyboard integration', () => {
  it('moves focus without inspection or acknowledgement; Enter inspects once', async () => {
    await openAgenda();
    const first = button('Show details for Agenda item 1');
    act(() => first.focus());
    await act(async () => { key(first, 'j'); });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Show details for Agenda item 2');
    expect(document.querySelector('.peek')).toBeNull();
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
    await act(async () => { key(document.activeElement!, 'Enter'); });
    expect(document.querySelector('.peek')).not.toBeNull();
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
  });

  it('keeps X selection independent and snapshots focused/selected resources for E and U', async () => {
    await openAgenda();
    const first = button('Show details for Agenda item 1');
    act(() => first.focus());
    await act(async () => { key(first, 'x'); });
    expect(document.querySelector('.peek')).toBeNull();
    expect(document.querySelector('.resource-row.multi-selected')).not.toBeNull();
    appApi.snapshotResourceEventIds.mockResolvedValue([10, 11, 12]);
    await act(async () => { key(document.activeElement!, 'j'); key(document.activeElement!, 'e'); await flushApp(); });
    expect(appApi.snapshotResourceEventIds).toHaveBeenCalledWith([1]);
    expect(appApi.setEventReadState).toHaveBeenCalledWith([10, 11, 12], true);
    await act(async () => { key(document.activeElement!, 'u'); await flushApp(); });
    expect(appApi.setEventReadState).toHaveBeenLastCalledWith([10, 11, 12], false);
  });

  it('freezes complete Shift+A due inventory including past, collapsed and show-more-hidden rows', async () => {
    const items = Array.from({ length: 23 }, (_, index) => due(index, index === 22 ? '2026-11-01' : '2026-11-20'));
    const captured = deferred<number[]>();
    appApi.snapshotResourceEventIds.mockReturnValue(captured.promise);
    await openAgenda(items);
    expect(document.querySelector('[aria-label="Show details for Agenda item 23"]')).toBeNull();
    const row = button('Show details for Agenda item 1');
    expect(button('Show more this week')).toBeTruthy();
    expect(document.querySelectorAll('.agenda-view .resource-row')).toHaveLength(20);
    act(() => row.focus());
    await act(async () => { key(row, 'a', { shiftKey: true }); key(row, 'a', { shiftKey: true }); });
    expect(appApi.snapshotResourceEventIds).toHaveBeenCalledTimes(1);
    expect(appApi.snapshotResourceEventIds.mock.calls[0][0]).toHaveLength(items.length);
    expect(appApi.snapshotResourceEventIds.mock.calls[0][0]).toEqual(expect.arrayContaining(items.map(item => item.resource.id)));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    items.push(due(30));
    await emitAppEvent('sync:done', {});
    await act(async () => { captured.resolve([10, 11, 900]); });
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('3 recorded changes');
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('including hidden Agenda items');
    await click(button('Mark captured resources read'));
    expect(appApi.setEventReadState).toHaveBeenCalledWith([10, 11, 900], true);
    expect(appApi.snapshotResourceEventIds).toHaveBeenCalledTimes(1);
  });

  it('captures Delete IDs before confirmation, cancels cleanly, and dismisses Inbox only', async () => {
    await openAgenda();
    appApi.snapshotResourceEventIds.mockResolvedValue([101, 102]);
    const row = button('Show details for Agenda item 1');
    act(() => row.focus());
    await act(async () => { key(row, 'Delete'); await flushApp(); });
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain('Inbox');
    expect(dialog?.textContent).toContain('due dates remain in Agenda');
    await click(button('Cancel'));
    expect(appApi.dismissInboxEvents).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(row);
    await act(async () => { key(row, 'Delete'); await flushApp(); });
    await click(button('Dismiss captured resources'));
    expect(appApi.dismissInboxEvents).toHaveBeenCalledWith([101, 102]);
    expect(appApi.deleteHistory).not.toHaveBeenCalled();
  });

  it('previews independently and suppresses nested controls, editables, IME and repeat', async () => {
    await openAgenda();
    const row = button('Show details for Agenda item 1');
    act(() => row.focus());
    await act(async () => { key(row, ' ', { repeat: false }); });
    expect(appApi.previewResource).toHaveBeenCalledTimes(1);
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
    await act(async () => { key(row, 'Delete'); });
    expect(appApi.snapshotResourceEventIds).not.toHaveBeenCalled();
    await click(button('Close preview'));
    const input = document.createElement('input');
    document.querySelector('.agenda-view')?.append(input);
    act(() => input.focus());
    await act(async () => { key(input, 'e'); });
    expect(document.activeElement).toBe(input);
    act(() => row.focus());
    await act(async () => { key(row, 'x', { isComposing: true }); key(row, 'u', { repeat: true }); });
    expect(document.querySelector('.resource-row.multi-selected')).toBeNull();
    const nested = document.querySelector<HTMLButtonElement>('.agenda-view .row-actions button')!;
    expect(nested).not.toBeNull();
    act(() => nested.focus());
    await act(async () => { key(nested, 'j'); key(nested, 'e'); });
    expect(document.activeElement).toBe(nested);
    act(() => row.focus());
    await act(async () => { key(row, 'x', { ctrlKey: true }); key(row, 'x', { altKey: true }); key(row, 'x', { metaKey: true }); key(row, 'x', { shiftKey: true }); key(row, 'x', { keyCode: 229 }); });
    expect(document.querySelector('.resource-row.multi-selected')).toBeNull();
    row.addEventListener('keydown', event => event.preventDefault(), { once: true });
    await act(async () => { key(row, 'a', { shiftKey: true }); });
    act(() => button('Calendar').focus());
    await act(async () => { key(row, 'e'); });
    expect(appApi.snapshotResourceEventIds).not.toHaveBeenCalled();
  });

  it('does not open a stale Shift+A dialog after filtering or unmount', async () => {
    const captured = deferred<number[]>();
    appApi.snapshotResourceEventIds.mockReturnValue(captured.promise);
    await openAgenda();
    const row = button('Show details for Agenda item 1');
    act(() => row.focus());
    await act(async () => { key(row, 'a', { shiftKey: true }); });
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search Agenda"]')!;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(search, 'does not match'); search.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 220)); });
    await act(async () => { captured.resolve([10]); });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(search);
  });

  it('returns focus after show-more and restores a surviving row after filtering', async () => {
    const items = Array.from({ length: 22 }, (_, index) => due(index));
    await openAgenda(items);
    const first = button('Show details for Agenda item 1');
    act(() => first.focus());
    await click(button('Show more this week'));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Show details for Agenda item 1');
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search Agenda"]')!;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(search, 'Agenda item 2'); search.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 220)); });
    await flushApp();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Show details for Agenda item 2');
  });

  it('shows snapshot errors and ignores duplicate keys while capture is pending', async () => {
    const captured = deferred<number[]>();
    appApi.snapshotResourceEventIds.mockReturnValue(captured.promise);
    await openAgenda();
    const row = button('Show details for Agenda item 1');
    act(() => row.focus());
    await act(async () => { key(row, 'Delete'); key(row, 'Delete'); });
    expect(appApi.snapshotResourceEventIds).toHaveBeenCalledTimes(1);
    captured.reject(new Error('snapshot unavailable'));
    await flushApp();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not capture Agenda event scope');
  });

  it('does not open pending captures after unmount', async () => {
    const captured = deferred<number[]>();
    appApi.snapshotResourceEventIds.mockReturnValue(captured.promise);
    await openAgenda();
    const row = button('Show details for Agenda item 1');
    act(() => row.focus());
    await act(async () => { key(row, 'a', { shiftKey: true }); });
    app?.unmount(); app = undefined;
    await act(async () => { captured.resolve([10]); });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
  it('keeps failed mutations visible, preserves confirmation and refreshes global counts only on success', async () => {
    await openAgenda();
    appApi.snapshotResourceEventIds.mockResolvedValue([101, 102]);
    const row = button('Show details for Agenda item 1');
    act(() => row.focus());
    appApi.dismissInboxEvents.mockRejectedValueOnce(new Error('write denied'));
    await act(async () => { key(row, 'Delete'); await flushApp(); });
    const queries = appApi.queryInbox.mock.calls.length;
    expect(button('Inbox').querySelector('.nav-badge')?.textContent).toBe('1');
    await click(button('Dismiss captured resources'));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('write denied');
    expect(appApi.queryInbox.mock.calls.length).toBe(queries);
    appApi.listDashboardEvents.mockResolvedValue([]);
    appApi.dismissInboxEvents.mockResolvedValue(undefined);
    await click(button('Dismiss captured resources'));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(appApi.queryInbox.mock.calls.length).toBeGreaterThan(queries);
    expect(button('Inbox').querySelector('.nav-badge')).toBeNull();
    expect(appApi.dismissInboxEvents.mock.calls).toEqual([[[101, 102]], [[101, 102]]]);
    expect(button('Show details for Agenda item 1')).toBeTruthy();
  });

  it('keeps modal focus during due refresh and restores row focus on cancel', async () => {
    await openAgenda();
    appApi.snapshotResourceEventIds.mockResolvedValue([10]);
    const row = button('Show details for Agenda item 1');
    act(() => row.focus());
    await act(async () => { key(row, 'Delete'); await flushApp(); });
    expect(document.activeElement).toBe(button('Cancel'));
    const queries = appApi.queryDueResources.mock.calls.length;
    appApi.queryDueResources.mockResolvedValue({ items: [due(1)], total: 1 });
    await emitAppEvent('sync:done', {});
    expect(appApi.queryDueResources.mock.calls.length).toBeGreaterThan(queries);
    expect(document.activeElement).toBe(button('Cancel'));
    await click(button('Cancel'));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Show details for Agenda item 2');
  });

  it.each(['snapshot', 'mutation', 'mutation success'] as const)('does not let stale %s settlement unlock a newer pending capture', async phase => {
    const old = deferred<number[]>();
    const newer = deferred<number[]>();
    await openAgenda();
    appApi.snapshotResourceEventIds.mockReturnValueOnce(phase === 'snapshot' ? old.promise : Promise.resolve([10])).mockReturnValueOnce(newer.promise);
    if (phase.startsWith('mutation')) appApi.setEventReadState.mockReturnValueOnce(old.promise.then(() => undefined));
    const row = button('Show details for Agenda item 1');
    act(() => row.focus());
    await act(async () => { key(row, 'e'); await flushApp(); });
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search Agenda"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'Agenda item');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 220));
    });
    act(() => button('Show details for Agenda item 1').focus());
    await act(async () => { key(document.activeElement!, 'Delete'); });
    await act(async () => { if (phase === 'mutation success') old.resolve([]); else old.reject(new Error('obsolete failure')); await flushApp(); });
    await act(async () => { key(document.activeElement!, 'Delete'); });
    expect(appApi.snapshotResourceEventIds).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain('obsolete failure');
    await act(async () => { newer.resolve([20]); });
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('1 recorded changes');
    await click(button('Dismiss captured resources'));
    expect(appApi.dismissInboxEvents).toHaveBeenCalledWith([20]);
  });

  it('keeps empty authoritative captures explicit without widening scope', async () => {
    await openAgenda();
    appApi.snapshotResourceEventIds.mockResolvedValue([]);
    const row = button('Show details for Agenda item 1');
    act(() => row.focus());
    await act(async () => { key(row, 'e'); await flushApp(); });
    expect(document.body.textContent).toContain('No eligible event records');
    await act(async () => { key(row, 'a', { shiftKey: true }); await flushApp(); });
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('No eligible event records');
    await click(button('Mark captured resources read'));
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
  });

});
