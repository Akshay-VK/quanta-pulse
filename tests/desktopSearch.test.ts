import { expect, it } from 'vitest';
import { searchDesktop } from '../src/lib/desktopSearch';
import { course, resource as makeResource } from './helpers/data';
import type { Resource } from '../src/lib/types';
const resource = (overrides: Partial<Resource> = {}) => makeResource({ externalResourceId: `r${overrides.id ?? 1}`, ...overrides });

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

it('uses configured dates, rejects impossible ranges and handles due alternatives', () => {
  const inventory = { courses: [course], resources: [
    resource({ id: 1, dueAt: '2026-11-21T02:00:00Z', uploadedAt: '2026-11-20T19:00:00Z' }),
    resource({ id: 2, dueAt: '2026-02-30' }),
    resource({ id: 3, dueAt: '2026-11-21' }),
  ] };
  expect(searchDesktop({ raw: 'due:overdue', scope: { kind: 'everywhere' }, now: '2026-11-21T03:00:00Z', timeZone: 'Asia/Kolkata' }, inventory).files.map(r => r.id)).toEqual([1]);
  expect(searchDesktop({ raw: 'due:none due:today', scope: { kind: 'everywhere' }, now: '2026-11-21T03:00:00Z', timeZone: 'Asia/Kolkata' }, inventory).files.map(r => r.id)).toEqual([1, 2, 3]);
  expect(searchDesktop({ raw: '', scope: { kind: 'everywhere' }, filters: { sourceFrom: '2026-11-21', sourceThrough: '2026-11-21' }, timeZone: 'Asia/Kolkata' }, inventory).files.map(r => r.id)).toEqual([1]);
  expect(searchDesktop({ raw: '', scope: { kind: 'everywhere' }, filters: { sourceFrom: '2026-02-30' } }, inventory).files).toEqual([]);
});

it('rejects invalid syntax and honors phrases, escaping, Unicode and rank ties', () => {
  const inventory = { courses: [course], resources: [
    resource({ id: 4, title: 'Café "notes"' }),
    resource({ id: 2, title: 'Cafe "notes"' }),
    resource({ id: 8, title: 'Cafe "notes" appendix', uploadedAt: '2026-11-20T00:00:00Z' }),
  ] };
  expect(searchDesktop({ raw: '"cafe \\"notes\\""', scope: { kind: 'everywhere' } }, inventory).files.map(r => r.id)).toEqual([2, 4, 8]);
  for (const raw of ['owner:me', 'is:read is:unread', 'type:unknown', '"unclosed']) {
    const result = searchDesktop({ raw, scope: { kind: 'everywhere' } }, inventory);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.files).toEqual([]);
  }
});

it('intersects dimensions and scopes while preserving alternatives and subtree boundaries', () => {
  const courses = [course, { ...course, id: 2, shortName: 'BIO F111' }];
  const resources = [
    resource({ id: 1, title: 'Lecture', resourceType: 'PDF', sectionPath: ['Week 5', 'Lectures'] }),
    resource({ id: 2, title: 'Lecture', resourceType: 'pdf', sectionPath: ['Week 5', 'Lectures', 'Extra'] }),
    resource({ id: 3, title: 'Lecture', resourceType: 'url', sectionPath: ['Week 50'] }),
    resource({ id: 4, courseId: 2, title: 'Lecture', resourceType: 'pdf', sectionPath: ['Week 5', 'Lectures'] }),
  ];
  const result = searchDesktop({ raw: 'course:math course:bio type:pdf type:url is:unread is:saved', scope: { kind: 'folder', courseId: 1, path: ['Week 5'] } }, {
    courses, resources, unreadIds: new Set([1, 2, 4]), savedIds: new Set([1, 4]),
  });
  expect(result.files.map(r => r.id)).toEqual([1]);
  expect(result.folders.map(f => f.path)).toEqual([['Week 5'], ['Week 5', 'Lectures']]);
  const missing = searchDesktop({ raw: '', scope: { kind: 'folder', courseId: 2, path: ['Removed'] } }, { courses, resources });
  expect(missing.errors).toContain('Folder unavailable');
  expect(missing.files).toEqual([]);
});

it('evaluates inclusive source days across DST and date-only deadlines independently of UTC', () => {
  const inventory = { courses: [course], resources: [
    resource({ id: 1, uploadedAt: '2026-03-08T04:59:59Z', dueAt: '2026-03-08' }),
    resource({ id: 2, uploadedAt: '2026-03-08T05:00:00Z', dueAt: '2026-03-08T04:59:59Z' }),
    resource({ id: 3, uploadedAt: '2026-03-09T03:59:59Z' }),
    resource({ id: 4, uploadedAt: '2026-03-09T04:00:00Z' }),
  ] };
  expect(searchDesktop({ raw: '', scope: { kind: 'everywhere' }, filters: { sourceFrom: '2026-03-08', sourceThrough: '2026-03-08' }, timeZone: 'America/New_York' }, inventory).files.map(r => r.id)).toEqual([3, 2]);
  expect(searchDesktop({ raw: 'due:today', scope: { kind: 'everywhere' }, now: '2026-03-08T05:30:00Z', timeZone: 'America/New_York' }, inventory).files.map(r => r.id)).toEqual([1]);
});

it('returns every unique matching file beyond the legacy 2,000-row boundary', () => {
  const resources = Array.from({ length: 2505 }, (_, i) => resource({ id: i + 1, externalResourceId: `r${i + 1}`, title: `Lecture ${i + 1}`, sectionPath: ['Week 5', 'Lectures'] }));
  const result = searchDesktop({ raw: 'lecture', scope: { kind: 'everywhere' } }, { courses: [course], resources });
  expect(result.files).toHaveLength(2505);
  expect(new Set(result.files.map(r => r.id)).size).toBe(2505);
  expect(result.files[0].id).toBe(1);
  expect(result.files[2504].id).toBe(2505);
});

it('ranks exact, prefix, title terms and metadata with source-date and stable-ID ties', () => {
  const make = (id: number, title: string, uploadedAt: string | null = null) => resource({ id, externalResourceId: `r${id}`, title, uploadedAt, sectionPath: ['Lecture 4'] });
  const result = searchDesktop({ raw: 'lecture 4', scope: { kind: 'everywhere' } }, { courses: [course], resources: [
    make(9, 'Lecture 4', '2026-11-21T00:00:00Z'), make(3, 'Lecture 4', '2026-11-21T00:00:00Z'),
    make(1, 'Lecture 4'), make(2, 'Lecture 4 appendix', '2026-11-21T00:00:00Z'),
    make(5, '4 — lecture notes', '2026-11-21T00:00:00Z'), make(6, 'Metadata hit', '2026-11-21T00:00:00Z'),
    { ...make(7, 'Metadata hit'), firstSeenAt: 'invalid' },
  ] });
  expect(result.files.map(r => r.id)).toEqual([3, 9, 1, 2, 5, 6, 7]);
});

it('ranks an exact canonical or short course name ahead of a display-name prefix', () => {
  const courses = [
    { ...course, id: 1, name: 'Calculus', shortName: 'Math', displayName: 'Vector Methods' },
    { ...course, id: 2, name: 'Calculator', shortName: 'CALS', displayName: 'Math methods' },
    { ...course, id: 3, name: 'Math', shortName: 'Algebra', displayName: 'Zeta' },
  ];
  const result = searchDesktop({ raw: 'math', scope: { kind: 'everywhere' } }, { courses, resources: [] });
  expect(result.courses.map(c => c.id)).toEqual([1, 3, 2]);
});

it('treats zero, malformed and impossible deadlines as unusable, rather than overdue', () => {
  const resources = ['0', 'not-a-date', '2026-02-30', '2026-02-30T12:00:00Z', null].map((dueAt, i) => resource({ id: i + 1, externalResourceId: `r${i}`, dueAt }));
  const request = { raw: 'due:none', scope: { kind: 'everywhere' } as const, now: '2026-11-21T00:00:00Z', timeZone: 'UTC' };
  expect(searchDesktop(request, { courses: [course], resources }).files.map(r => r.id)).toEqual([1, 2, 3, 4, 5]);
});
