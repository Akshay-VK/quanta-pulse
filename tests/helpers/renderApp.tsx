// Real application orchestration; mock only the API and native event boundary.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi, type Mock } from "vitest";

const native = vi.hoisted(() => ({ listeners: new Map<string, Set<(event: { payload: unknown }) => void>>() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    const handlers = native.listeners.get(name) ?? new Set();
    native.listeners.set(name, handlers);
    handlers.add(handler);
    return () => { handlers.delete(handler); };
  }),
}));
vi.mock("../../src/lib/api", async (importOriginal) => {
  const { api: original } = await importOriginal<typeof import("../../src/lib/api")>();
  return { api: Object.fromEntries(Object.keys(original).map((key) => [key, vi.fn().mockResolvedValue(undefined)])) };
});
import { api } from "../../src/lib/api";
import App from "../../src/App";
export const appApi = vi.mocked(api);
export const appClipboard = { writeText: vi.fn() };

export { change, course, resource, settings } from "./data";
import { change, course, resource, settings } from "./data";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function flushApp() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
export async function emitAppEvent(name: string, payload: unknown) {
  await act(async () => { native.listeners.get(name)?.forEach((handler) => handler({ payload })); });
  await flushApp();
}
const prototypeDescriptors = new Map<string, PropertyDescriptor | undefined>();
function installBrowserMethod(name: string, value: unknown) {
  if (!prototypeDescriptors.has(name)) prototypeDescriptors.set(name, Object.getOwnPropertyDescriptor(Element.prototype, name));
  Object.defineProperty(Element.prototype, name, { configurable: true, writable: true, value });
}

/** Call in beforeEach, then override individual API responses before renderApp. */
export function setupApp({ width = 1280, dark = false, platform = "Linux" } = {}) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  Object.values(appApi).forEach((mock) => (mock as Mock).mockReset().mockResolvedValue(undefined));
  native.listeners.clear();
  localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: query.includes("prefers-color") ? dark : Boolean(max || min) &&
        (!max || width <= Number(max[1])) && (!min || width >= Number(min[1])),
      media: query, addEventListener: () => {}, removeEventListener: () => {},
    };
  });
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  appClipboard.writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", new Proxy(navigator, {
    get: (target, key) => key === "clipboard" ? appClipboard : Reflect.get(target, key, target),
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, width: 100, height: 40, top: 0, left: 0, right: 100, bottom: 40, toJSON: () => ({}) });
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ width: 100, height: 40 }] as unknown as DOMRectList);
  installBrowserMethod("scrollIntoView", () => {});
  installBrowserMethod("hasPointerCapture", () => false);
  installBrowserMethod("releasePointerCapture", () => {});
  installBrowserMethod("setPointerCapture", () => {});
  appApi.authStatus.mockResolvedValue({ authenticated: true, attemptId: null, email: "student@example.test", fullName: "Student", method: "password", acquiredAt: null, sessionExpired: false });
  appApi.syncStatus.mockResolvedValue({ running: false, phase: "Idle", progress: 0, lastSuccessAt: null, nextScheduledAt: null, unreadNew: 1, lastError: null, authState: "connected" });
  appApi.getSettings.mockResolvedValue(settings);
  appApi.listCourses.mockResolvedValue([course]);
  appApi.listResources.mockResolvedValue([resource()]);
  appApi.listSearchInventory.mockImplementation(async () => structuredClone({ courses: await appApi.listCourses(), resources: await appApi.listResources(), unreadResourceIds: [1] }));
  appApi.listDashboardResources.mockResolvedValue([resource()]);
  appApi.listDashboardEvents.mockResolvedValue([change()]);
  appApi.queryInbox.mockImplementation(async (filter = {}) => {
    const events = await appApi.listDashboardEvents();
    const byKey = new Map<string, typeof events>();
    for (const event of events) {
      const key = event.resourceId == null ? `event:${event.id}` : `resource:${event.resourceId}`;
      byKey.set(key, [...(byKey.get(key) ?? []), event]);
    }
    const items = [...byKey].map(([key, group]) => ({ key, resourceId: group[0].resourceId, courseId: group[0].courseId, latestEvent: group[0], eventIds: group.map(e => e.id), changeTypes: [...new Set(group.map(e => e.changeType))], unread: group.some(e => !e.read) })).filter(item =>
      (!filter.courseId || item.courseId === filter.courseId) && (!filter.changeType || item.changeTypes.includes(filter.changeType)) && (filter.attention !== 'unread' || item.unread) && (!filter.search || `${item.latestEvent.resourceTitle} ${item.latestEvent.title} ${item.latestEvent.courseName}`.toLowerCase().includes(filter.search.toLowerCase())));
    const courseCounts = [...new Set(items.map(item => item.courseId))].map(courseId => ({ courseId, total: items.filter(item => item.courseId === courseId).length, unreadTotal: items.filter(item => item.courseId === courseId && item.unread).length }));
    return { items: items.slice(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 100)), total: items.length, unreadTotal: items.filter(item => item.unread).length, courseCounts };
  });
  appApi.snapshotResourceUnreadEventIds.mockImplementation(async (id) =>
    (await appApi.listDashboardEvents()).filter(event => event.resourceId === id && !event.read).map(event => event.id));
  appApi.snapshotInboxEventIds.mockImplementation(async filter => (await appApi.queryInbox(filter)).items.flatMap(item => item.eventIds));
  appApi.queryDueResources.mockResolvedValue({ items: [], total: 0 });
  appApi.listHistoryEvents.mockResolvedValue([change()]);
  appApi.queryHistoryEvents.mockImplementation(async ({ offset, limit }) => {
    const events = await appApi.listHistoryEvents();
    return { items: events.slice(offset, offset + limit), total: events.length };
  });
  appApi.listHistoryScans.mockResolvedValue([]);
  appApi.unreadCount.mockResolvedValue(1);
  appApi.dbInfo.mockResolvedValue({ path: "/local/pulse.db", sizeBytes: 0, courseCount: 1, resourceCount: 1, eventCount: 1, logDir: null });
  appApi.mirrorLocalFiles.mockResolvedValue([]);
  appApi.mirrorLocalFile.mockResolvedValue(null);
  appApi.eventsRange.mockResolvedValue([]);
  appApi.dailyDigest.mockResolvedValue({ date: "2026-10-14", newCount: 0, updatedCount: 0, announcementCount: 0, deadlineCount: 0, unavailableCount: 0, coursesFailed: 0, lastSuccessAt: null, items: [] });
  appApi.mirrorStats.mockResolvedValue({ queued: 0, downloading: 0, done: 0, failed: 0, skipped: 0, kept: 0, totalResources: 1, bytesDone: 0, bytesTotal: 0, state: "idle", root: "/files", freeBytes: 1000000 });
  appApi.cacheStats.mockResolvedValue({ fileCount: 0, totalBytes: 0, limitBytes: settings.cacheLimitBytes });
  appApi.telegramStatus.mockResolvedValue({ enabled: false, configured: false, chatId: null, botUsername: null, error: null });
  appApi.appVersion.mockResolvedValue("0.2.0");
  appApi.checkUpdate.mockResolvedValue(null);
  appApi.setSettings.mockImplementation(async (next) => next);
  appApi.previewResource.mockResolvedValue({ kind: "text", text: "Lecture contents", truncated: false, sourceUrl: resource().url, contentType: "text/plain" });
}
export async function renderApp() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<App />); });
  await flushApp();
  return { container, unmount() {
    act(() => root.unmount());
    container.remove();
    native.listeners.clear();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const [name, descriptor] of prototypeDescriptors) {
      if (descriptor) Object.defineProperty(Element.prototype, name, descriptor);
      else Reflect.deleteProperty(Element.prototype, name);
    }
    prototypeDescriptors.clear();
  } };
}
export function button(label: string, scope: ParentNode = document): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.getAttribute("aria-label") === label || node.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
export async function click(node: HTMLElement) {
  await act(async () => { node.click(); });
  await flushApp();
}
export async function escape() {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  });
  await flushApp();
}
