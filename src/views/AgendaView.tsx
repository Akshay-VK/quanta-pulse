import { useCallback, useEffect, useRef, useState } from 'react';
import { AGENDA_GROUPS, agendaEntries } from '../lib/agenda';
import type { DueState } from '../hooks/useAttention';
import type { DetailsAdapter } from '../lib/details';
import type { Course } from '../lib/types';
import { courseTitle } from '../lib/courseName';
import type { MaterialRowHandlers } from '../lib/materialHandlers';
import PageHeader from '../components/PageHeader';
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

export default function AgendaView({ due, filter, setFilter, courses, now, timeZone, details, onOpenCourse, onChanged }: MaterialRowHandlers & {
  due: DueState; filter: DueFilter; setFilter: (filter: DueFilter) => void; courses: Course[];
  now: Date; timeZone: string; details: DetailsAdapter; onOpen: (url: string) => void; onOpenLocal?: (id: number) => void; onOpenCourse?: (id: number) => void;
  onChanged?: () => Promise<void>;
}) {
  const entries = agendaEntries(due.items ?? [], now, timeZone);
  const [expanded, setExpanded] = useState(false);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [multiSelected, setMultiSelected] = useState<Set<string>>(() => new Set());
  const [capture, setCapture] = useState<AgendaCapture | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
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
  return <div ref={rootRef} className="agenda-view" onKeyDown={handleListKeyDown}>
    <PageHeader title="Agenda" summary={`Actual course due dates · ${timeZone}`} />
    <div className="filter-bar"><div className="filter-bar-left">
      <Select ariaLabel="Agenda course" value={String(filter.courseId ?? 'all')} options={[{ value: 'all', label: 'Monitored courses' }, ...courses.map(c => ({ value: String(c.id), label: `${courseTitle(c.id, c.name)}${c.monitoringStatus === 'paused' ? ' (paused)' : ''}` }))]} onValueChange={value => { details.clear(); setFilter({ ...filter, courseId: value === 'all' ? undefined : Number(value) }); }} />
      <Select ariaLabel="Agenda resource type" value={filter.resourceType ?? 'all'} options={[{ value: 'all', label: 'All resource types' }, ...['assignment', 'quiz', 'event', 'page', 'pdf', 'url'].map(value => ({ value, label: value }))]} onValueChange={value => { details.clear(); setFilter({ ...filter, resourceType: value === 'all' ? undefined : value }); }} />
    </div><div className="filter-bar-right"><SearchField inputRef={searchRef} label="Search Agenda" value={filter.search ?? ''} onChange={search => { details.clear(); setFilter({ ...filter, search: search || undefined }); }} placeholder="Search due dates…" />{filtered && <Button size="sm" variant="ghost" onClick={() => { details.clear(); setFilter({}); }}>Clear Agenda filters</Button>}</div></div>
    <p className="result-count">{due.items ? `${entries.length} dated resources` : 'Loading due dates…'} · Dates do not indicate submission status. Confirm status in Quanta.</p>
    {due.pending && due.items && <p role="status" className="result-count">Refreshing Agenda…</p>}
    {due.error && <Banner kind="error" action={{ label: 'Retry Agenda', onClick: () => void due.refresh() }}>{due.items ? 'Showing saved dates. Agenda could not refresh.' : 'Could not load Agenda.'} {due.error}</Banner>}
    {actionError && !capture && <Banner kind="error">{actionError}</Banner>}
    {actionNotice && <Banner kind="info">{actionNotice}</Banner>}
    {!due.items && due.pending ? <Skeleton rows={5} /> : due.items && !entries.length ? <EmptyState title={filtered ? 'No matching due dates' : 'No due dates recorded'} body={filtered ? 'Try another filter.' : 'Only actual due dates from monitored courses appear here. Detection dates are in Activity calendar.'} /> : AGENDA_GROUPS.map(group => {
      const items = entries.filter(entry => entry.group === group);
      if (!items.length) return null;
      const limit = limits[group] ?? 20;
      const past = group === 'Past due dates';
      const shownItems = displayedByGroup.get(group) ?? [];
      return <section key={group} className="agenda-group" aria-label={group}>
        <div className="attention-section-title">{past ? <button className="agenda-collapse" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '▾' : '▸'} {group} <span className="result-count">{items.length}</span></button> : <h2>{group} <span className="result-count">{items.length}</span></h2>}</div>
        {(!past || expanded) && <>{shownItems.map(entry => {
          const resource = entry.item.resource;
          const id = resource.externalResourceId;
          const isFocused = currentFocusedId === id;
          return <div key={id} className="agenda-entry"><ResourceRow title={resource.title} type={resource.resourceType} courseId={resource.courseId} courseCode={courseTitle(resource.courseId, resource.courseName)} courseName={resource.courseName}
            unread={false} selected={selected?.kind === 'resource' && selected.resource.externalResourceId === id}
            unavailable={resource.availabilityStatus !== 'available'} status={resource.availabilityStatus !== 'available' ? { kind: 'unavailable', label: 'Source unavailable' } : entry.item.coursePaused ? { kind: 'note', label: 'Course paused' } : null}
            timeLabel={`${entry.label}${entry.item.dateKind === 'date' ? ' (date only)' : ''}`}
            resource={resource} onSelect={origin => details.selectResource(resource, origin)}
            keyboardFocused={isFocused} multiSelected={multiSelected.has(id)} showFocusHint={isFocused}
            tabStop={isFocused || (!currentFocusedId && ids[0] === id)} selectRef={node => setRowRef(id, node)}
            onKeyboardFocus={() => { hadListFocus.current = true; setFocusedId(id); }}
            onCourse={resource.courseId && onOpenCourse ? () => onOpenCourse(resource.courseId!) : undefined} menu={[]}
          /></div>;
        })}{items.length > limit && <Button size="sm" variant="ghost" onClick={() => { setLimits(current => ({ ...current, [group]: limit + 20 })); if (currentFocusedId) requestAnimationFrame(() => rowRefs.current.get(currentFocusedId)?.focus()); }}>Show more {group.toLowerCase()}</Button>}</>}
      </section>;
    })}
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
