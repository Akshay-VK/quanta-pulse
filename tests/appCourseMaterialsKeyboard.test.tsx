import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appApi, button, click, deferred, emitAppEvent, flushApp, renderApp, setupApp, resource } from './helpers/renderApp';
let app: Awaited<ReturnType<typeof renderApp>> | undefined;
beforeEach(() => { setupApp(); appApi.snapshotResourceEventIds.mockResolvedValue([10, 11]);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function(this: HTMLElement) { return this.classList.contains('tree-branch') ? 340 : 34; });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(340);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100000);
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable:true, value: function(this: HTMLElement, options: ScrollToOptions) { const before=this.scrollTop; this.scrollTop=options.top ?? this.scrollTop; if(before!==this.scrollTop) queueMicrotask(()=>this.dispatchEvent(new Event('scroll'))); } }); });
afterEach(() => { app?.unmount(); app = undefined; });
async function open() { app = await renderApp(); await click(button('Library')); await click(button('Open MATH F111 library')); }
const row = () => document.querySelector<HTMLElement>('[role="treeitem"][data-row-key^="resource:"]')!;
async function key(value: string, options: KeyboardEventInit = {}, target: Element = document.activeElement!) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options })); });
  await flushApp();
}
describe('Course Materials keyboard in the real App', () => {
  it('keeps focus, selection and inspection separate and uses authoritative read/unread events', async () => {
    appApi.listResources.mockResolvedValue([resource(), resource({id:2,externalResourceId:'r2',title:'Problem set'})]);
    await open(); act(() => row().focus()); await key('x');
    expect(row().classList.contains('multi-selected')).toBe(true);
    expect(document.querySelector('.peek')).toBeNull();
    await key('j'); expect(document.activeElement?.getAttribute('data-row-key')).toBe('resource:r2');
    await key('Enter'); expect(document.querySelector('.peek-title')?.textContent).toBe('Problem set');
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
    act(() => row().focus()); await key('e');
    expect(appApi.snapshotResourceEventIds).toHaveBeenCalledWith([1]);
    expect(appApi.setEventReadState).toHaveBeenCalledWith([10,11],true);
    await key('u'); expect(appApi.setEventReadState).toHaveBeenLastCalledWith([10,11],false);
  });
  it('freezes full atomic deduplicated inventory before a delayed snapshot and excludes later arrivals', async () => {
    const resources = Array.from({length:2005},(_,i)=>resource({id:i+1,externalResourceId:`r${i+1}`,title:`File ${String(i).padStart(4,'0')}`}));
    appApi.listResources.mockImplementation(async () => resources);
    const snapshot=deferred<number[]>(); appApi.snapshotResourceEventIds.mockReturnValue(snapshot.promise);
    await open(); expect(document.querySelectorAll('[role="treeitem"][data-row-key^="resource:"]').length).toBeLessThan(100);
    act(()=>row().focus()); await key('A',{shiftKey:true});
    expect(appApi.snapshotResourceEventIds.mock.calls[0][0]).toEqual(resources.map(r=>r.id));
    resources.push(resource({id:3000,externalResourceId:'arrival',title:'New arrival'}));
    await emitAppEvent('sync:done',{});
    await act(async()=>snapshot.resolve([10,11,8000]));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('2005 materials');
    await click(button('Mark captured changes read'));
    expect(appApi.setEventReadState).toHaveBeenCalledWith([10,11,8000],true);
    expect(appApi.listSearchInventory).toHaveBeenCalled();
    expect(appApi.listResources.mock.calls.every(([filter]) => filter?.courseId === undefined)).toBe(true);
  });
  it('dismisses Inbox only, cancels inertly, focuses Cancel and returns row identity', async()=>{
    await open(); act(()=>row().focus()); await key('Delete');
    expect(document.activeElement?.textContent).toBe('Cancel');
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('baseline are kept');
    await click(button('Cancel')); expect(document.activeElement).toBe(row());
    expect(appApi.dismissInboxEvents).not.toHaveBeenCalled();
    await key('Delete'); await click(button('Dismiss captured changes'));
    expect(appApi.dismissInboxEvents).toHaveBeenCalledWith([10,11]);
    expect(appApi.deleteHistory).not.toHaveBeenCalled(); expect(row()).toBeTruthy();
  });
  it('shows snapshot failures and empty scopes, retries immutable mutation IDs without duplicate capture', async()=>{
    appApi.snapshotResourceEventIds.mockRejectedValueOnce(new Error('snapshot offline')).mockResolvedValueOnce([]).mockResolvedValue([70,71]);
    await open(); act(()=>row().focus()); await key('Delete');
    expect(document.body.textContent).toContain('snapshot offline');
    await key('e'); expect(document.body.textContent).toContain('No eligible recorded changes');
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
    await key('Delete');
    appApi.dismissInboxEvents.mockRejectedValueOnce(new Error('write offline')).mockResolvedValue(undefined);
    await click(button('Dismiss captured changes'));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('write offline');
    await click(button('Dismiss captured changes'));
    expect(appApi.dismissInboxEvents.mock.calls).toEqual([[[70,71]],[[70,71]]]);
    expect(appApi.snapshotResourceEventIds).toHaveBeenCalledTimes(3);
  });
  it('retains successful writes on refresh failure, blocks new actions and retries refresh alone', async()=>{
    await open(); act(()=>row().focus()); await key('Delete');
    appApi.listResources.mockRejectedValue(new Error('inventory offline'));
    await click(button('Dismiss captured changes'));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Changes saved');
    expect(appApi.dismissInboxEvents).toHaveBeenCalledTimes(1);
    appApi.listResources.mockResolvedValue([resource()]);
    await click(button('Retry refresh'));
    expect(appApi.dismissInboxEvents).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
  it('retains inspectable rows while pending or failed and blocks new mutation captures', async()=>{
    await open(); const pending=deferred<ReturnType<typeof resource>[]>(); appApi.listResources.mockReturnValue(pending.promise);
    await emitAppEvent('sync:done',{}); act(()=>row().focus()); await key('e');
    expect(appApi.snapshotResourceEventIds).not.toHaveBeenCalled();
    await key('Enter'); expect(document.querySelector('.peek-title')?.textContent).toBe('Lecture 4');
    await act(async()=>pending.reject(new Error('offline inventory'))); await flushApp();
    act(()=>row().focus()); await key('Delete');
    expect(appApi.snapshotResourceEventIds).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Retry');
  });
  it('guards nested controls, modifiers, repeats, composition, prevented keys and overlays; previews through App',async()=>{
    await open(); act(()=>row().focus());
    for(const options of [{repeat:true},{isComposing:true},{keyCode:229},{ctrlKey:true},{altKey:true},{metaKey:true},{shiftKey:true}]) await key('e',options);
    await key('e',{},button('Show details for Lecture 4'));
    const modal=document.createElement('div'); modal.setAttribute('role','dialog'); document.body.append(modal);
    await key('e'); modal.remove();
    await act(async()=>{const e=new KeyboardEvent('keydown',{key:'e',bubbles:true,cancelable:true});e.preventDefault();row().dispatchEvent(e);});
    expect(appApi.snapshotResourceEventIds).not.toHaveBeenCalled();
    await key(' '); expect(appApi.previewResource).toHaveBeenCalledTimes(1);
    await key('e',{},row()); expect(appApi.snapshotResourceEventIds).not.toHaveBeenCalled();
  });
  for (const outcome of ['success','rejection'] as const) it(`keeps newer capture locked after obsolete snapshot ${outcome}`,async()=>{
    const old=deferred<number[]>(),fresh=deferred<number[]>();
    appApi.snapshotResourceEventIds.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    await open(); act(()=>row().focus()); await key('Delete');
    const search=document.querySelector<HTMLInputElement>('input[aria-label="Search resources in this course"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'Lecture');search.dispatchEvent(new Event('input',{bubbles:true}));});
    act(()=>row().focus()); await key('Delete');
    await act(async()=>{if(outcome==='success') old.resolve([400]); else old.reject(new Error('obsolete'));});
    await key('Delete'); expect(appApi.snapshotResourceEventIds).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain('obsolete');
    await act(async()=>fresh.resolve([990]));
    await click(button('Dismiss captured changes')); expect(appApi.dismissInboxEvents).toHaveBeenCalledWith([990]);
  });
  it('updates complete global counts through the App refresh and never queries History for capture',async()=>{
    let unread=true;
    appApi.queryInbox.mockImplementation(async()=>({items:[],total:1,unreadTotal:unread?1:0,courseCounts:[{courseId:1,total:1,unreadTotal:unread?1:0}]}));
    appApi.setEventReadState.mockImplementation(async()=>{unread=false;});
    await open(); const calls=appApi.listHistoryEvents.mock.calls.length;
    act(()=>row().focus()); await key('A',{shiftKey:true});
    expect(appApi.listHistoryEvents).toHaveBeenCalledTimes(calls);
    await click(button('Mark captured changes read'));
    expect(appApi.queryInbox.mock.calls.length).toBeGreaterThan(2);
    expect(document.querySelector('button[aria-label="Inbox"]')?.textContent).not.toContain('1');
  });
  it('navigates a real virtualized long inventory past its mounted window and restores identity after inspection',async()=>{
    appApi.listResources.mockResolvedValue(Array.from({length:320},(_,i)=>resource({id:i+1,externalResourceId:`r${i+1}`,title:`File ${String(i).padStart(4,'0')}`})));
    await open(); act(()=>row().focus());
    for(let i=0;i<22;i++) { await key('j'); await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));}); }
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,60));});
    expect(document.activeElement?.getAttribute('data-row-key')).toBe('resource:r23');
    expect(document.querySelectorAll('[role="treeitem"][data-row-key^="resource:"]').length).toBeLessThan(60);
    await key('Enter'); expect(document.querySelector('.peek-title')?.textContent).toBe('File 0022');
    const scroll=document.querySelector<HTMLElement>('.tree-branch')!;
    await act(async()=>{scroll.scrollTo({top:7000});});
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,50));});
    expect(document.querySelector('[role="treeitem"][data-row-key="resource:r23"]')).toBeNull();
    await click(button('Close details'));
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,50));});
    expect(document.activeElement?.getAttribute('data-row-key')).toBe('resource:r23');
    expect(appApi.setEventReadState).not.toHaveBeenCalled();
  }, 15000);

  for (const outcome of ['success','rejection'] as const) it(`ignores stale mutation ${outcome} and finally while a newer capture owns the lock`,async()=>{
    const write=deferred<void>(),snapshot=deferred<number[]>();
    appApi.setEventReadState.mockReturnValueOnce(write.promise);
    await open(); act(()=>row().focus()); await key('e');
    const search=document.querySelector<HTMLInputElement>('input[aria-label="Search resources in this course"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'Lecture');search.dispatchEvent(new Event('input',{bubbles:true}));});
    appApi.snapshotResourceEventIds.mockReturnValueOnce(snapshot.promise);
    act(()=>row().focus()); await key('Delete');
    await act(async()=>{ if(outcome==='success') write.resolve(); else write.reject(new Error('obsolete write')); });
    await key('Delete'); expect(appApi.snapshotResourceEventIds).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain('obsolete write');
    await act(async()=>snapshot.resolve([600]));
    await click(button('Dismiss captured changes')); expect(appApi.dismissInboxEvents).toHaveBeenCalledWith([600]);
  });
  it('preserves search focus, prunes selection and falls back to search on empty results; inactive tabs suppress actions',async()=>{
    await open(); act(()=>row().focus()); await key('x');
    const search=document.querySelector<HTMLInputElement>('input[aria-label="Search resources in this course"]')!;
    act(()=>search.focus());
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'no matches');search.dispatchEvent(new Event('input',{bubbles:true}));});
    expect(document.activeElement).toBe(search); expect(document.body.textContent).toContain('0 materials selected');
    await key('e',{},search); expect(appApi.snapshotResourceEventIds).not.toHaveBeenCalled();
    await click(button('Activity')); await key('e',{},document.body);
    expect(appApi.snapshotResourceEventIds).not.toHaveBeenCalled();
  });

  it('uses local fallback identity and returns list-owned focus to search when filtering removes everything',async()=>{
    appApi.listResources.mockResolvedValue([resource({externalResourceId:''})]);
    await open(); expect(row().getAttribute('data-row-key')).toBe('resource:local:1'); act(()=>row().focus());
    const search=document.querySelector<HTMLInputElement>('input[aria-label="Search resources in this course"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'absent');search.dispatchEvent(new Event('input',{bubbles:true}));});
    expect(document.activeElement).toBe(search);
  });

  it('does not restore an unmounted Materials owner over the destination tab heading',async()=>{
    await open(); await click(button('Show details for Lecture 4'));
    await click(button('Activity'));
    expect(document.querySelector('.peek')).toBeNull();
    expect(document.activeElement?.getAttribute('role')).not.toBe('treeitem');
  });

  it('keeps sidebar folder actions inert and captures matching descendants with Shift+A from Materials',async()=>{
    appApi.listResources.mockResolvedValue([resource({sectionPath:['Unit','Notes']}), resource({id:2,externalResourceId:'r2',sectionPath:['Unit','Notes']})]);
    await open();
    const folder=button('Unit', document.querySelector('nav[aria-label="Courses"]')!);
    act(()=>folder.focus());
    for(const value of ['x','e','u','Delete',' ']) await key(value);
    expect(appApi.snapshotResourceEventIds).not.toHaveBeenCalled();
    expect(appApi.previewResource).not.toHaveBeenCalled();
    await key('ArrowRight');
    expect(button('Collapse Unit').getAttribute('aria-expanded')).toBe('true');
    await key('ArrowRight');
    expect(document.activeElement).toBe(button('Notes'));
    await key('ArrowLeft');
    expect(document.activeElement).toBe(folder);
    await key('ArrowLeft');
    expect(button('Expand Unit').getAttribute('aria-expanded')).toBe('false');
    act(()=>row().focus());
    await key('A',{shiftKey:true});
    expect(appApi.snapshotResourceEventIds).toHaveBeenCalledWith([1,2]);
  });
  it('preserves material selections when collapsing a sidebar branch and prunes removed resources',async()=>{
    let resources=[resource({sectionPath:['Unit']}),resource({id:2,externalResourceId:'r2',title:'Second',sectionPath:['Other']})];
    appApi.listResources.mockImplementation(async()=>resources);
    await open(); const first=document.querySelector<HTMLElement>('[data-row-key="resource:r1"]')!; act(()=>first.focus()); await key('x');
    await click(button('Collapse MATH F111'));
    expect(document.body.textContent).toContain('1 material selected');
    act(()=>first.focus());
    await key('A',{shiftKey:true}); expect(appApi.snapshotResourceEventIds).toHaveBeenLastCalledWith([1,2]); await click(button('Cancel'));
    resources=[resources[1]]; await emitAppEvent('sync:done',{});
    expect(document.body.textContent).toContain('0 materials selected');
    expect(document.querySelector('.peek')).toBeNull();
  });
  it('captures only the selected folder scope without requiring its descendants to be expanded', async () => {
    appApi.listResources.mockResolvedValue([
      resource({ sectionPath: ['Unit', 'Lecture notes'] }),
      resource({ id: 2, externalResourceId: 'r2', sectionPath: ['Other'] }),
    ]);
    await open();
    await click(button('Unit'));
    act(() => row().focus());
    await key('A', { shiftKey: true });
    expect(appApi.snapshotResourceEventIds).toHaveBeenCalledWith([1]);
  });
  for(const outcome of ['success','rejection'] as const) it('invalidates a pending capture on Activity: '+outcome,async()=>{
    const snapshot=deferred<number[]>();appApi.snapshotResourceEventIds.mockReturnValue(snapshot.promise);
    await open();act(()=>row().focus());await key('Delete');await click(button('Activity'));
    await act(async()=>{if(outcome==='success')snapshot.resolve([90]);else snapshot.reject(new Error('obsolete tab'));});
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain('obsolete tab');
    expect(appApi.dismissInboxEvents).not.toHaveBeenCalled();
  });
  it('deduplicates complete inventory and keeps resources outside this course out of capture',async()=>{
    appApi.listResources.mockResolvedValue([resource(),resource({id:8}),resource({id:2,externalResourceId:'other',courseId:2})]);
    await open();act(()=>row().focus());await key('A',{shiftKey:true});
    expect(appApi.snapshotResourceEventIds).toHaveBeenCalledWith([1]);
    expect(appApi.listResources.mock.calls.every(([filter])=>filter?.courseId===undefined)).toBe(true);
  });

  it('supersedes an offscreen End request with an immediately mounted Home target',async()=>{
    appApi.listResources.mockResolvedValue(Array.from({length:320},(_,i)=>resource({id:i+1,externalResourceId:`r${i+1}`,title:`File ${String(i).padStart(4,'0')}`})));
    await open(); const first=row(); const home=document.querySelector<HTMLElement>('[role="treeitem"]')!; const homeId=home.dataset.rowKey; act(()=>first.focus());
    await act(async()=>{
      first.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));
      first.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));
      await new Promise(resolve=>setTimeout(resolve,80));
    });
    expect(document.activeElement?.getAttribute('data-row-key')).toBe(homeId);
    expect(home.isConnected).toBe(true);
    expect(document.querySelectorAll('[role="treeitem"]').length).toBeLessThan(60);
  });

  it('restores the current resource when inventory grows into virtualization during inspection',async()=>{
    let resources=[resource()];
    appApi.listResources.mockImplementation(async()=>resources);
    await open(); act(()=>row().focus()); await key('Enter');
    resources=[...Array.from({length:300},(_,i)=>resource({id:i+2,externalResourceId:`added-${i}`,title:`A file ${i}`})),resource({title:'Z inspected lecture',firstSeenAt:'2026-10-13T00:00:00Z'})];
    await emitAppEvent('sync:done',{});
    expect(document.querySelector('[data-row-key="resource:r1"]')).toBeNull();
    await click(button('Close details'));
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,80));});
    expect(document.activeElement?.getAttribute('data-row-key')).toBe('resource:r1');
    expect(document.querySelectorAll('[role="treeitem"]').length).toBeLessThan(60);
  });

});
