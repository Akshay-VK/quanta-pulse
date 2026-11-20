import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronRight, Clock, ListFilter, SlidersHorizontal } from 'lucide-react';
import { AGENDA_GROUPS, agendaEntries, localDateKey } from '../lib/agenda';
import type { DueState } from '../hooks/useAttention';
import type { DetailsAdapter } from '../lib/details';
import type { Course } from '../lib/types';
import { courseTitle } from '../lib/courseName';
import type { MaterialRowHandlers } from '../lib/materialHandlers';
import GroupHeader from '../components/GroupHeader';
import { AGENDA_HINTS, WorkspaceViewStatus } from '../components/WorkspaceViewChrome';
import { formatTimeOfDay } from '../lib/format';
import ResourceRow from '../components/ResourceRow';
import ConfirmDialog from '../components/ConfirmDialog';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { SearchField } from '../components/ui/SearchField';
import { Banner } from '../components/ui/Banner';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import type { DueFilter } from '../lib/types';
import { api } from '../lib/api';
import { getListNavigationIntent, recoverFocusedId } from '../lib/listNavigation';
import { useMaterialActions } from '../hooks/useMaterialActions';

type AgendaCapture = {
  ids: readonly number[];
  action: 'read' | 'unread' | 'dismiss';
  scope: string;
  allMatching: boolean;
  generation: number;
};

export default function AgendaView({ due, filter, setFilter, courses, now, timeZone, details, onOpenCourse, onChanged, onLibrary, lastScan }: MaterialRowHandlers & {
  due: DueState; filter: DueFilter; setFilter: (filter: DueFilter) => void; courses: Course[];
  now: Date; timeZone: string; details: DetailsAdapter; onOpen: (url: string) => void; onOpenLocal?: (id: number) => void; onOpenCourse?: (id: number) => void;
  onChanged?: () => Promise<void>; onLibrary?: () => void; lastScan?: string | null;
}) {
  const today = localDateKey(now, timeZone);
  const weekStart = Date.parse(`${today}T12:00:00Z`);
  const dayFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  const weekdayFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' });
  const timeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const scanLabel = lastScan ? formatTimeOfDay(lastScan) : null;
  const entries = agendaEntries(due.items ?? [], now, timeZone);
  const [expanded, setExpanded] = useState(false);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [multiSelected, setMultiSelected] = useState<Set<string>>(() => new Set());
  const [capture, setCapture] = useState<AgendaCapture | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const requestGeneration = useRef(0);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const previousIds = useRef<string[]>([]);
  const hadListFocus = useRef(false);
  const actionsFor = useMaterialActions();
  const selected = details.selected;
  const inspectedId = selected?.kind === 'resource' ? selected.resource.externalResourceId : null;
  const displayedByGroup = new Map(AGENDA_GROUPS.map(group => {
    const items = entries.filter(entry => entry.group === group);
    return [group, group === 'Past due dates' && !expanded ? [] : items.slice(0, limits[group] ?? 20)];
  }));
  const displayedEntries = AGENDA_GROUPS.flatMap(group => displayedByGroup.get(group) ?? []);
  const ids = displayedEntries.map(entry => entry.item.resource.externalResourceId);
  const currentFocusedId = focusedId && ids.includes(focusedId) ? focusedId : null;
  const completeResourceIds = [...new Set(entries.map(entry => entry.item.resource.id))];
  const setRowRef = useCallback((id: string, node: HTMLButtonElement | null) => {
    if (node) rowRefs.current.set(id, node);
    else rowRefs.current.delete(id);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestGeneration.current += 1; };
  }, []);
  useEffect(() => {
    setLimits({});
    requestGeneration.current += 1;
    if (lock.current) lock.current = false;
    setCapture(null);
    setActionError(null);
  }, [filter]);
  useEffect(() => {
    if (due.pending) return;
    const previous = previousIds.current;
    const next = ids;
    const recovered = recoverFocusedId(previous, next, focusedId);
    const removedFocused = focusedId !== null && !next.includes(focusedId);
    previousIds.current = next;
    if (removedFocused) {
      setFocusedId(recovered);
      if (!document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        if (recovered) rowRefs.current.get(recovered)?.focus();
        else searchRef.current?.focus();
      }
    } else if (!document.querySelector('[role="dialog"], [role="alertdialog"]') && hadListFocus.current && focusedId && next.includes(focusedId) && !rootRef.current?.contains(document.activeElement)) {
      rowRefs.current.get(focusedId)?.focus();
    }
    setMultiSelected(old => {
      const retained = [...old].filter(id => next.includes(id));
      return retained.length === old.size ? old : new Set(retained);
    });
  }, [ids.join('\u0000'), focusedId, due.pending]);
  useEffect(() => {
    if (!due.pending && !due.error && due.items && selected?.kind === 'resource' && !due.items.some(item => item.resource.externalResourceId === selected.resource.externalResourceId)) details.clear();
  }, [due.items, due.pending, due.error, selected, details.clear]);

  function focusRow(id: string) {
    hadListFocus.current = true;
    setFocusedId(id);
    rowRefs.current.get(id)?.focus();
  }
  function returnFocus() {
    if (currentFocusedId && ids.includes(currentFocusedId)) rowRefs.current.get(currentFocusedId)?.focus();
    else searchRef.current?.focus();
  }
  async function mutate(eventIds: readonly number[], action: 'dismiss' | boolean) {
    const generation = requestGeneration.current;
    if (!eventIds.length) return;
    setActionError(null);
    try {
      if (action === 'dismiss') await api.dismissInboxEvents([...eventIds]);
      else await api.setEventReadState([...eventIds], action);
      await due.refresh();
      await onChanged?.();
    } catch (error) {
      if (mounted.current && generation === requestGeneration.current) setActionError(`Agenda action failed: ${String(error)}`);
      throw error;
    }
  }
  function eventGuards(event: React.KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    const element = target instanceof Element ? target : null;
    const editableTarget = Boolean(element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
    const nestedControl = Boolean(element?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="menu"], [role="menuitem"], [role="dialog"], [role="alertdialog"], a, button:not(.row-select)'));
    const modalOpen = capture !== null || Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));
    return { editableTarget, nestedControl, modalOpen };
  }
  function keyState(event: React.KeyboardEvent<HTMLDivElement>, completeEventIds: readonly number[]) {
    const { editableTarget, nestedControl, modalOpen } = eventGuards(event);
    return {
      ids, focusedId: currentFocusedId, inspectedId, selectedIds: [...multiSelected], key: event.key,
      activeSurface: Boolean(rootRef.current?.contains(document.activeElement)), editableTarget, nestedControl, modalOpen,
      isComposing: event.nativeEvent.isComposing, imeKeyCode229: event.keyCode === 229, repeat: event.repeat,
      defaultPrevented: event.defaultPrevented, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey,
      altKey: event.altKey, metaKey: event.metaKey, completeEventIds,
    };
  }
  function beginCapture(resourceIds: readonly number[], action: 'read' | 'unread' | 'dismiss', scope: string, allMatching: boolean, generation: number) {
    if (lock.current) return;
    lock.current = true;
    setActionError(null);
    setActionNotice(null);
    const frozenResources = Object.freeze([...new Set(resourceIds)]);
    void api.snapshotResourceEventIds([...frozenResources]).then(eventIds => {
      if (!mounted.current || generation !== requestGeneration.current || filterRef.current !== filter) return;
      const captured = Object.freeze([...eventIds]);
      if (action !== 'dismiss' && action !== 'read' && action !== 'unread') return;
      if (action === 'dismiss' || allMatching) {
        setCapture({ ids: captured, action, scope, allMatching, generation });
      } else {
        if (captured.length) void mutate(captured, action === 'read').catch(() => {}).finally(() => {
          if (mounted.current && generation === requestGeneration.current) lock.current = false;
        });
        else {
          setActionNotice(`No eligible event records for ${scope}.`);
          lock.current = false;
        }
      }
    }).catch(error => {
      if (mounted.current && generation === requestGeneration.current && filterRef.current === filter) setActionError(`Could not capture Agenda event scope: ${String(error)}`);
      if (mounted.current && generation === requestGeneration.current) lock.current = false;
    });
  }
  function handleListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const guards = eventGuards(event);
    const activeSurface = Boolean(rootRef.current?.contains(document.activeElement));
    if (!activeSurface) return;
    const generation = requestGeneration.current;
    const shiftA = event.key.toLowerCase() === 'a' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
    if (shiftA) {
      const intent = getListNavigationIntent({ ...keyState(event, []), activeSurface });
      if (intent?.type !== 'openCapturedScope') return;
      event.preventDefault(); event.stopPropagation();
      if (lock.current) return;
      const frozenResourceIds = Object.freeze([...completeResourceIds]);
      lock.current = true; setActionError(null); setActionNotice(null);
      void api.snapshotResourceEventIds([...frozenResourceIds]).then(eventIds => {
        if (!mounted.current || generation !== requestGeneration.current || filterRef.current !== filter) return;
        const capturedIntent = getListNavigationIntent({
          ids, focusedId: currentFocusedId, inspectedId, selectedIds: [...multiSelected], key: event.key,
          activeSurface, editableTarget: guards.editableTarget, nestedControl: guards.nestedControl,
          modalOpen: guards.modalOpen, isComposing: event.nativeEvent.isComposing, imeKeyCode229: event.keyCode === 229,
          repeat: event.repeat, defaultPrevented: false, shiftKey: true, ctrlKey: event.ctrlKey,
          altKey: event.altKey, metaKey: event.metaKey, completeEventIds: eventIds,
        });
        if (capturedIntent?.type === 'openCapturedScope') {
          setCapture({ ids: Object.freeze([...capturedIntent.eventIds]), action: 'read', scope: `${frozenResourceIds.length} resources in the current filtered Agenda`, allMatching: true, generation });
        } else lock.current = false;
      }).catch(error => {
        if (mounted.current && generation === requestGeneration.current) setActionError(`Could not capture Agenda event scope: ${String(error)}`);
        if (mounted.current && generation === requestGeneration.current) lock.current = false;
      });
      return;
    }
    const intent = getListNavigationIntent({ ...keyState(event, []) });
    if (!intent) return;
    event.preventDefault(); event.stopPropagation();
    if (intent.type === 'focus') focusRow(intent.id);
    else if (intent.type === 'toggleSelection') {
      hadListFocus.current = true;
      setMultiSelected(old => { const next = new Set(old); if (next.has(intent.id)) next.delete(intent.id); else next.add(intent.id); return next; });
    } else if (intent.type === 'inspect') {
      const entry = displayedEntries.find(candidate => candidate.item.resource.externalResourceId === intent.id);
      const origin = rowRefs.current.get(intent.id);
      if (entry && origin) details.selectResource(entry.item.resource, origin);
    } else if (intent.type === 'preview') {
      const entry = displayedEntries.find(candidate => candidate.item.resource.externalResourceId === intent.id);
      if (entry) actionsFor?.(entry.item.resource).find(action => action.id === 'preview')?.onSelect?.();
    } else if (intent.type === 'setReadState' || intent.type === 'confirmDelete') {
      if (lock.current) return;
      const resourceIds = intent.ids.flatMap(id => {
        const entry = displayedEntries.find(candidate => candidate.item.resource.externalResourceId === id);
        return entry ? [entry.item.resource.id] : [];
      });
      const action = intent.type === 'confirmDelete' ? 'dismiss' : intent.isRead ? 'read' : 'unread';
      const scope = `${resourceIds.length} focused or selected Agenda ${resourceIds.length === 1 ? 'resource' : 'resources'}`;
      beginCapture(resourceIds, action, scope, false, generation);
    }
  }

  const filtered = Boolean(filter.courseId || filter.resourceType || filter.search);
  const paused = courses.find(course => course.id === filter.courseId && course.monitoringStatus === 'paused');
  function jumpToToday() {
    const item = displayedByGroup.get('Today')?.[0] ?? displayedEntries[0];
    if (item) focusRow(item.item.resource.externalResourceId);
    else rootRef.current?.querySelector<HTMLElement>('.agenda-week [aria-current="date"]')?.focus();
  }
  async function resumeMonitoring(courseId: number) {
    if (resuming) return;
    setResuming(true);
    setActionError(null);
    try {
      await api.setMonitoring(courseId, 'monitored');
      await onChanged?.();
      await due.refresh();
    } catch (error) {
      setActionError(`Could not resume monitoring: ${String(error)}`);
    } finally {
      setResuming(false);
    }
  }
  return <div ref={rootRef} className="agenda-view workspace-view-body" onKeyDown={event => {
    const guards = eventGuards(event);
    if (!guards.editableTarget && !guards.modalOpen && !event.altKey && !event.metaKey && !event.ctrlKey) {
      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        jumpToToday();
        return;
      }
    }
    handleListKeyDown(event);
  }}>
    <div className="filter-bar workspace-view-toolbar"><div className="filter-bar-left">
      <Button variant="ghost" size="sm" leadingIcon={<ListFilter aria-hidden="true" />} onClick={() => searchRef.current?.focus()}>Filter</Button>
      <div className="workspace-filter-selector"><span>Course</span><Select ariaLabel="Agenda course" value={String(filter.courseId ?? 'all')} options={[{ value: 'all', label: 'All courses' }, ...courses.map(c => ({ value: String(c.id), label: `${courseTitle(c.id, c.shortName ?? c.name)}${c.monitoringStatus === 'paused' ? ' (paused)' : ''}` }))]} onValueChange={value => { details.clear(); setFilter({ ...filter, courseId: value === 'all' ? undefined : Number(value) }); }} /></div>
      <SearchField className="workspace-local-search" inputRef={searchRef} label="Search Agenda" value={filter.search ?? ''} onChange={search => { details.clear(); setFilter({ ...filter, search: search || undefined }); }} placeholder="Search due dates…" />
      {filtered && <Button size="sm" variant="ghost" onClick={() => { details.clear(); setFilter({}); }}>Clear Agenda filters</Button>}
    </div><div className="filter-bar-right">
      <div className="workspace-filter-selector workspace-view-selector"><SlidersHorizontal aria-hidden="true" />
      <Select ariaLabel="Agenda resource type" value={filter.resourceType ?? 'all'} options={[{ value: 'all', label: 'View' }, ...['assignment', 'quiz', 'event', 'page', 'pdf', 'url'].map(value => ({ value, label: value }))]} onValueChange={value => { details.clear(); setFilter({ ...filter, resourceType: value === 'all' ? undefined : value }); }} /></div>
    </div></div>
    {due.pending && due.items && <span role="status" className="sr-only">Refreshing Agenda…</span>}
    {paused && <Banner kind="warning" action={{ label: resuming ? 'Resuming…' : 'Resume monitoring', onClick: () => void resumeMonitoring(paused.id) }}>Monitoring is paused for {courseTitle(paused.id, paused.shortName ?? paused.name)}. Dates shown may be out of date.</Banner>}
    {due.error && <Banner kind="warning" action={{ label: 'Retry Agenda', onClick: () => void due.refresh() }}>{due.items ? `Showing saved dates${scanLabel ? ` from ${scanLabel}` : ''}. Couldn’t refresh.` : 'Could not load Agenda.'} {due.error}</Banner>}
    {actionError && !capture && <Banner kind="error">{actionError}</Banner>}
    {actionNotice && <Banner kind="info">{actionNotice}</Banner>}
    <div className="agenda-week" aria-label="Upcoming seven days">
      {Array.from({ length: 7 }, (_, index) => {
        const date = new Date(weekStart + index * 86_400_000);
        const day = date.toISOString().slice(0, 10);
        const count = entries.filter(entry => entry.day === day && entry.group !== 'Past due dates').length;
        return <button key={day} type="button" className="agenda-week-day" aria-current={index === 0 ? 'date' : undefined}
          aria-label={`${weekdayFormatter.format(date)} ${dayFormatter.format(date)}, ${count} deadlines`}
          onClick={() => {
            const item = displayedEntries.find(entry => entry.day === day && entry.group !== 'Past due dates');
            if (item) focusRow(item.item.resource.externalResourceId);
          }}>
          <span>{weekdayFormatter.format(date).toUpperCase()}</span><strong>{date.getUTCDate()}</strong>
          <span className="agenda-week-dot" aria-hidden="true" data-deadline={count > 0 || undefined} />
        </button>;
      })}
    </div>
    <div className="workspace-view-list">
    {!due.items && due.pending ? <Skeleton rows={5} /> : due.items && !entries.length ? <div className="workspace-view-empty"><span className="workspace-empty-icon" aria-hidden="true"><CalendarDays /></span><EmptyState title={filtered ? 'No matching due dates' : 'No known deadlines'} body={filtered ? 'Try another filter.' : 'Pulse shows due dates found on Quanta. Check Quanta directly if you expect one.'} action={!filtered && onLibrary ? { label: 'Open Library', onClick: onLibrary } : undefined} /></div> : AGENDA_GROUPS.map(group => {
      const items = entries.filter(entry => entry.group === group);
      if (!items.length) return null;
      const limit = limits[group] ?? 20;
      const past = group === 'Past due dates';
      const shownItems = displayedByGroup.get(group) ?? [];
      const day = items[0].day;
      const groupTitle = group === 'Today' || group === 'Tomorrow' ? `${group} · ${dayFormatter.format(new Date(`${day}T12:00:00Z`))}` : past ? 'Past dates' : group;
      return <section key={group} className="agenda-group" aria-label={group}>
        {past ? <button className="agenda-collapse" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />} {groupTitle} <span>{items.length}</span></button> : <GroupHeader label={groupTitle} count={items.length} />}
        {(!past || expanded) && <>{shownItems.map(entry => {
          const resource = entry.item.resource;
          const id = resource.externalResourceId;
          const isFocused = currentFocusedId === id;
          const hours = Math.ceil((entry.sort - now.getTime()) / 3_600_000);
          const countdown = entry.item.dateKind === 'date' || entry.group === 'Past due dates' ? null : hours < 24 ? `in ${hours}h` : `in ${Math.floor(hours / 24)}d`;
          const dueTime = entry.item.dateKind === 'date' ? entry.label : group === 'Today' || group === 'Tomorrow'
            ? timeFormatter.format(new Date(entry.sort))
            : `${dayFormatter.format(new Date(`${entry.day}T12:00:00Z`))}, ${timeFormatter.format(new Date(entry.sort))}`;
          return <div key={id} className="agenda-entry"><ResourceRow workspaceVariant="agenda" leadingIcon={<Clock className={countdown && hours < 24 ? "agenda-due-soon-icon" : undefined} aria-hidden="true" />} title={resource.title} type={resource.resourceType} courseId={resource.courseId} courseCode={courseTitle(resource.courseId, resource.courseName)} courseName={resource.courseName}
            unread={false} selected={selected?.kind === 'resource' && selected.resource.externalResourceId === id}
            unavailable={resource.availabilityStatus !== 'available'} status={resource.availabilityStatus !== 'available' ? { kind: 'unavailable', label: 'Source unavailable' } : entry.item.coursePaused ? { kind: 'note', label: 'Course paused' } : null}
            timeLabel={dueTime} timeSuffix={countdown && <span className="agenda-countdown" data-soon={hours < 24 || undefined}>{countdown}</span>}
            resource={resource} onSelect={origin => details.selectResource(resource, origin)}
            keyboardFocused={isFocused} multiSelected={multiSelected.has(id)} showFocusHint={isFocused}
            tabStop={isFocused || (!currentFocusedId && ids[0] === id)} selectRef={node => setRowRef(id, node)}
            onKeyboardFocus={() => { hadListFocus.current = true; setFocusedId(id); }}
            onCourse={resource.courseId && onOpenCourse ? () => onOpenCourse(resource.courseId!) : undefined} menu={[]}
          /></div>;
        })}{items.length > limit && <Button size="sm" variant="ghost" onClick={() => { setLimits(current => ({ ...current, [group]: limit + 20 })); if (currentFocusedId) requestAnimationFrame(() => rowRefs.current.get(currentFocusedId)?.focus()); }}>Show more {group.toLowerCase()}</Button>}</>}
      </section>;
    })}
    </div>
    <WorkspaceViewStatus hints={AGENDA_HINTS}>{due.items && `${entries.length} dated resources · `}{due.error && scanLabel && `Dates from ${scanLabel} · stale · `}Submission status is not tracked.</WorkspaceViewStatus>
    <ConfirmDialog open={capture !== null} onOpenChange={open => {
      if (!open && capture?.generation === requestGeneration.current) { setCapture(null); lock.current = false; setActionError(null); setTimeout(() => { if (mounted.current) returnFocus(); }, 0); }
    }} title={capture?.action === 'dismiss' ? 'Dismiss captured Agenda resources?' : capture?.action === 'unread' ? 'Mark captured Agenda resources unread?' : 'Mark captured Agenda resources read?'}
      body={<><p>{capture?.scope}. Captured {capture?.ids.length ?? 0} recorded changes{capture?.allMatching ? ', including hidden Agenda items' : ''}. New arrivals stay untouched.</p>
        {capture?.action === 'dismiss' ? <p>Dismissal affects Inbox only. History and saved files remain, and due dates remain in Agenda.</p> : <p>Updates attention state only. History and due dates remain.</p>}
        {capture && capture.ids.length === 0 && <p>No eligible event records were captured; confirming will not change anything.</p>}
        {actionError && <p role="alert">{actionError}</p>}</>}
      confirmLabel={capture?.action === 'dismiss' ? 'Dismiss captured resources' : capture?.action === 'unread' ? 'Mark captured resources unread' : 'Mark captured resources read'}
      destructive={capture?.action === 'dismiss'} onConfirm={async () => { if (capture?.ids.length) await mutate(capture.ids, capture.action === 'dismiss' ? 'dismiss' : capture.action === 'read'); }} />
  </div>;
}
