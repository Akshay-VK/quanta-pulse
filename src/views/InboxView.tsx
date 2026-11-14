import { useEffect, useRef, useState } from 'react';
import PageHeader from '../components/PageHeader';
import MaterialResourceRow from '../components/MaterialResourceRow';
import ConfirmDialog from '../components/ConfirmDialog';
import { Button } from '../components/ui/Button';
import { FilterTabs } from '../components/ui/Tabs';
import { SearchField } from '../components/ui/SearchField';
import { Select } from '../components/ui/Select';
import { EmptyState } from '../components/ui/EmptyState';
import { Banner } from '../components/ui/Banner';
import { Skeleton } from '../components/ui/Skeleton';
import { api } from '../lib/api';
import { dueSoon } from '../lib/agenda';
import { eventKindMeta } from '../lib/events';
import { courseTitle } from '../lib/courseName';
import type { DetailsAdapter } from '../lib/details';
import type { InboxState, DueState } from '../hooks/useAttention';
import type { Course, InboxFilter, InboxItem, Resource } from '../lib/types';
import type { MaterialRowHandlers } from '../components/MaterialResourceRow';

export const CHANGE_OPTIONS = [
  { value: 'all', label: 'All types' }, { value: 'new', label: 'New files' },
  { value: 'updated', label: 'Updates' }, { value: 'announcement', label: 'Announcements' },
  { value: 'deadline', label: 'Deadlines' }, { value: 'unavailable', label: 'Unavailable' },
  { value: 'restored', label: 'Restored' },
];
export function inboxScope(filter: InboxFilter): string {
  return [filter.attention === 'unread' ? 'unread items' : 'all items', filter.courseId ? `course ${courseTitle(filter.courseId)}` : 'all courses', filter.changeType ? CHANGE_OPTIONS.find(o => o.value === filter.changeType)?.label : 'all types', filter.search ? `search “${filter.search}”` : ''].filter(Boolean).join(', ');
}

export default function InboxView({ inbox, due, courses, resources, storedCount, baseline, contextError, details, now, timeZone, onOpen, onOpenLocal, onDownloadOpen, onPreview, onOpenCourse, onAgenda, onLibrary, onSync, onChanged }: MaterialRowHandlers & {
  inbox: InboxState; due: DueState; courses: Course[]; resources: Resource[]; storedCount: number; baseline: boolean; contextError: string | null;
  details: DetailsAdapter; now: Date; timeZone: string;
  onOpen: (url: string) => void; onOpenLocal: (id: number) => void; onOpenCourse: (id: number) => void;
  onAgenda: () => void; onLibrary: () => void; onSync: () => void; onChanged: () => Promise<void>;
}) {
  const { filter, setFilter, page, pending, error, countError } = inbox;
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [capture, setCapture] = useState<{ ids: number[]; action: 'read' | 'dismiss'; scope: string } | null>(null);
  const filtered = Boolean(filter.attention === 'unread' || filter.courseId || filter.changeType || filter.search);
  const typeFiltered = Boolean(filter.courseId || filter.changeType || filter.search);
  const soon = dueSoon(due.items ?? [], now, timeZone);
  const selected = details.selected;
  useEffect(() => {
    if (pending || error || !page || !selected) return;
    if (selected.kind === 'change' && !page.items.some(item => item.eventIds.includes(selected.change.id))) details.clear();
  }, [page, selected, details.clear, pending, error]);
  async function activate(action: 'read' | 'dismiss') {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMutationError(null);
    const scope = { ...filter };
    try {
      const ids = await api.snapshotInboxEventIds(scope);
      setCapture({ ids, action, scope: inboxScope(scope) });
    } catch (err) { setMutationError(`Could not capture Inbox scope: ${String(err)}`); lock.current = false; }
    finally { setBusy(false); }
  }
  async function mutate(ids: number[], action: 'dismiss' | boolean) {
    setMutationError(null);
    try {
      if (action === 'dismiss') await api.dismissInboxEvents(ids);
      else await api.setEventReadState(ids, action);
      await onChanged();
    } catch (err) { setMutationError(`Inbox action failed: ${String(err)}`); throw err; }
  }
  async function toggle(item: InboxItem) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await mutate([...item.eventIds], item.unread); } catch { /* visible error; retained data */ }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="inbox-view">
    <PageHeader title="Inbox" summary="Course changes, ready when you are" actions={<>
      <Button variant="ghost" size="sm" disabled={busy || capture !== null || !page?.unreadTotal} onClick={() => void activate('read')}>{filtered ? 'Mark filtered results read' : 'Mark all Inbox items read'}</Button>
      <Button variant="ghost" size="sm" disabled={busy || capture !== null || !page?.total} onClick={() => void activate('dismiss')}>{filtered ? 'Dismiss filtered results…' : 'Dismiss all Inbox items…'}</Button>
    </>} />
    <div className="filter-bar">
      <div className="filter-bar-left"><FilterTabs ariaLabel="Inbox attention" value={filter.attention ?? 'all'} items={[{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }]} onChange={attention => setFilter({ ...filter, attention: attention as 'all' | 'unread' })} />
        <Select ariaLabel="Filter by change type" value={filter.changeType ?? 'all'} options={CHANGE_OPTIONS} onValueChange={value => setFilter({ ...filter, changeType: value === 'all' ? undefined : value as InboxFilter['changeType'] })} />
        <Select ariaLabel="Filter by course" value={String(filter.courseId ?? 'all')} options={[{ value: 'all', label: 'All courses' }, ...courses.map(c => ({ value: String(c.id), label: courseTitle(c.id, c.name) }))]} onValueChange={value => setFilter({ ...filter, courseId: value === 'all' ? undefined : Number(value) })} />
      </div>
      <div className="filter-bar-right"><SearchField value={filter.search ?? ''} onChange={search => setFilter({ ...filter, search: search || undefined })} label="Search Inbox" placeholder="Search changes…" />{filtered && <Button size="sm" variant="ghost" onClick={() => setFilter({})}>Clear filters</Button>}</div>
    </div>
    {page && <p className="result-count">{page.items.length} shown of {page.total} matching items · {page.unreadTotal} unread</p>}
    {pending && page && <p role="status" className="result-count">Refreshing Inbox…</p>}
    {error && <Banner kind="error" action={{ label: 'Retry Inbox', onClick: () => void inbox.refresh() }}>{page ? 'Showing saved results. Inbox could not refresh.' : 'Could not load Inbox.'} {error}</Banner>}
    {countError && <Banner kind="info" action={{ label: 'Retry counts', onClick: () => void inbox.refresh() }}>{countError}. Sidebar counts may be out of date.</Banner>}
    {contextError && <Banner kind="error" action={{ label: 'Retry course information', onClick: () => void onChanged() }}>Course information could not refresh. {contextError}</Banner>}
    {mutationError && !capture && <Banner kind="error">{mutationError}</Banner>}
    {!page && pending ? <Skeleton rows={5} /> : !page ? null : !page.items.length ? <EmptyState
      title={contextError && !courses.length ? 'Course information unavailable' : typeFiltered ? 'No matches' : filter.attention === 'unread' ? 'No unread changes' : !courses.length ? 'No courses yet' : baseline ? 'First scan complete' : !storedCount ? 'Nothing tracked yet' : "You're all caught up"}
      body={typeFiltered ? 'Try another course, type, or search.' : baseline ? `First scan recorded ${storedCount} ${storedCount === 1 ? 'file' : 'files'} as known. Existing material is in Library; later changes appear here.` : 'New changes appear here after a successful scan.'}
      action={filtered ? { label: 'Clear filters', onClick: () => setFilter({}) } : storedCount ? { label: 'Open Library', onClick: onLibrary } : { label: 'Sync now', onClick: onSync }}
    /> : page.items.map(item => {
      const event = item.latestEvent;
      const resource = resources.find(r => r.id === item.resourceId);
      const title = event.resourceTitle ?? event.title;
      return <div className="attention-item" key={item.key}>
        <MaterialResourceRow title={title} type={event.resourceType} courseId={item.courseId} courseName={event.courseName} courseCode={courseTitle(item.courseId, event.courseName)}
          unread={item.unread} selected={selected?.kind === 'change' && item.eventIds.includes(selected.change.id)} unavailable={resource ? resource.availabilityStatus !== 'available' : event.changeType === 'unavailable'}
          status={resource?.availabilityStatus !== undefined && resource.availabilityStatus !== 'available' ? { kind: 'unavailable', label: 'Source unavailable' } : { kind: event.changeType === 'announcement' ? 'note' : event.changeType === 'new' ? 'new' : 'updated', label: item.eventIds.length > 1 ? `${item.eventIds.length} changes` : eventKindMeta(event.changeType).label }}
          timeLabel={new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(event.detectedAt))}
          resource={resource ?? null} recordedUrl={event.resourceUrl ?? event.sourcePageUrl}
          onDownloadOpen={onDownloadOpen} onPreview={onPreview}
          onSelect={origin => details.selectChange(event, origin, resource ?? null)}
          onOpen={onOpen} onOpenLocal={onOpenLocal}
          onCourse={item.courseId ? () => onOpenCourse(item.courseId!) : undefined}
          menu={[{ id: 'read', label: item.unread ? 'Mark as read' : 'Mark as unread', disabled: busy || capture !== null, onSelect: () => void toggle(item) }]}
        />
        <Button className="attention-read" size="sm" variant="ghost" aria-label={item.unread ? 'Mark item read' : 'Mark item unread'} disabled={busy || capture !== null} onClick={() => void toggle(item)}>{item.unread ? 'Mark read' : 'Mark unread'}</Button>
      </div>;
    })}
    {page && page.items.length < page.total && <Button size="sm" variant="secondary" disabled={pending} onClick={inbox.loadMore}>Load more Inbox items</Button>}
    {due.error && <Banner kind="info" action={{ label: 'Retry due dates', onClick: () => void due.refresh() }}>{due.items ? 'Due soon is showing saved dates.' : 'Due soon could not load.'}</Banner>}
    {soon.length > 0 && <section className="due-soon" aria-label="Due soon"><div className="attention-section-title"><h2>Due soon</h2><Button variant="ghost" size="sm" onClick={onAgenda}>View agenda</Button></div>
      <p className="result-count">Next seven local days · {timeZone}</p>
      {soon.map(entry => <button key={entry.item.resource.externalResourceId} className="due-soon-row" onClick={event => details.selectResource(entry.item.resource, event.currentTarget)}><span>{entry.item.resource.title}</span><span>{entry.label}{entry.item.resource.availabilityStatus !== 'available' ? ' · Source unavailable' : ''}</span></button>)}
    </section>}
    <ConfirmDialog open={capture !== null} onOpenChange={open => { if (!open) { setCapture(null); lock.current = false; setMutationError(null); } }} title={capture?.action === 'dismiss' ? 'Dismiss captured Inbox items?' : 'Mark captured Inbox items read?'}
      body={<><p>{capture?.scope}. Captured {capture?.ids.length ?? 0} recorded changes across all matching items, including unloaded pages. New arrivals stay untouched.</p><p>{capture?.action === 'dismiss' ? 'Removes these changes from Inbox. History and saved files remain.' : 'Updates attention state only. History remains.'}</p>{mutationError && <p role="alert">{mutationError}</p>}</>}
      confirmLabel={capture?.action === 'dismiss' ? 'Dismiss captured items' : 'Mark captured items read'} destructive={capture?.action === 'dismiss'} onConfirm={async () => { if (capture) await mutate(capture.ids, capture.action === 'dismiss' ? 'dismiss' : true); }} />
  </div>;
}
