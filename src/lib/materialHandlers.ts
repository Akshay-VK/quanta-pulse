import type { Resource } from './types';

/** Legacy public view callbacks; material execution belongs to the shared context. */
export interface MaterialRowHandlers {
  onOpen: (url: string) => void;
  onOpenLocal?: (id: number) => void;
  onDownloadOpen?: (id: number) => void;
  onPreview?: (resource: Resource) => void;
}
