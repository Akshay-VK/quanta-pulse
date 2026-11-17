import { useCallback, useEffect, useRef, useState } from 'react';
import PageHeader from '../components/PageHeader';
import ResourceRow from '../components/ResourceRow';
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
import type { MaterialRowHandlers } from '../lib/materialHandlers';
import { getListNavigationIntent, recoverFocusedId } from '../lib/listNavigation';
import { useMaterialActions } from '../hooks/useMaterialActions';

export const CHANGE_OPTIONS = [
  { value: 'all', label: 'All types' }, { value: 'new', label: 'New files' },
  { value: 'updated', label: 'Updates' }, { value: 'announcement', label: 'Announcements' },
  { value: 'deadline', label: 'Deadlines' }, { value: 'unavailable', label: 'Unavailable' },
  { value: 'restored', label: 'Restored' },
];
export function inboxScope(filter: InboxFilter): string {
  return [filter.attention === 'unread' ? 'unread items' : 'all items', filter.courseId ? `course ${courseTitle(filter.courseId)}` : 'all courses', filter.changeType ? CHANGE_OPTIONS.find(o => o.value === filter.changeType)?.label : 'all types', filter.search ? `search “${filter.search}”` : ''].filter(Boolean).join(', ');
}

export default function InboxView({ inbox, due, courses, resources, storedCount, baseline, contextError, details, now, timeZone, onOpenCourse, onAgenda, onLibrary, onSync, onChanged }: MaterialRowHandlers & {
  inbox: InboxState; due: DueState; courses: Course[]; resources: Resource[]; storedCount: number; baseline: boolean; contextError: string | null;
  details: DetailsAdapter; now: Date; timeZone: string;
  onOpen: (url: string) => void; onOpenLocal: (id: number) => void; onOpenCourse: (id: number) => void;
  onAgenda: () => void; onLibrary: () => void; onSync: () => void; onChanged: () => Promise<void>;
}) {
  const { filter, setFilter, page, pending, error, countError } = inbox;
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [capture, setCapture] = useState<{ ids: readonly number[]; action: 'read' | 'dismiss'; scope: string; allMatching: boolean } | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [multiSelected, setMultiSelected] = useState<Set<string>>(() => new Set());
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const previousIds = useRef<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const actionsFor = useMaterialActions();
  const filtered = Boolean(filter.attention === 'unread' || filter.courseId || filter.changeType || filter.search);
  const typeFiltered = Boolean(filter.courseId || filter.changeType || filter.search);
  const soon = dueSoon(due.items ?? [], now, timeZone);
  const selected = details.selected;
  const items = page?.items ?? [];
  const ids = items.map(item => item.key);
  const inspectedId = selected?.kind === 'change' ? items.find(item => item.eventIds.includes(selected.change.id))?.key ?? null : null;
  const currentFocusedId = focusedId && ids.includes(focusedId) ? focusedId : null;
  const setRowRef = useCallback((id: string, node: HTMLButtonElement | null) => {
    if (node) rowRefs.current.set(id, node);
    else rowRefs.current.delete(id);
  }, []);
  useEffect(() => {
    if (pending) return;
    const previous = previousIds.current;
    const recovered = recoverFocusedId(previous, ids, focusedId);
    const removedFocused = focusedId !== null && !ids.includes(focusedId);
    previousIds.current = ids;
    if (removedFocused && !capture) {
      setFocusedId(recovered);
      if (recovered) rowRefs.current.get(recovered)?.focus();
      else searchRef.current?.focus();
    }
    setMultiSelected(old => {
      const retained = [...old].filter(id => ids.includes(id));
      return retained.length === old.size ? old : new Set(retained);
    });
  }, [ids.join('\u0000'), focusedId, pending, capture]);
  function focusRow(id: string) {
    setFocusedId(id);
    rowRefs.current.get(id)?.focus();
  }
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
      setCapture({ ids: Object.freeze([...ids]), action, scope: inboxScope(scope), allMatching: true });
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
  function handleListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    const element = target instanceof Element ? target : null;
    const rowSelect = element?.closest('.row-select');
    const editableTarget = Boolean(element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
    const nestedControl = Boolean(element?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="menu"], [role="menuitem"], [role="dialog"], [role="alertdialog"], a, button:not(.row-select)'));
    const modalOpen = capture !== null || Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));
    if (event.key.toLowerCase() === 'a' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey &&
      !editableTarget && !nestedControl && !modalOpen && !event.nativeEvent.isComposing && event.keyCode !== 229 && !event.repeat && !event.defaultPrevented &&
      event.currentTarget.contains(document.activeElement)) {
      event.preventDefault(); event.stopPropagation();
      if (lock.current) return;
      lock.current = true; setBusy(true); setMutationError(null);
      const frozenFilter = Object.freeze({ ...filter });
      const keyState = {
        focusedId: currentFocusedId, selectedIds: [...multiSelected], editableTarget, nestedControl,
        activeSurface: true, modalOpen, isComposing: event.nativeEvent.isComposing,
        imeKeyCode229: event.keyCode === 229, repeat: event.repeat, defaultPrevented: false,
        shiftKey: true, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey,
      };
      void api.snapshotInboxEventIds(frozenFilter).then(eventIds => {
        const intent = getListNavigationIntent({ ids, inspectedId,
          key: event.key, ...keyState, completeEventIds: eventIds });
        if (intent?.type === 'openCapturedScope') setCapture({ ids: Object.freeze([...intent.eventIds]), action: 'read', scope: inboxScope(frozenFilter), allMatching: true });
        else lock.current = false;
      }).catch(err => { setMutationError(`Could not capture Inbox scope: ${String(err)}`); lock.current = false; }).finally(() => setBusy(false));
      return;
    }
    const intent = getListNavigationIntent({
      ids, focusedId: currentFocusedId, inspectedId,
      selectedIds: [...multiSelected], key: event.key, activeSurface: event.currentTarget.contains(document.activeElement),
      editableTarget, nestedControl, modalOpen,
      isComposing: event.nativeEvent.isComposing, imeKeyCode229: event.keyCode === 229, repeat: event.repeat,
      defaultPrevented: event.defaultPrevented, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey,
      altKey: event.altKey, metaKey: event.metaKey, completeEventIds: [],
    });
    // The row's own native select button receives focus; its Enter intent is
    // routed here exactly once and prevented from synthesizing a second click.
    if (!intent || !rowSelect && intent.type !== 'openCapturedScope') return;
    event.preventDefault(); event.stopPropagation();
    if (intent.type === 'focus') focusRow(intent.id);
    else if (intent.type === 'inspect') {
      const item = items.find(candidate => candidate.key === intent.id);
      if (item) details.selectChange(item.latestEvent, rowRefs.current.get(item.key) ?? document.activeElement as HTMLButtonElement, resources.find(r => r.id === item.resourceId) ?? null);
    } else if (intent.type === 'toggleSelection') {
      setMultiSelected(old => { const next = new Set(old); if (next.has(intent.id)) next.delete(intent.id); else next.add(intent.id); return next; });
    } else if (intent.type === 'setReadState') {
      const eventIds = items.filter(item => intent.ids.includes(item.key)).flatMap(item => item.eventIds);
      if (!lock.current && eventIds.length) {
        lock.current = true; setBusy(true);
        void mutate(eventIds, intent.isRead).catch(() => {}).finally(() => { lock.current = false; setBusy(false); });
      }
    } else if (intent.type === 'confirmDelete') {
      const eventIds = items.filter(item => intent.ids.includes(item.key)).flatMap(item => item.eventIds);
      if (!lock.current && eventIds.length) { lock.current = true; setCapture({ ids: Object.freeze([...eventIds]), action: 'dismiss', scope: `${intent.ids.length} selected Inbox ${intent.ids.length === 1 ? 'item' : 'items'}`, allMatching: false }); }
    } else if (intent.type === 'preview') {
      const item = items.find(candidate => candidate.key === intent.id);
      if (item) {
        const resource = resources.find(r => r.id === item.resourceId) ?? null;
        actionsFor?.(resource, item.latestEvent).find(action => action.id === 'preview')?.onSelect?.();
      }
    } else if (intent.type === 'openCapturedScope') void activate('read');
  }
  return <div className="inbox-view" onKeyDown={handleListKeyDown}>
    <PageHeader title="Inbox" summary="Course changes, ready when you are" actions={<>
      <Button variant="ghost" size="sm" disabled={busy || capture !== null || !page?.unreadTotal} onClick={() => void activate('read')}>{filtered ? 'Mark filtered results read' : 'Mark all Inbox items read'}</Button>
      <Button variant="ghost" size="sm" disabled={busy || capture !== null || !page?.total} onClick={() => void activate('dismiss')}>{filtered ? 'Dismiss filtered results…' : 'Dismiss all Inbox items…'}</Button>
    </>} />
    <div className="filter-bar">
      <div className="filter-bar-left"><FilterTabs ariaLabel="Inbox attention" value={filter.attention ?? 'all'} items={[{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }]} onChange={attention => setFilter({ ...filter, attention: attention as 'all' | 'unread' })} />
        <Select ariaLabel="Filter by change type" value={filter.changeType ?? 'all'} options={CHANGE_OPTIONS} onValueChange={value => setFilter({ ...filter, changeType: value === 'all' ? undefined : value as InboxFilter['changeType'] })} />
        <Select ariaLabel="Filter by course" value={String(filter.courseId ?? 'all')} options={[{ value: 'all', label: 'All courses' }, ...courses.map(c => ({ value: String(c.id), label: courseTitle(c.id, c.name) }))]} onValueChange={value => setFilter({ ...filter, courseId: value === 'all' ? undefined : Number(value) })} />
      </div>
      <div className="filter-bar-right"><SearchField inputRef={searchRef} value={filter.search ?? ''} onChange={search => setFilter({ ...filter, search: search || undefined })} label="Search Inbox" placeholder="Search changes…" />{filtered && <Button size="sm" variant="ghost" onClick={() => setFilter({})}>Clear filters</Button>}</div>
    </div>
    {page && <p className="result-count">{page.items.length} shown of {page.total} matching items · {countError ? '–' : page.unreadTotal} unread</p>}
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
        <ResourceRow title={title} type={event.resourceType} courseId={item.courseId} courseName={event.courseName} courseCode={courseTitle(item.courseId, event.courseName)}
          unread={item.unread} selected={selected?.kind === 'change' && item.eventIds.includes(selected.change.id)} unavailable={resource ? resource.availabilityStatus !== 'available' : event.changeType === 'unavailable'}
          status={resource?.availabilityStatus !== undefined && resource.availabilityStatus !== 'available' ? { kind: 'unavailable', label: 'Source unavailable' } : { kind: event.changeType === 'announcement' ? 'note' : event.changeType === 'new' ? 'new' : 'updated', label: item.eventIds.length > 1 ? `${item.eventIds.length} changes` : eventKindMeta(event.changeType).label }}
          timeLabel={new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(event.detectedAt))}
          resource={resource ?? null} recorded={event}
          keyboardFocused={currentFocusedId === item.key} multiSelected={multiSelected.has(item.key)} showFocusHint={currentFocusedId === item.key}
          tabStop={currentFocusedId === item.key || (!currentFocusedId && ids[0] === item.key)}
          selectRef={node => setRowRef(item.key, node)}
          onKeyboardFocus={() => setFocusedId(item.key)}
          onSelect={origin => details.selectChange(event, origin, resource ?? null)}
           
          onCourse={item.courseId ? () => onOpenCourse(item.courseId!) : undefined}
          menu={[{ id: 'read', label: item.unread ? 'Mark as read' : 'Mark as unread', disabled: busy || capture !== null, onSelect: () => void toggle(item) }]}
        />
        <Button className="attention-multiselect" size="sm" variant="ghost" aria-pressed={multiSelected.has(item.key)} aria-label={`${multiSelected.has(item.key) ? 'Remove' : 'Add'} ${title} from bulk selection`} disabled={busy || capture !== null} onClick={() => setMultiSelected(old => { const next = new Set(old); if (next.has(item.key)) next.delete(item.key); else next.add(item.key); return next; })}>{multiSelected.has(item.key) ? 'Selected' : 'Select'}</Button>
        <Button className="attention-read" size="sm" variant="ghost" aria-label={item.unread ? 'Mark item read' : 'Mark item unread'} disabled={busy || capture !== null} onClick={() => void toggle(item)}>{item.unread ? 'Mark read' : 'Mark unread'}</Button>
      </div>;
    })}
    {page && page.items.length < page.total && <Button size="sm" variant="secondary" disabled={pending} onClick={inbox.loadMore}>Load more Inbox items</Button>}
    {due.error && <Banner kind="info" action={{ label: 'Retry due dates', onClick: () => void due.refresh() }}>{due.items ? 'Due soon is showing saved dates.' : 'Due soon could not load.'}</Banner>}
    {soon.length > 0 && <section className="due-soon" aria-label="Due soon"><div className="attention-section-title"><h2>Due soon</h2><Button variant="ghost" size="sm" onClick={onAgenda}>View agenda</Button></div>
      <p className="result-count">Next seven local days · {timeZone}</p>
      {soon.map(entry => <button key={entry.item.resource.externalResourceId} className="due-soon-row" onClick={event => details.selectResource(entry.item.resource, event.currentTarget)}><span>{entry.item.resource.title}</span><span>{entry.label}{entry.item.resource.availabilityStatus !== 'available' ? ' · Source unavailable' : ''}</span></button>)}
    </section>}
    <ConfirmDialog open={capture !== null} onOpenChange={open => { if (!open) { setCapture(null); lock.current = false; setMutationError(null); if (currentFocusedId && ids.includes(currentFocusedId)) rowRefs.current.get(currentFocusedId)?.focus(); else searchRef.current?.focus(); } }} title={capture?.action === 'dismiss' ? 'Dismiss captured Inbox items?' : 'Mark captured Inbox items read?'}
      body={<><p>{capture?.scope}. Captured {capture?.ids.length ?? 0} recorded changes{capture?.allMatching ? ' across all matching items, including unloaded pages' : ' from the focused or selected items'}. New arrivals stay untouched.</p><p>{capture?.action === 'dismiss' ? 'Removes these changes from Inbox. History and saved files remain.' : 'Updates attention state only. History remains.'}</p>{mutationError && <p role="alert">{mutationError}</p>}</>}
      confirmLabel={capture?.action === 'dismiss' ? 'Dismiss captured items' : 'Mark captured items read'} destructive={capture?.action === 'dismiss'} onConfirm={async () => { if (capture) await mutate([...capture.ids], capture.action === 'dismiss' ? 'dismiss' : true); }} />
  </div>;
}
