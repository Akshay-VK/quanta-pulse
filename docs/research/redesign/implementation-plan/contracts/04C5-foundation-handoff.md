# 04C5 / #51 prerequisite foundation handoff

Base: `0f5f51093965a8755232c2b5dd679ccfe52ed7d1`; leased patch, no Git writes/delegates/App edits/keyboard.

PASS: unfiltered B05A, 1000-sized pages, exact-multiple terminal request, backend order. Invalid items/total/IDs, duplicates, total drift, overrun and premature terminal pages reject with `History inventory incomplete: … Retry refresh.` API failures propagate unchanged; production never calls legacy History listing. No partial result escapes. Offset pagination is non-atomic; publish only the last completed current refresh.

Files: `src/lib/historyInventory.ts`, `tests/historyInventory.test.ts`, `src/views/HistoryView.tsx` (declarations), `tests/helpers/renderApp.tsx` (fixture), this artifact. Fixture awaits legacy mock data and paginates; production never falls back.

Exact contracts:
```ts
queryHistoryInventory(): Promise<ChangeEvent[]>
eventScopeReady?: boolean;
onSetEventReadState?: (ids: number[], read: boolean) => Promise<void>;
onDismissEvents?: (ids: number[]) => Promise<void>;
onChanged?: () => Promise<void>;
```
Mutations require readiness, API execution, then refresh. Callbacks reject failures; missing IDs may be ignored. Never replay successful mutations after refresh failure.

Root-only proposed App patch (not applied):
```diff
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -30,6 +30,7 @@
 import SettingsView from "./views/SettingsView";
 import type { SettingsNavigationController } from "./views/SettingsView";
 import { api } from "./lib/api";
+import { queryHistoryInventory } from "./lib/historyInventory";
 import { useTheme } from "./hooks/useTheme";
 import { useHotkey } from "./hooks/useHotkey";
 import { MirrorProvider, useMirror } from "./hooks/useMirror";
@@ -104,6 +105,7 @@
   const [resources, setResources] = useState<Resource[]>([]);

   const [historyEvents, setHistoryEvents] = useState<ChangeEvent[]>([]);
+  const [eventScopeReady, setEventScopeReady] = useState(false);
   const [scans, setScans] = useState<ScanRun[]>([]);
   const inbox = useInbox();
   const [dueFilter, setDueFilter] = useState<DueFilter>({});
@@ -270,29 +272,37 @@
   }, []);

   const refreshGeneration = useRef(0);
-  const refresh = useCallback(async () => {
+  const refresh = useCallback(async (requireSuccess = false) => {
     const generation = ++refreshGeneration.current;
     setLoading(true);
-    const collectionsRefresh = refreshCollections.current();
+    setEventScopeReady(false);
     try {
       const [c, r, he, s, info] = await Promise.all([
         api.listCourses(),
         queryResourceInventory(),
-        api.listHistoryEvents(),
+        queryHistoryInventory(),
         api.listHistoryScans(),
         api.dbInfo(),
+        refreshCollections.current(),
       ]);
-      if (generation !== refreshGeneration.current) return;
+      if (generation !== refreshGeneration.current) {
+        if (requireSuccess) throw new Error("History refresh superseded; retry refresh.");
+        return;
+      }
       setCourses(c);
       setResources(r);
       setHistoryEvents(he);
       setScans(s);
       setDbInfo(info);
       setLoadError(null);
+      setEventScopeReady(true);
     } catch (err) {
-      if (generation === refreshGeneration.current) setLoadError(String(err));
+      if (generation === refreshGeneration.current) {
+        setLoadError(String(err));
+        setEventScopeReady(false);
+      }
+      if (requireSuccess) throw err;
     } finally {
-      await collectionsRefresh;
       if (generation === refreshGeneration.current) setLoading(false);
     }
   }, []);
@@ -902,6 +912,10 @@
                     courses={courses}
                     scans={scans}
                     events={historyEvents}
+                    eventScopeReady={eventScopeReady && !loading && !loadError}
+                    onSetEventReadState={(ids, read) => api.setEventReadState([...ids], read)}
+                    onDismissEvents={(ids) => api.dismissInboxEvents([...ids])}
+                    onChanged={() => refresh(true)}
                     resources={resources}
                     details={detailsAdapters.history}
                     loading={loading}
```

Default refresh preserves catch-and-resolve callers; required refresh rejects failure/supersession. Collections complete before publication. Stale generations never publish. Retain rows on failure; preserve header/Scans owners.

Proof: test-first import failure; focused helper/History/material: 50/50 PASS (26 new). `npm run lint` and `npm run build`: PASS (chunk-size warning). `npm test -- --maxWorkers=4 --minWorkers=1`: pre-freeze assembled FAIL, 689 passed/4 failed (Course suites: `appCourseMaterialsKeyboard`, `courseLibraryView`); exited. Source frozen, no remaining edits; no further gates. Whitespace/newline and App patch apply-check PASS. No screenshots needed. Root must apply/test App publication, readiness, supersession and rejecting callbacks/refresh. App integration and 04C5 keyboard acceptance remain pending.
