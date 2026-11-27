import { expect, it } from 'vitest';
import { sortResources } from '../src/lib/courseLibrary';
import { buildCourseTree } from '../src/lib/courseTree';
import { resource } from './helpers/data';

it('naturally orders numeric file and folder names, with stable identity ties', () => {
  const items = [
    resource({ id: 10, title: 'Lecture 10', externalResourceId: 'r10', sectionPath: ['Week 10'] }),
    resource({ id: 9, title: 'École 2', externalResourceId: 'r9', sectionPath: ['Week 2'] }),
    resource({ id: 2, title: 'ecole 2', externalResourceId: 'r2', sectionPath: ['Week 2'] }),
    resource({ id: 5, title: 'ECOLE 02', externalResourceId: 'r5', sectionPath: ['Week 2'] }),
    resource({ id: 1, title: 'Lecture 2', externalResourceId: 'r1', sectionPath: ['Week 2'] }),
  ];
  for (const input of [items, [...items].reverse(), [...items.slice(2), ...items.slice(0, 2)]]) {
    expect(sortResources(input, 'name').map(r => r.id)).toEqual([2, 5, 9, 1, 10]);
    const tree = buildCourseTree(input, 'Course');
    expect(tree.children.map(n => n.name)).toEqual(['Week 2', 'Week 10']);
    expect(tree.children[0].resources.map(r => r.id)).toEqual([2, 5, 9, 1]);
  }
});

it('keeps missing and impossible authority dates last in either direction without inventing fallback dates', () => {
  const items = [
    resource({ id: 1, title: 'Invalid', uploadedAt: '2026-02-30', firstSeenAt: '2026-12-01T00:00:00Z' }),
    resource({ id: 2, title: 'Missing', uploadedAt: null, publishedAt: null, modifiedAt: null, firstSeenAt: '' }),
    resource({ id: 3, title: 'Offset later', uploadedAt: '2026-03-01T01:00:00+01:00' }),
    resource({ id: 4, title: 'Earlier', uploadedAt: '2026-02-28T23:30:00Z' }),
    resource({ id: 5, title: 'Invalid instant', uploadedAt: '2026-02-30T00:00:00Z' }),
    resource({ id: 6, title: 'Date only', uploadedAt: '2026-02-27' }),
  ];
  expect(sortResources(items, 'newest').map(r => r.id)).toEqual([3, 4, 6, 1, 5, 2]);
  expect(sortResources(items, 'oldest').map(r => r.id)).toEqual([6, 4, 3, 1, 5, 2]);
});

it('uses newest and natural name ties for browsing while retaining textual relevance and ID ties', async () => {
  const { searchDesktop } = await import('../src/lib/desktopSearch');
  const { course } = await import('./helpers/data');
  const items = [
    resource({ id: 1, externalResourceId: '1', title: 'Lecture 10', uploadedAt: '2026-11-20T00:00:00Z' }),
    resource({ id: 20, externalResourceId: '20', title: 'Lecture 2', uploadedAt: '2026-11-20T00:00:00Z' }),
    resource({ id: 3, externalResourceId: '3', title: 'Lecture 2 notes', uploadedAt: '2026-11-21T00:00:00Z' }),
  ];
  const search = (raw: string) => searchDesktop({ raw, scope: { kind: 'everywhere' } }, { courses: [course], resources: items }).files.map(r => r.id);
  expect(search('')).toEqual([3, 20, 1]);
  expect(search('type:pdf')).toEqual([3, 20, 1]);
  expect(search('lecture')).toEqual([3, 1, 20]);
  expect(search('lecture 2')).toEqual([20, 3, 1]);
});

it('keeps collation-equivalent folder paths in exact stable order across permutations', () => {
  const items = ['École 2', 'ecole 2', 'ECOLE 02', 'ecole 10'].map((name, i) => resource({ id: i + 1, externalResourceId: String(i), sectionPath: [name] }));
  for (const input of [items, [...items].reverse()]) {
    expect(buildCourseTree(input, 'Course').children.map(n => n.path)).toEqual([
      ['ECOLE 02'], ['ecole 2'], ['École 2'], ['ecole 10'],
    ]);
  }
});

it('uses timestamp authority rather than the latest source value or detection time', () => {
  const items = [
    resource({ id: 1, title: 'Upload', uploadedAt: '2026-11-01', publishedAt: '2026-11-21', modifiedAt: '2026-11-22', firstSeenAt: '2026-11-23T00:00:00Z' }),
    resource({ id: 2, title: 'Publication', publishedAt: '2026-11-02', modifiedAt: '2026-11-22', firstSeenAt: '2026-11-23T00:00:00Z' }),
    resource({ id: 3, title: 'Modification', modifiedAt: '2026-11-03', firstSeenAt: '2026-11-23T00:00:00Z' }),
    resource({ id: 4, title: 'Detection', firstSeenAt: '2026-11-04T00:00:00Z' }),
  ];
  expect(sortResources(items, 'newest').map(r => r.id)).toEqual([4, 3, 2, 1]);
  expect(sortResources(items, 'oldest').map(r => r.id)).toEqual([1, 2, 3, 4]);
});
