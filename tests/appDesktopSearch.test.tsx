import { act } from 'react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { appApi, button, click, emitAppEvent, escape, deferred, flushApp, renderApp, resource, course, setupApp } from './helpers/renderApp';
let app: Awaited<ReturnType<typeof renderApp>>;
beforeEach(() => setupApp());
afterEach(() => app?.unmount());
async function input(node: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('preserves quoted aliases, filters and relevance from palette to Library', async () => {
  appApi.listCourses.mockResolvedValue([{ ...course, displayName: 'ECOM F222' }]);
  appApi.listResources.mockResolvedValue([
    resource({ id: 2, externalResourceId: "r2", title: 'Lecture 4 notes', resourceType: 'pdf' }),
    resource({ id: 3, externalResourceId: "r3", title: 'Lecture 4 video', resourceType: 'url' }),
    resource({ id: 1, title: 'Lecture 4', resourceType: 'pdf' }),
  ]);
  app = await renderApp();
  await click(document.querySelector<HTMLButtonElement>('.search-trigger')!);
  await input(document.querySelector<HTMLInputElement>('.palette-input')!, 'course:"ECOM F222" type:pdf lecture 4');
  const hits = [...document.querySelectorAll('.palette-item')].filter(n => n.textContent?.includes('Lecture 4'));
  expect(hits.map(n => n.textContent?.includes('notes') ? 'notes' : 'exact')).toEqual(['exact', 'notes']);
  await click([...document.querySelectorAll<HTMLElement>('.palette-item')].find(n => n.textContent?.includes('See all results'))!);
  expect(document.querySelector<HTMLInputElement>('input[aria-label="Search library"]')?.value).toBe('course:"ECOM F222" type:pdf lecture 4');
  expect([...document.querySelectorAll('tbody tr')].map(n => n.textContent?.includes('notes') ? 'notes' : 'exact')).toEqual(['exact', 'notes']);
  expect(appApi.openExternal).not.toHaveBeenCalled();
});

async function inputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function palette(raw: string) {
  await click(document.querySelector<HTMLButtonElement>('.search-trigger')!);
  await inputValue(document.querySelector<HTMLInputElement>('.palette-input')!, raw);
}
async function chooseScope(scope: object) {
  const select = document.querySelector<HTMLSelectElement>('main select[aria-label="Search scope"]')!;
  await act(async () => { select.value = JSON.stringify(scope); select.dispatchEvent(new Event('change', { bubbles: true })); });
}

it('opens the exact duplicate folder, reveals ancestors, preserves explicit scope and clears filters with the keyboard', async () => {
  appApi.listCourses.mockResolvedValue([course, { ...course, id: 2, shortName: 'PHYS F111', displayName: 'Physics' }]);
  appApi.listResources.mockResolvedValue([
    resource({ title: 'Math slides', sectionPath: ['Week 05', 'Lectures'] }),
    resource({ id: 2, externalResourceId: 'r2', courseId: 2, title: 'Physics slides', sectionPath: ['Week 05', 'Lectures'] }),
    resource({ id: 3, externalResourceId: 'r3', courseId: 2, title: 'Physics tutorial', sectionPath: ['Week 05', 'Tutorials'] }),
  ]);
  app = await renderApp();
  await palette('Lectures');
  const folder = [...document.querySelectorAll<HTMLElement>('.palette-item')].find(n => n.textContent?.includes('Physics / Week 05 / Lectures'))!;
  expect(folder).toBeTruthy();
  const paletteInput = document.querySelector<HTMLInputElement>('.palette-input')!;
  // cmdk keeps focus in its input and uses aria-selected for keyboard selection.
  for (let step = 0; step < 12 && folder.getAttribute('aria-selected') !== 'true'; step++) {
    await act(async () => paletteInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
  }
  expect(folder.getAttribute('aria-selected')).toBe('true');
  await act(async () => paletteInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  await flushApp();
  const main = document.querySelector('main')!;
  expect(main.textContent).toContain('Physics slides');
  expect(main.textContent).not.toContain('Math slides');
  const selected = document.querySelector('.sidebar [aria-current="page"]')!;
  expect(selected.textContent).toContain('Lectures');
  expect(document.querySelector('.sidebar')?.textContent).toContain('Tutorials');
  expect(JSON.parse(document.querySelector<HTMLSelectElement>('main select[aria-label="Search scope"]')!.value)).toEqual({ kind: 'folder', courseId: 2, path: ['Week 05', 'Lectures'] });
  await chooseScope({ kind: 'course', courseId: 2 });
  await inputValue(document.querySelector<HTMLInputElement>('main .search-field-input')!, 'slides');
  await click(button('Tutorials', document.querySelector('.sidebar')!));
  expect(document.querySelector<HTMLInputElement>('main .search-field-input')!.value).toBe('slides');
  expect(JSON.parse(document.querySelector<HTMLSelectElement>('main select[aria-label="Search scope"]')!.value)).toEqual({ kind: 'course', courseId: 2 });
  await click(button('Clear filters', main));
  expect(main.textContent).toContain('Physics tutorial');
  expect(JSON.parse(document.querySelector<HTMLSelectElement>('main select[aria-label="Search scope"]')!.value)).toEqual({ kind: 'course', courseId: 2 });
  expect(appApi.openExternal).not.toHaveBeenCalled();

});

it('reevaluates See all after refresh, retains results on failure and reapplies repeated requests', async () => {
  appApi.listCourses.mockResolvedValue([{ ...course, displayName: 'ECOM F222' }]);
  app = await renderApp();
  await palette('course:"ECOM F222" type:pdf lecture');
  await click([...document.querySelectorAll<HTMLElement>('.palette-item')].find(n => n.textContent?.includes('See all results'))!);
  appApi.listResources.mockResolvedValue([resource(), resource({ id: 2, externalResourceId: 'r2', title: 'Lecture 5' })]);
  await emitAppEvent('sync:done', {});
  expect(document.querySelector('main')?.textContent).toContain('Lecture 5');
  appApi.listSearchInventory.mockRejectedValueOnce(new Error('Snapshot offline'));
  await emitAppEvent('sync:done', {});
  expect(document.querySelector('main')?.textContent).toContain('Lecture 5');
  expect(document.querySelector('main')?.textContent).toContain('refresh failed');
  await inputValue(document.querySelector<HTMLInputElement>('input[aria-label="Search library"]')!, 'nothing');
  expect(document.querySelector('main')?.textContent).toContain('No files match');
  await palette('course:"ECOM F222" type:pdf lecture');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Search refresh failed");
  await click([...document.querySelectorAll<HTMLElement>('.palette-item')].find(n => n.textContent?.includes('See all results'))!);
  expect(document.querySelector<HTMLInputElement>('input[aria-label="Search library"]')!.value).toBe('course:"ECOM F222" type:pdf lecture');
  expect(document.querySelector('main')?.textContent).toContain('Lecture 5');
});

it('shows invalid tokens with no file hits and restores palette focus on Escape', async () => {
  app = await renderApp();
  const origin = document.querySelector<HTMLButtonElement>('.search-trigger')!;
  await act(async () => origin.focus());
  await palette('owner:me');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Unsupported filter: owner');
  expect(document.querySelector('.palette-group .palette-file')).toBeNull();
  expect([...document.querySelectorAll('.palette-item')].some(n => n.textContent?.includes('Lecture 4'))).toBe(false);
  await escape();
  expect(document.querySelector('.palette-input')).toBeNull();
  expect(document.activeElement).toBe(origin);
});

it('publishes only the newest atomic inventory when refresh requests resolve out of order', async () => {
  app = await renderApp();
  await palette('lecture');
  await click([...document.querySelectorAll<HTMLElement>('.palette-item')].find(n => n.textContent?.includes('See all results'))!);
  const older = deferred<{ courses: typeof course[]; resources: ReturnType<typeof resource>[] }>();
  const newer = deferred<{ courses: typeof course[]; resources: ReturnType<typeof resource>[] }>();
  appApi.listSearchInventory.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  await emitAppEvent('sync:done', {});
  await emitAppEvent('sync:done', {});
  await act(async () => newer.resolve({ courses: [{ ...course, displayName: 'Latest course' }], resources: [resource({ title: 'Lecture latest' })] }));
  await flushApp();
  await act(async () => older.resolve({ courses: [course], resources: [resource({ title: 'Lecture stale' })] }));
  await flushApp();
  expect(document.querySelector('main')?.textContent).toContain('Lecture latest');
  expect(document.querySelector('main')?.textContent).not.toContain('Lecture stale');
  expect(document.querySelector('input[aria-label="Search library"]')).toHaveProperty('value', 'lecture');
});

it('updates saved and unread facts on both surfaces without downloading', async () => {
  app = await renderApp();
  await palette('is:saved is:unread lecture');
  expect([...document.querySelectorAll('.palette-item')].some(n => n.textContent?.includes('Lecture 4'))).toBe(false);
  await emitAppEvent('mirror:file', { resourceId: 1, status: 'ok', error: null });
  expect([...document.querySelectorAll('.palette-item')].some(n => n.textContent?.includes('Lecture 4'))).toBe(true);
  await click([...document.querySelectorAll<HTMLElement>('.palette-item')].find(n => n.textContent?.includes('See all results'))!);
  expect(document.querySelector('tbody')?.textContent).toContain('Lecture 4');
  appApi.listHistoryEvents.mockResolvedValue([]);
  appApi.listDashboardEvents.mockResolvedValue([]);
  await emitAppEvent('sync:done', {});
  expect(document.querySelector('tbody')?.textContent).not.toContain('Lecture 4');
  await palette('is:saved is:unread lecture');
  expect([...document.querySelectorAll('.palette-item')].some(n => n.textContent?.includes('Lecture 4'))).toBe(false);
  expect(appApi.ensureLocal).not.toHaveBeenCalled();
});

it('preserves filter tokens and source dates when widening Materials to Everywhere', async () => {
  app = await renderApp();
  await click(button('MATH F111'));
  await inputValue(document.querySelector<HTMLInputElement>('main .search-field-input')!, 'type:pdf "Lecture 4"');
  await inputValue(document.querySelector<HTMLInputElement>('input[aria-label="Source date from"]')!, '2026-10-14');
  await inputValue(document.querySelector<HTMLInputElement>('input[aria-label="Source date through"]')!, '2026-10-14');
  await chooseScope({ kind: 'everywhere' });
  expect(document.querySelector<HTMLInputElement>('input[aria-label="Search library"]')!.value).toBe('type:pdf "Lecture 4"');
  expect(document.querySelector<HTMLInputElement>('input[aria-label="Source date from"]')!.value).toBe('2026-10-14');
  expect(document.querySelector<HTMLInputElement>('input[aria-label="Source date through"]')!.value).toBe('2026-10-14');
  expect(document.querySelector('tbody')?.textContent).toContain('Lecture 4');
  await click(button('Clear filters', document.querySelector('main')!));
  expect(JSON.parse(document.querySelector<HTMLSelectElement>('main select[aria-label="Search scope"]')!.value)).toEqual({ kind: 'everywhere' });
  expect(document.querySelector<HTMLInputElement>('input[aria-label="Source date from"]')!.value).toBe('');
  expect(appApi.ensureLocal).not.toHaveBeenCalled();
});

it('retains stable folder identity through course renames and shows removed destinations honestly', async () => {
  const second = { ...course, id: 2, shortName: 'PHYS F111', displayName: 'Physics' };
  appApi.listCourses.mockResolvedValue([course, second]);
  const math = resource({ title: 'Math notes', sectionPath: ['Week 05', 'Lectures'] });
  const physics = resource({ id: 2, externalResourceId: 'r2', courseId: 2, title: 'Physics notes', sectionPath: ['Week 05', 'Lectures'] });
  appApi.listResources.mockResolvedValue([math, physics]);
  app = await renderApp();
  await palette('course:Physics Lectures');
  await click([...document.querySelectorAll<HTMLElement>('.palette-item')].find(n => n.textContent?.includes('Physics / Week 05 / Lectures'))!);
  appApi.listCourses.mockResolvedValue([course, { ...second, displayName: 'Renamed physics' }]);
  await emitAppEvent('sync:done', {});
  expect(document.querySelector('main')?.textContent).toContain('Physics notes');
  expect(JSON.parse(document.querySelector<HTMLSelectElement>('main select[aria-label="Search scope"]')!.value)).toEqual({ kind: 'folder', courseId: 2, path: ['Week 05', 'Lectures'] });
  appApi.listResources.mockResolvedValue([math]);
  await emitAppEvent('sync:done', {});
  expect(document.querySelector('main')?.textContent).toContain('Folder unavailable');
  expect(document.querySelector('main')?.textContent).not.toContain('Math notes');
  await click(button('Back to course materials'));
  appApi.listCourses.mockResolvedValue([course]);
  await emitAppEvent('sync:done', {});
  expect(document.querySelector('main')?.textContent).toContain('Course unavailable');
  expect(button('Back to Library')).toBeTruthy();
});
