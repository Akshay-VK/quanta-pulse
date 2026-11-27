import { act } from 'react';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { appApi, button, click, renderApp, resource, setupApp } from './helpers/renderApp';
let app: Awaited<ReturnType<typeof renderApp>>;
beforeEach(() => setupApp());
afterEach(() => app?.unmount());
const titles = () => [...document.querySelectorAll('tbody tr .cell-title-main')].map(n => n.textContent);
async function choose(label: string, option: string) {
  await click(document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!);
  await click([...document.querySelectorAll<HTMLElement>('[role="option"]')].find(n => n.textContent === option)!);
}
async function search(value: string) {
  const node = document.querySelector<HTMLInputElement>('input[aria-label="Search library"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('makes browsing order truthful, keeps Detected independent, and remembers explicit sort on return', async () => {
  appApi.listResources.mockResolvedValue([
    resource({ id: 10, externalResourceId: 'r10', title: 'Lecture 10', publishedAt: '2026-11-20', firstSeenAt: '2026-11-01T00:00:00Z' }),
    resource({ id: 2, externalResourceId: 'r2', title: 'Lecture 2', publishedAt: '2026-11-20', firstSeenAt: '2026-11-21T00:00:00Z' }),
    resource({ id: 3, externalResourceId: 'r3', title: 'Lecture 3', publishedAt: '2026-11-19', firstSeenAt: '' }),
  ]);
  app = await renderApp();
  await click(button('Library'));
  await click(button('All files'));
  expect(titles()).toEqual(['Lecture 2', 'Lecture 10', 'Lecture 3']);
  expect(document.querySelector('main')?.textContent).toContain('Newest (activity date)');
  await click(button('Sort'));
  expect(document.querySelector('[aria-label="Sort direction"]')?.getAttribute('disabled')).toBeNull();
  await choose('Sort files by', 'Detected');
  expect(titles()).toEqual(['Lecture 2', 'Lecture 10', 'Lecture 3']);
  await click(button('Descending'));
  expect(titles()).toEqual(['Lecture 10', 'Lecture 2', 'Lecture 3']);
  await click(button('Inbox'));
  await click(button('Library'));
  await click(button('All files'));
  expect(titles()).toEqual(['Lecture 10', 'Lecture 2', 'Lecture 3']);
  await click(button('Sort'));
  await choose('Sort files by', 'Activity date');
  expect(titles()).toEqual(['Lecture 2', 'Lecture 10', 'Lecture 3']);
  await choose('Sort files by', 'Newest (activity date)');
  await search('lecture');
  expect(titles()).toEqual(['Lecture 2', 'Lecture 10', 'Lecture 3']);
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Sort direction"]')?.disabled).toBe(true);
  expect(document.querySelector('[aria-label="Sort direction"]')?.textContent).toBe('Best match first');
  await search('');
  expect(document.querySelector('main')?.textContent).toContain('Newest (activity date)');
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Sort direction"]')?.disabled).toBe(false);
});

it('distinguishes source activity from first detection in the actual table and course browser', async () => {
  appApi.listResources.mockResolvedValue([
    resource({ id: 1, title: 'Lecture 10', publishedAt: '2026-11-01', firstSeenAt: '2026-11-21T00:00:00Z' }),
    resource({ id: 2, externalResourceId: 'r2', title: 'Lecture 2', modifiedAt: '2026-11-20', firstSeenAt: '2026-11-01T00:00:00Z' }),
    resource({ id: 3, externalResourceId: 'r3', title: 'Lecture 3', firstSeenAt: '2026-11-19T00:00:00Z' }),
  ]);
  app = await renderApp();
  await click(button('Library'));
  await click(button('All files'));
  expect(titles()).toEqual(['Lecture 2', 'Lecture 3', 'Lecture 10']);
  const cells = [...document.querySelectorAll('tbody tr')].map(n => n.textContent);
  expect(cells[0]).toContain('modified');
  expect(cells[1]).toContain('detected');
  expect(cells[2]).toContain('published');
  expect(cells.join(' ')).not.toContain('uploaded');
  await click(button('Sort'));
  await choose('Sort files by', 'Detected');
  expect(titles()).toEqual(['Lecture 10', 'Lecture 3', 'Lecture 2']);
  await click(button('MATH F111', document.querySelector('.sidebar')!));
  expect(document.querySelector('[aria-label="Sort resources"]')?.textContent).toContain('Newest (activity date)');
  expect([...document.querySelectorAll('.course-material-row .course-material-name')].map(n => n.textContent)).toEqual(['Lecture 2', 'Lecture 3', 'Lecture 10']);
  expect(document.querySelector('.course-material-detected')?.getAttribute('title')).toContain('First detected');
});

it('keeps explicit name/type overrides and filters while date sorts sink unknowns in both directions', async () => {
  appApi.listResources.mockResolvedValue([
    resource({ id: 1, title: 'Lecture 10', resourceType: 'pdf', uploadedAt: '2026-11-20T01:00:00+01:00' }),
    resource({ id: 2, externalResourceId: 'r2', title: 'Lecture 2', resourceType: 'document', uploadedAt: '2026-11-19' }),
    resource({ id: 3, externalResourceId: 'r3', title: 'Lecture 3', uploadedAt: '2026-02-30', firstSeenAt: '2026-12-01T00:00:00Z' }),
    resource({ id: 4, externalResourceId: 'r4', title: 'Lecture 4', firstSeenAt: '' }),
  ]);
  app = await renderApp();
  await click(button('Library'));
  await click(button('All files'));
  await search('lecture');
  await click(button('Sort'));
  await choose('Sort files by', 'Name');
  expect(titles()).toEqual(['Lecture 2', 'Lecture 3', 'Lecture 4', 'Lecture 10']);
  await choose('Sort files by', 'File type');
  expect(titles()).toEqual(['Lecture 2', 'Lecture 3', 'Lecture 4', 'Lecture 10']);
  await choose('Sort files by', 'Activity date');
  expect(titles()).toEqual(['Lecture 10', 'Lecture 2', 'Lecture 3', 'Lecture 4']);
  await click(button('Descending'));
  expect(titles()).toEqual(['Lecture 2', 'Lecture 10', 'Lecture 3', 'Lecture 4']);
  expect(document.querySelector<HTMLInputElement>('input[aria-label="Search library"]')?.value).toBe('lecture');
});
