import type { ComponentProps } from 'react';
import ResourceRow from './ResourceRow';
import { useMirror } from '../hooks/useMirror';
import { materialActions } from '../lib/materialActions';
import { isLocal } from '../lib/mirrorState';
import { canPreview } from '../lib/preview';
import type { Resource } from '../lib/types';

/** Execution remains in App, shared by every policy-driven row and inspector. */
export interface MaterialRowHandlers {
  onOpen: (url: string) => void;
  onOpenLocal?: (id: number) => void;
  onDownloadOpen?: (id: number) => void;
  onPreview?: (resource: Resource) => void;
}
type RowProps = Omit<ComponentProps<typeof ResourceRow>, 'openLabel' | 'showOpen' | 'previewAvailable' | 'onOpen' | 'onOpenLocal' | 'onPreview' | 'local' | 'destinations'>;

/** Current resources and recorded-only events cross the same material policy seam. */
export default function MaterialResourceRow({ resource, recordedUrl, onOpen, onOpenLocal, onDownloadOpen, onPreview, ...row }: RowProps & MaterialRowHandlers & {
  resource: Resource | null; recordedUrl?: string | null;
}) {
  const mirror = useMirror();
  const local = resource && !resource.isExternal ? mirror?.statusOf(resource.id) : undefined;
  const destinations = materialActions(resource, {
    preview: Boolean(resource && onPreview && canPreview(resource.resourceType, resource.url)),
    local: isLocal(local) ? 'saved' : local?.status === 'queued' || local?.status === 'downloading' ? 'pending' : 'missing',
    recordedUrl,
  }, !resource).flatMap(action => {
    const onSelect = action.id === 'preview' ? resource && onPreview ? () => onPreview(resource) : null
      : action.id === 'open-saved' ? resource && onOpenLocal ? () => onOpenLocal(resource.id) : null
      : action.id === 'download-open' ? resource && onDownloadOpen ? () => onDownloadOpen(resource.id) : null
      : () => onOpen(resource?.url ?? recordedUrl!);
    return onSelect ? [{ ...action, onSelect }] : [];
  });
  return <ResourceRow {...row} local={local} openLabel="Open in Quanta" destinations={destinations} />;
}
