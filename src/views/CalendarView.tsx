import { useState } from 'react';
import ActivityCalendar, { type CalendarViewProps } from './ActivityCalendar';
import AgendaView from './AgendaView';
import { ViewTabs } from '../components/ui/Tabs';
import type { DueState } from '../hooks/useAttention';
import type { DueFilter } from '../lib/types';

export type { CalendarViewProps } from './ActivityCalendar';
export default function CalendarView(props: CalendarViewProps & { due: DueState; dueFilter: DueFilter; setDueFilter: (filter: DueFilter) => void; now: Date; timeZone: string; onChanged?: () => Promise<void> }) {
  const [mode, setMode] = useState('agenda');
  return <><ViewTabs ariaLabel="Calendar views" value={mode} onChange={value => { props.details.clear(); setMode(value); }} items={[{ id: 'agenda', label: 'Agenda' }, { id: 'activity', label: 'Activity calendar' }]} />
    {mode === 'agenda' ? <AgendaView due={props.due} filter={props.dueFilter} setFilter={props.setDueFilter} courses={props.courses} now={props.now} timeZone={props.timeZone} details={props.details} onOpen={props.onOpen} onOpenLocal={props.onOpenLocal} onDownloadOpen={props.onDownloadOpen} onPreview={props.onPreview} onOpenCourse={props.onOpenCourse} onChanged={props.onChanged} /> : <ActivityCalendar {...props} />}
  </>;
}
