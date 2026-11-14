import { useEffect, useState } from 'react';
import { AGENDA_GROUPS, agendaEntries } from '../lib/agenda';
import type { DueState } from '../hooks/useAttention';
import type { DetailsAdapter } from '../lib/details';
import type { Course } from '../lib/types';
import { courseTitle } from '../lib/courseName';
import type { MaterialRowHandlers } from '../lib/materialHandlers';
import PageHeader from '../components/PageHeader';
import ResourceRow from '../components/ResourceRow';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { SearchField } from '../components/ui/SearchField';
import { Banner } from '../components/ui/Banner';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import type { DueFilter } from '../lib/types';

export default function AgendaView({ due, filter, setFilter, courses, now, timeZone, details, onOpenCourse }: MaterialRowHandlers & {
  due: DueState; filter: DueFilter; setFilter: (filter: DueFilter) => void; courses: Course[];
  now: Date; timeZone: string; details: DetailsAdapter; onOpen: (url: string) => void; onOpenLocal?: (id: number) => void; onOpenCourse?: (id: number) => void;
}) {
  const entries = agendaEntries(due.items ?? [], now, timeZone);
  const [expanded, setExpanded] = useState(false);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const selected = details.selected;
  useEffect(() => {
    if (!due.pending && !due.error && due.items && selected?.kind === 'resource' && !due.items.some(item => item.resource.externalResourceId === selected.resource.externalResourceId)) details.clear();
  }, [due.items, due.pending, due.error, selected, details.clear]);
  useEffect(() => { setLimits({}); }, [filter]);
  const filtered = Boolean(filter.courseId || filter.resourceType || filter.search);
  return <div className="agenda-view">
    <PageHeader title="Agenda" summary={`Actual course due dates · ${timeZone}`} />
    <div className="filter-bar"><div className="filter-bar-left">
      <Select ariaLabel="Agenda course" value={String(filter.courseId ?? 'all')} options={[{ value: 'all', label: 'Monitored courses' }, ...courses.map(c => ({ value: String(c.id), label: `${courseTitle(c.id, c.name)}${c.monitoringStatus === 'paused' ? ' (paused)' : ''}` }))]} onValueChange={value => { details.clear(); setFilter({ ...filter, courseId: value === 'all' ? undefined : Number(value) }); }} />
      <Select ariaLabel="Agenda resource type" value={filter.resourceType ?? 'all'} options={[{ value: 'all', label: 'All resource types' }, ...['assignment', 'quiz', 'event', 'page', 'pdf', 'url'].map(value => ({ value, label: value }))]} onValueChange={value => { details.clear(); setFilter({ ...filter, resourceType: value === 'all' ? undefined : value }); }} />
    </div><div className="filter-bar-right"><SearchField label="Search Agenda" value={filter.search ?? ''} onChange={search => { details.clear(); setFilter({ ...filter, search: search || undefined }); }} placeholder="Search due dates…" />{filtered && <Button size="sm" variant="ghost" onClick={() => { details.clear(); setFilter({}); }}>Clear Agenda filters</Button>}</div></div>
    <p className="result-count">{due.items ? `${entries.length} dated resources` : 'Loading due dates…'} · Dates do not indicate submission status. Confirm status in Quanta.</p>
    {due.pending && due.items && <p role="status" className="result-count">Refreshing Agenda…</p>}
    {due.error && <Banner kind="error" action={{ label: 'Retry Agenda', onClick: () => void due.refresh() }}>{due.items ? 'Showing saved dates. Agenda could not refresh.' : 'Could not load Agenda.'} {due.error}</Banner>}
    {!due.items && due.pending ? <Skeleton rows={5} /> : due.items && !entries.length ? <EmptyState title={filtered ? 'No matching due dates' : 'No due dates recorded'} body={filtered ? 'Try another filter.' : 'Only actual due dates from monitored courses appear here. Detection dates are in Activity calendar.'} /> : AGENDA_GROUPS.map(group => {
      const items = entries.filter(entry => entry.group === group);
      if (!items.length) return null;
      const limit = limits[group] ?? 20;
      const past = group === 'Past due dates';
      return <section key={group} className="agenda-group" aria-label={group}>
        <div className="attention-section-title">{past ? <button className="agenda-collapse" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '▾' : '▸'} {group} <span className="result-count">{items.length}</span></button> : <h2>{group} <span className="result-count">{items.length}</span></h2>}</div>
        {(!past || expanded) && <>{items.slice(0, limit).map(entry => {
          const resource = entry.item.resource;
          return <div key={resource.externalResourceId} className="agenda-entry"><ResourceRow title={resource.title} type={resource.resourceType} courseId={resource.courseId} courseCode={courseTitle(resource.courseId, resource.courseName)} courseName={resource.courseName}
            unread={false} selected={selected?.kind === 'resource' && selected.resource.externalResourceId === resource.externalResourceId}
            unavailable={resource.availabilityStatus !== 'available'} status={resource.availabilityStatus !== 'available' ? { kind: 'unavailable', label: 'Source unavailable' } : entry.item.coursePaused ? { kind: 'note', label: 'Course paused' } : null}
            timeLabel={`${entry.label}${entry.item.dateKind === 'date' ? ' (date only)' : ''}`}
            resource={resource} onSelect={origin => details.selectResource(resource, origin)}
             
            onCourse={resource.courseId && onOpenCourse ? () => onOpenCourse(resource.courseId!) : undefined}
            menu={[]} />
          </div>;
        })}{items.length > limit && <Button size="sm" variant="ghost" onClick={() => setLimits(current => ({ ...current, [group]: limit + 20 }))}>Show more {group.toLowerCase()}</Button>}</>}
      </section>;
    })}
  </div>;
}
