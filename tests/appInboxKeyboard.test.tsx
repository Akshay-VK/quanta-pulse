import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appApi, button, click, deferred, emitAppEvent, flushApp, renderApp, setupApp } from './helpers/renderApp';
import { change, resource } from './helpers/data';

let app: Awaited<ReturnType<typeof renderApp>> | undefined;
beforeEach(() => { setupApp(); });
afterEach(() => { app?.unmount(); app = undefined; });
function key(target: Element, value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

describe('Inbox keyboard integration', () => {
  it('moves focus without inspection or acknowledgement, and Enter inspects once', async () => {
    appApi.listDashboardEvents.mockResolvedValue([change(), change({ id: 11, resourceId: 2, resourceTitle: 'Problem set', title: 'Updated set' })]);
    appApi.listResources.mockResolvedValue([resource(), resource({ id: 2, externalResourceId: 'r2', title: 'Problem set' })]);
    app = await renderApp();
    const first = button('Show details for Lecture 4');
    act(() => first.focus());
    await act(async () => { key(first, 'j'); });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Show details for Problem set');
    expect(document.querySelector('.peek')).toBeNull();
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
    const focused = document.activeElement as HTMLButtonElement;
    await act(async () => { key(focused, 'Enter'); });
    expect(document.querySelector('.peek-title')?.textContent).toBe('Problem set');
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
  });
  it('toggles accessible local multi-selection without inspecting; E and U use grouped IDs', async () => {
    appApi.listDashboardEvents.mockResolvedValue([change({ id: 10 }), change({ id: 11, title: 'Update' })]);
    appApi.queryInbox.mockResolvedValue({ items: [{ key: 'resource:1', resourceId: 1, courseId: 1, latestEvent: change({ id: 11 }), eventIds: [10, 11], changeTypes: ['new'], unread: true }], total: 1, unreadTotal: 1, courseCounts: [] });
    app = await renderApp();
    const row = button('Show details for Lecture 4');
    act(() => row.focus()); await act(async () => { key(row, 'x'); });
    expect(document.querySelector('.peek')).toBeNull();
    expect(button('Remove Lecture 4 from bulk selection').getAttribute('aria-pressed')).toBe('true');
    await act(async () => { key(document.activeElement!, 'e'); });
    expect(appApi.setEventReadState).toHaveBeenCalledWith([10, 11], true);
    await act(async () => { key(document.activeElement!, 'u'); });
    expect(appApi.setEventReadState).toHaveBeenLastCalledWith([10, 11], false);
  });
  it('uses authoritative full scope for Shift+A and leaves arrivals outside the frozen capture', async () => {
    const captured = deferred<number[]>();
    appApi.snapshotInboxEventIds.mockReturnValue(captured.promise);
    app = await renderApp();
    const row = button('Show details for Lecture 4'); act(() => row.focus());
    await act(async () => { key(row, 'a', { shiftKey: true }); });
    expect(appApi.snapshotInboxEventIds).toHaveBeenCalledWith({});
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await act(async () => { captured.resolve([10, 11, 900]); });
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('3 recorded changes across all matching items');
    await click(button('Mark captured items read'));
    expect(appApi.setEventReadState).toHaveBeenCalledWith([10, 11, 900], true);
  });
  it('guards editable, nested controls, IME, repeats, and preview does not acknowledge', async () => {
    app = await renderApp();
    const row = button('Show details for Lecture 4'); act(() => row.focus());
    const input = document.createElement('input'); document.querySelector('.inbox-view')?.append(input);
    await act(async () => { key(input, 'j'); key(row, 'x', { isComposing: true }); key(row, 'u', { repeat: true }); });
    expect(button('Add Lecture 4 from bulk selection')).toBeTruthy();
    const courseControl = document.querySelector('.course-pill button');
    if (courseControl) await act(async () => { key(courseControl, 'j'); });
    await act(async () => { key(row, ' '); });
    expect(appApi.previewResource).toHaveBeenCalledTimes(1);
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
    input.remove();
  });
  it('opens Delete confirmation for the focused row and dismissal preserves History', async () => {
    appApi.snapshotInboxEventIds.mockResolvedValue([10, 11]);
    app = await renderApp();
    const row = button('Show details for Lecture 4'); act(() => row.focus());
    await act(async () => { key(row, 'Delete'); });
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('History and saved files remain');
    await click(button('Cancel'));
    expect(document.activeElement).toBe(row);
    await act(async () => { key(row, 'Delete'); });
    await click(button('Dismiss captured items'));
    expect(appApi.dismissInboxEvents).toHaveBeenCalledWith([10]);
    expect(appApi.deleteHistory).not.toHaveBeenCalled();
  });
  it('recovers DOM focus by stable key when a filter removes the focused row', async () => {
    appApi.listDashboardEvents.mockResolvedValue([change(), change({ id: 11, resourceId: 2, resourceTitle: 'Problem set', title: 'Updated set' })]);
    appApi.listResources.mockResolvedValue([resource(), resource({ id: 2, externalResourceId: 'r2', title: 'Problem set' })]);
    app = await renderApp();
    act(() => button('Show details for Lecture 4').focus());
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search Inbox"]')!;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(search, 'Problem'); search.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
    await flushApp();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Show details for Problem set');
    expect(document.querySelector('.peek')).toBeNull();
  });
  it('returns focus to Inbox search when the visible list becomes empty', async () => {
    app = await renderApp();
    act(() => button('Show details for Lecture 4').focus());
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search Inbox"]')!;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(search, 'no results'); search.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
    await flushApp();
    expect(document.querySelector('.resource-row')).toBeNull();
    expect(document.activeElement).toBe(search);
  });
  it('does not steal focused row during a background refresh', async () => {
    app = await renderApp();
    const row = button('Show details for Lecture 4');
    act(() => row.focus());
    await emitAppEvent('sync:done', {});
    expect(document.activeElement).toBe(row);
  });
});
