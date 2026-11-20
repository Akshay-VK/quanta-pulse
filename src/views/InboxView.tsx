import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Clock, Inbox, ListFilter, SlidersHorizontal, X } from 'lucide-react';
import GroupHeader from '../components/GroupHeader';
import { INBOX_HINTS, WorkspaceViewHeader, WorkspaceViewStatus } from '../components/WorkspaceViewChrome';
import { Popover } from '../components/ui/Popover';
import { CoursePill } from '../components/ui/CoursePill';
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
import { dueSoon, localDateKey } from '../lib/agenda';
import { eventKindMeta, localDayKey, longDayLabel } from '../lib/events';
import { courseTitle } from '../lib/courseName';
import type { DetailsAdapter } from '../lib/details';
import type { InboxState, DueState } from '../hooks/useAttention';
import type { Course, InboxFilter, InboxItem, Resource } from '../lib/types';
import type { MaterialRowHandlers } from '../lib/materialHandlers';
import { getListNavigationIntent, recoverFocusedId } from '../lib/listNavigation';
import { formatTimeOfDay } from '../lib/format';
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

export default function InboxView({ inbox, due, courses, resources, storedCount, baseline, contextError, details, now, timeZone, onOpenCourse, onAgenda, onLibrary, onSync, onChanged, onHistory, lastScan, headerActions }: MaterialRowHandlers & {
  inbox: InboxState; due: DueState; courses: Course[]; resources: Resource[]; storedCount: number; baseline: boolean; contextError: string | null;
  details: DetailsAdapter; now: Date; timeZone: string;
  onOpen: (url: string) => void; onOpenLocal: (id: number) => void; onOpenCourse: (id: number) => void;
  onHistory?: () => void; lastScan?: string | null; headerActions?: ReactNode;
  onAgenda: () => void; onLibrary: () => void; onSync: () => void; onChanged: () => Promise<void>;
}) {
  const { filter, setFilter, page, pending, error, countError } = inbox;
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [dueOnly, setDueOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [capture, setCapture] = useState<{ ids: readonly number[]; action: 'read' | 'dismiss'; scope: string; allMatching: boolean; items?: InboxItem[] } | null>(null);
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
  const items = dueOnly ? [] : page?.items ?? [];
  const today = localDateKey(now, timeZone);
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const groups = new Map<string, InboxItem[]>();
  for (const item of items) {
    const key = localDayKey(item.latestEvent.detectedAt, timeZone);
    const group = key === today ? 'Today' : key === yesterday ? 'Yesterday' : key ? longDayLabel(key) : 'Date unavailable';
    const rows = groups.get(group) ?? [];
    rows.push(item);
    groups.set(group, rows);
  }
  const rowTime = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' });
  const dueDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  const dueTime = new Intl.DateTimeFormat('en-IN', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
  const count = (value?: number) => countError ? '–' : value;
  const scanLabel = lastScan ? formatTimeOfDay(lastScan) : null;
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
      else focusSearch();
    }
    setMultiSelected(old => {
      const retained = [...old].filter(id => ids.includes(id));
      return retained.length === old.size ? old : new Set(retained);
    });
  }, [ids.join('\u0000'), focusedId, pending, capture]);
  function focusSearch() {
    setFilterOpen(true);
    searchRef.current?.focus();
  }
  function focusRow(id: string) {
    setFocusedId(id);
    rowRefs.current.get(id)?.focus();
  }
  useEffect(() => {
    if (pending || error || !page || !selected) return;
    if (selected.kind === 'change' && !page.items.some(item => item.eventIds.includes(selected.change.id))) details.clear();
  }, [page, selected, details.clear, pending, error]);
  function capturedItems(eventIds: readonly number[]) {
    const scope = new Set(eventIds);
    return items.filter(item => item.eventIds.some(id => scope.has(id)));
  }
  async function activate(action: 'read' | 'dismiss') {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMutationError(null);
    const scope: InboxFilter = action === 'read' ? { ...filter, attention: 'unread' } : { ...filter };
    try {
      const ids = await api.snapshotInboxEventIds(scope);
      setCapture({ ids: Object.freeze([...ids]), action, scope: inboxScope(scope), allMatching: true, items: capturedItems(ids) });
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
  async function toggle(item: InboxItem, read = item.unread) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await mutate([...item.eventIds], read); } catch { /* visible error; retained data */ }
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
      const frozenFilter = Object.freeze({ ...filter, attention: 'unread' as const });
      const keyState = {
        focusedId: currentFocusedId, selectedIds: [...multiSelected], editableTarget, nestedControl,
        activeSurface: true, modalOpen, isComposing: event.nativeEvent.isComposing,
        imeKeyCode229: event.keyCode === 229, repeat: event.repeat, defaultPrevented: false,
        shiftKey: true, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey,
      };
      void api.snapshotInboxEventIds(frozenFilter).then(eventIds => {
        const intent = getListNavigationIntent({ ids, inspectedId,
          key: event.key, ...keyState, completeEventIds: eventIds });
        if (intent?.type === 'openCapturedScope') setCapture({ ids: Object.freeze([...intent.eventIds]), action: 'read', scope: inboxScope(frozenFilter), allMatching: true, items: capturedItems(intent.eventIds) });
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
  return <div className="inbox-view workspace-view" onKeyDown={event => {
    if (event.key === '/' && !(event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]'))) {
      event.preventDefault();
      focusSearch();
      return;
    }
    handleListKeyDown(event);
  }}>
    <WorkspaceViewHeader title="Inbox" actions={headerActions} tabs={
      <FilterTabs ariaLabel="Inbox attention" value={dueOnly ? 'due' : filter.attention ?? 'all'} items={[
        { id: 'unread', label: 'Unread', count: count(typeFiltered ? page?.unreadTotal : inbox.global?.unreadTotal) },
        { id: 'all', label: 'All', count: count(inbox.global?.total) },
        { id: 'due', label: 'Due soon', count: count(due.items ? soon.length : undefined) },
      ]} onChange={attention => {
        details.clear();
        setDueOnly(attention === 'due');
        if (attention !== 'due') setFilter({ ...filter, attention: attention as 'all' | 'unread' });
      }} />
    } />
    <div className="filter-bar workspace-view-toolbar">
      <div className="filter-bar-left">
        <Popover align="start" open={filterOpen} onOpenChange={setFilterOpen} label="Filter Inbox" role="search" trigger={<Button data-view-search size="sm" variant="ghost" leadingIcon={<ListFilter aria-hidden="true" />}>Filter</Button>}>
          <div className="workspace-toolbar-menu">
            <SearchField inputRef={searchRef} autoFocus value={filter.search ?? ''} onChange={search => setFilter({ ...filter, search: search || undefined })} label="Search Inbox" placeholder="Search changes…" />
            <Select ariaLabel="Filter by change type" value={filter.changeType ?? 'all'} options={CHANGE_OPTIONS} onValueChange={value => {
              setFilterOpen(false);
              setFilter({ ...filter, changeType: value === 'all' ? undefined : value as InboxFilter['changeType'] });
            }} />
            <FilterTabs ariaLabel="Change attention filter" value={filter.attention ?? 'all'} items={[{ id: 'unread', label: 'Unread' }, { id: 'all', label: 'All' }]} onChange={attention => {
              setDueOnly(false);
              setFilterOpen(false);
              setFilter({ ...filter, attention: attention as 'all' | 'unread' });
            }} />
          </div>
        </Popover>
        <span className="workspace-filter-chip"><span>Status</span>{filter.attention === 'unread' ? 'Unread' : 'All'}</span>
        <div className="workspace-filter-selector"><span>Course</span><Select ariaLabel="Filter by course" value={String(filter.courseId ?? 'all')} options={[{ value: 'all', label: 'All courses' }, ...courses.map(c => ({ value: String(c.id), label: courseTitle(c.id, c.shortName ?? c.name) }))]} onValueChange={value => setFilter({ ...filter, courseId: value === 'all' ? undefined : Number(value) })} /></div>
        {filter.changeType && <span className="workspace-filter-chip"><span>Change</span>{eventKindMeta(filter.changeType).label}<button type="button" aria-label="Remove change filter" onClick={() => setFilter({ ...filter, changeType: undefined })}><X aria-hidden="true" /></button></span>}
        {filter.search && <span className="workspace-filter-chip"><span>Search</span><span className="workspace-filter-query">“{filter.search}”</span><button type="button" aria-label="Remove search filter" onClick={() => setFilter({ ...filter, search: undefined })}><X aria-hidden="true" /></button></span>}
        {filtered && <Button size="sm" variant="ghost" onClick={() => setFilter({})}>Clear filters</Button>}
      </div>
      <div className="filter-bar-right">
        <Popover open={displayOpen} onOpenChange={setDisplayOpen} label="Inbox display and actions" trigger={<Button size="sm" variant="ghost" leadingIcon={<SlidersHorizontal aria-hidden="true" />} aria-label="Inbox display">Display</Button>}>
          <div className="workspace-toolbar-menu">
            <Button variant="ghost" size="sm" disabled={busy || capture !== null || dueOnly || !page?.unreadTotal} onClick={() => { setDisplayOpen(false); void activate('read'); }}>{filtered ? 'Mark filtered results read' : 'Mark all Inbox items read'}</Button>
            <Button variant="ghost" size="sm" disabled={busy || capture !== null || dueOnly || !page?.total} onClick={() => { setDisplayOpen(false); void activate('dismiss'); }}>{filtered ? 'Dismiss filtered results…' : 'Dismiss all Inbox items…'}</Button>
          </div>
        </Popover>
      </div>
    </div>
    {pending && page && <span role="status" className="sr-only">Refreshing Inbox…</span>}
    {error && <Banner kind="warning" action={{ label: 'Retry Inbox', onClick: () => void inbox.refresh() }}>{page ? <>Couldn’t refresh Inbox. Showing saved results{scanLabel ? ` from ${scanLabel}` : ''}.</> : 'Could not load Inbox.'} {error}</Banner>}
    {countError && <Banner kind="info" action={{ label: 'Retry counts', onClick: () => void inbox.refresh() }}>Sidebar counts may be out of date. {error ? 'The list shows the last results.' : 'The list below is current.'}</Banner>}
    {contextError && <Banner kind="error" action={{ label: 'Retry course information', onClick: () => void onChanged() }}>Course information could not refresh. {contextError}</Banner>}
    {mutationError && !capture && <Banner kind="error">{mutationError}</Banner>}
    {due.error && <Banner kind="info" action={{ label: 'Retry due dates', onClick: () => void due.refresh() }}>{due.items ? 'Due soon is showing saved dates.' : 'Due soon could not load.'}</Banner>}
    {soon.length > 0 && (dueOnly || !typeFiltered || Boolean(page?.items.length)) && <section className="inbox-deadlines" aria-label="Due soon">
      {(dueOnly ? soon : soon.slice(0, 1)).map(entry => {
        const hasTime = entry.item.dateKind !== 'date';
        const date = entry.group === 'Today' ? 'today' : entry.group === 'Tomorrow' ? 'tomorrow' : dueDate.format(new Date(`${entry.day}T12:00:00Z`));
        const hours = Math.floor((entry.sort - now.getTime()) / 3_600_000);
        const countdown = hours < 1 ? '<1h' : hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
        return <div key={entry.item.resource.externalResourceId} className="inbox-due-banner">
          <Clock aria-hidden="true" />
          <span className="inbox-due-title">{entry.item.resource.title}</span>
          <span className="inbox-due-date">due {date}{hasTime && `, ${dueTime.format(new Date(entry.sort))}`}{entry.item.resource.availabilityStatus !== 'available' ? ' · Source unavailable' : ''}</span>
          {entry.item.resource.courseId && <CoursePill courseId={entry.item.resource.courseId} code={courseTitle(entry.item.resource.courseId, entry.item.resource.courseName)} />}
          <span className="inbox-due-spacer" />
          {hasTime && <span className="inbox-due-countdown">in {countdown}</span>}
          <Button variant="ghost" size="sm" onClick={event => details.selectResource(entry.item.resource, event.currentTarget)}>Open <kbd>Enter</kbd></Button>
        </div>;
      })}
      {dueOnly && <Button variant="ghost" size="sm" onClick={onAgenda}>View Agenda</Button>}
    </section>}
    <div className="workspace-view-list">
    {dueOnly ? (!soon.length && due.items ? <EmptyState title="No upcoming deadlines" body="Upcoming due dates found on Quanta appear here." action={{ label: 'View Agenda', onClick: onAgenda }} /> : null)
      : !page && pending ? <Skeleton rows={5} /> : !page ? null : !page.items.length ? <div className="workspace-view-empty">
      <span className="workspace-empty-icon" aria-hidden="true"><Inbox /></span>
      <EmptyState
        title={contextError && !courses.length ? 'Course information unavailable' : typeFiltered ? 'No matches' : !courses.length ? 'No courses yet' : baseline ? 'First scan complete' : !storedCount ? 'Nothing tracked yet' : 'You’re all caught up'}
        body={typeFiltered ? filter.search ? `Nothing in your Inbox matches “${filter.search}” with these filters.` : 'Nothing in your Inbox matches these filters.' : baseline ? `First scan recorded ${storedCount} ${storedCount === 1 ? 'file' : 'files'} as known. Existing material is in Library; later changes appear here.` : filter.attention === 'unread' ? `No unread changes.${scanLabel ? ` Pulse last scanned Quanta at ${scanLabel}.` : ''}` : 'New changes appear here after a successful scan.'}
        action={typeFiltered ? { label: 'Clear filters', onClick: () => setFilter({}) } : storedCount ? { label: 'Open Library', onClick: onLibrary } : { label: 'Sync now', onClick: onSync }}
        secondaryAction={onHistory && storedCount > 0 && !typeFiltered ? { label: 'View History', onClick: onHistory } : undefined}
      />
    </div> : [...groups].map(([group, groupItems]) => <section key={group}>
      <GroupHeader label={group} count={groupItems.length} />
      {groupItems.map(item => {
        const event = item.latestEvent;
        const resource = resources.find(r => r.id === item.resourceId);
        const title = event.resourceTitle ?? event.title;
        const inspected = selected?.kind === 'change' && item.eventIds.includes(selected.change.id);
        const unavailable = resource ? resource.availabilityStatus !== 'available' : event.changeType === 'unavailable';
        const status = unavailable ? { kind: 'unavailable' as const, label: 'Source unavailable' }
          : item.eventIds.length > 1 ? { kind: 'note' as const, label: `${item.eventIds.length} changes` }
          : { kind: event.changeType === 'announcement' ? 'note' as const : event.changeType === 'new' ? 'new' as const : 'updated' as const, label: eventKindMeta(event.changeType).label };
        const detectedAt = new Date(event.detectedAt);
        return <div className="attention-item" key={item.key}><ResourceRow workspaceVariant="inbox" title={title} type={event.resourceType} courseId={item.courseId} courseName={event.courseName}
          courseCode={courseTitle(item.courseId, courses.find(course => course.id === item.courseId)?.shortName ?? event.courseName)}
          sectionLabel={event.sectionPath?.[0] ?? resource?.sectionPath?.[0] ?? resource?.section}
          unread={item.unread} selected={inspected} unavailable={unavailable} status={unavailable || typeFiltered ? status : null}
          timeLabel={Number.isNaN(detectedAt.getTime()) ? '–' : rowTime.format(detectedAt)}
          resource={resource ?? null} recorded={event}
          keyboardFocused={currentFocusedId === item.key} multiSelected={multiSelected.has(item.key)} showFocusHint={currentFocusedId === item.key && !inspected}
          tabStop={currentFocusedId === item.key || (!currentFocusedId && ids[0] === item.key)}
          selectRef={node => setRowRef(item.key, node)} onKeyboardFocus={() => setFocusedId(item.key)}
          onSelect={origin => details.selectChange(event, origin, resource ?? null)}
          onCourse={item.courseId ? () => onOpenCourse(item.courseId!) : undefined}
          menu={[
            { id: 'read', label: 'Mark as read', shortcut: 'E', disabled: busy || capture !== null || !item.unread, onSelect: () => void toggle(item, true) },
            { id: 'unread', label: 'Mark as unread', shortcut: 'U', disabled: busy || capture !== null || !item.eventIds.length, onSelect: () => void toggle(item, false) },
            { id: 'dismiss', label: 'Dismiss', shortcut: 'Del', danger: true, disabled: busy || capture !== null, onSelect: () => {
              if (lock.current) return;
              lock.current = true;
              setCapture({ ids: Object.freeze([...item.eventIds]), action: 'dismiss', scope: title, allMatching: false });
            } },
          ]}
        />
        <Button className="inbox-row-selection" variant="ghost" size="sm" aria-pressed={multiSelected.has(item.key)}
          aria-label={`${multiSelected.has(item.key) ? 'Remove' : 'Add'} ${title} from bulk selection`}
          disabled={busy || capture !== null} onClick={() => setMultiSelected(previous => {
            const next = new Set(previous);
            if (next.has(item.key)) next.delete(item.key);
            else next.add(item.key);
            return next;
          })}><Check aria-hidden="true" /></Button>
        </div>;
      })}
    </section>)}
    {!dueOnly && page && page.items.length < page.total && <Button className="workspace-load-more" size="sm" variant="secondary" disabled={pending} onClick={inbox.loadMore}>Load more Inbox items</Button>}
    </div>
    <WorkspaceViewStatus hints={INBOX_HINTS}>{dueOnly ? `${soon.length} upcoming deadlines` : page ? `${page.total} changes · ${countError ? '– unread' : `${page.unreadTotal} unread`}${error ? ' · last refresh failed' : scanLabel ? ` · scanned ${scanLabel}` : ''}` : 'Inbox'}</WorkspaceViewStatus>
    <ConfirmDialog open={capture !== null} scopeList={Boolean(capture?.items?.length)} onOpenChange={open => { if (!open) { setCapture(null); lock.current = false; setMutationError(null); if (currentFocusedId && ids.includes(currentFocusedId)) rowRefs.current.get(currentFocusedId)?.focus(); else focusSearch(); } }} title={capture?.action === 'dismiss' ? 'Dismiss captured Inbox items?' : 'Mark captured Inbox items read?'}
      body={<><p>{capture?.scope}. Captured {capture?.ids.length ?? 0} recorded changes{capture?.allMatching ? ' across all matching items, including unloaded pages' : ' from the focused or selected items'}. New arrivals stay untouched.</p><p>{capture?.action === 'dismiss' ? 'Removes these changes from Inbox. History and saved files remain.' : 'Updates attention state only. History remains.'}</p>{capture?.items && capture.items.length > 0 && <ul className="inbox-capture-list">
        {capture.items.slice(0, 5).map(item => <li key={item.key}>
          <span>{item.latestEvent.resourceTitle ?? item.latestEvent.title}</span>
          {item.courseId != null && <CoursePill courseId={item.courseId} code={courseTitle(item.courseId)} />}
        </li>)}
        {capture.items.length > 5 && <li>+{capture.items.length - 5} more loaded items</li>}
      </ul>}{mutationError && <p role="alert">{mutationError}</p>}</>}
      confirmLabel={capture?.action === 'dismiss' ? 'Dismiss captured items' : 'Mark captured items read'} destructive={capture?.action === 'dismiss'} onConfirm={async () => { if (capture) await mutate([...capture.ids], capture.action === 'dismiss' ? 'dismiss' : true); }} />
  </div>;
}
