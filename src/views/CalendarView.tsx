import { useState, type ReactNode } from 'react';
import ActivityCalendar, { type CalendarViewProps } from './ActivityCalendar';
import AgendaView from './AgendaView';
import { WorkspaceViewHeader } from '../components/WorkspaceViewChrome';
import { ViewTabs } from '../components/ui/Tabs';
import type { DueState } from '../hooks/useAttention';
import type { DueFilter } from '../lib/types';

export type { CalendarViewProps } from './ActivityCalendar';
export default function CalendarView(props: CalendarViewProps & { due: DueState; assignmentStatus?: string; dueFilter: DueFilter; setDueFilter: (filter: DueFilter) => void; now: Date; timeZone: string; onChanged?: () => Promise<void>; onLibrary?: () => void; lastScan?: string | null; headerActions?: ReactNode }) {
  const [mode, setMode] = useState('agenda');
  return <div className="workspace-view calendar-view"><WorkspaceViewHeader title="Calendar" actions={props.headerActions} tabs={<ViewTabs ariaLabel="Calendar views" value={mode} onChange={value => { props.details.clear(); setMode(value); }} items={[{ id: 'agenda', label: 'Agenda' }, { id: 'activity', label: 'Activity', accessibleLabel: 'Activity calendar' }]} />} />
    {mode === 'agenda' ? <AgendaView due={props.due} assignmentStatus={props.assignmentStatus} filter={props.dueFilter} setFilter={props.setDueFilter} courses={props.courses} now={props.now} timeZone={props.timeZone} details={props.details} onOpen={props.onOpen} onOpenLocal={props.onOpenLocal} onDownloadOpen={props.onDownloadOpen} onPreview={props.onPreview} onOpenCourse={props.onOpenCourse} onChanged={props.onChanged} onLibrary={props.onLibrary} lastScan={props.lastScan} /> : <ActivityCalendar {...props} />}
  </div>;
}
