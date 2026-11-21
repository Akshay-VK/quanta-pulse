import { expect, it } from 'vitest';
import { searchDesktop } from '../src/lib/desktopSearch';
import { course, resource } from './helpers/data';

it('ANDs terms across metadata, ranks titles, and retains exact folder identities', () => {
  const result = searchDesktop({ raw: 'lecture 4', scope: { kind: 'everywhere' } }, {
    courses: [course, { ...course, id: 2 }], resources: [
      resource({ id: 3, title: 'Other lecture', sectionPath: ['Week 4', 'Lectures'] }),
      resource({ id: 2, title: 'Lecture 4 notes', sectionPath: ['Week 4', 'Lectures'] }),
      resource({ id: 1, title: 'Lecture 4', sectionPath: ['Week 4', 'Lectures'] }),
      resource({ id: 4, courseId: 2, title: 'Lecture 4', sectionPath: ['Week 4', 'Lectures'] }),
      resource({ id: 5, title: 'Lecture 5' }),
    ],
  });
  expect(result.files.map(r => r.id)).toEqual([1, 4, 2, 3, 5]);
  const scoped = searchDesktop({ raw: '', scope: { kind: 'folder', courseId: 2, path: ['Week 4'] } }, {
    courses: [course, { ...course, id: 2 }], resources: result.files,
  });
  expect(scoped.files.map(r => r.id)).toEqual([4]);
  expect(scoped.folders.map(f => [f.courseId, f.path])).toEqual([[2, ['Week 4']], [2, ['Week 4', 'Lectures']]]);
});
