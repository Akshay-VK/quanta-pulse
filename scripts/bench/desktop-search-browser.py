"""Measure built App input-to-render and capture its saved-text fixture, with no server.

Requires Playwright Python and its Chromium. Run after npm run build.
python scripts/bench/desktop-search-browser.py --size 5000
python scripts/bench/desktop-search-browser.py --screenshot /tmp/s3-saved-text.png
"""
import argparse
import json
import os
import statistics
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--size", type=int, default=5000)
parser.add_argument("--screenshot", type=Path)
args = parser.parse_args()
dist = Path(__file__).resolve().parents[2] / "dist"
init = r"""
({ size, screenshot }) => {
  const stamp = "2026-11-20T12:00:00Z";
  const courses = Array.from({ length: screenshot ? 1 : 100 }, (_, n) => ({
    id: n + 1, externalCourseId: String(n + 1), name: screenshot ? "Synthetic Statistics" : `Synthetic Course ${n + 1}`,
    shortName: `SYN ${n + 1}`, url: `https://example.test/course/${n + 1}`, firstSeenAt: stamp,
    lastScannedAt: stamp, lastScanStatus: "success", monitoringStatus: "monitored", resourceCount: size / 100,
  }));
  const resources = Array.from({ length: screenshot ? 3 : size }, (_, n) => {
    const course = courses[n % courses.length];
    const sectionPath = [`Unit ${n % 9}`, n % 3 ? "Lectures" : "Exercises"];
    const kind = screenshot ? "text" : n % 3 ? "pdf" : "text";
    return {
      id: n + 1, courseId: course.id, sectionPath, externalResourceId: `fixture:${n + 1}`, courseName: course.name,
      resourceType: kind, title: screenshot ? ["Regression", "Model diagnostics", "Workshop notes"][n] :
        `Lecture ${n + 1} ${n % 7 ? "regression" : "statistics"}`, url: `https://example.test/resource/${n + 1}`,
      sourcePageUrl: course.url, uploadedAt: stamp, publishedAt: null, modifiedAt: null, dueAt: null,
      firstSeenAt: stamp, lastSeenAt: stamp, lastCheckedAt: stamp, contentFingerprint: null,
      availabilityStatus: "available", sizeBytes: 128, section: sectionPath[1], isExternal: false,
    };
  });
  const status = {running:false, phase:"Idle", progress:0, lastSuccessAt:stamp,
    nextScheduledAt:null, unreadNew:0, lastError:null, authState:"connected"};
  const values = {
    auth_status:{authenticated:true, email:"student@example.test", fullName:"Sample Student", method:"sso",
      acquiredAt:stamp, sessionExpired:false},
    sync_status:status, app_version:"0.4.0", "plugin:updater|check":null, "plugin:event|listen":1,
    get_settings:{syncIntervalMinutes:30, runInBackground:true, updateAutoCheck:false, notificationsEnabled:true,
      timezone:"UTC", mirrorEnabled:false, cacheLimitBytes:2147483648, telegramEnabled:false, deadlineReminderHours:48},
    list_search_inventory:{courses,resources,unreadResourceIds:[]}, list_courses:courses,
    list_resources:resources, list_events:[], list_dashboard_resources:[], list_dashboard_events:[],
    list_history_events:[], query_inbox:{items:[],total:0,unreadTotal:0,courseCounts:[]},
    query_due_resources:{items:[],total:0}, query_history_events:{items:[],total:0},
    list_history_scans:[], unread_count:0, mirror_local_files:[], mirror_download_progress:[],
    search_saved_content:{state:"ready",indexed:2,skipped:1,hits:[
      {resourceId:2,snippet:"Use a residual plot to check the assumptions behind the regression model."},
      {resourceId:3,snippet:"Compare the sample estimates with the regression coefficients in the handout."},
    ]},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener: () => {}};
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 1, unregisterCallback: () => {},
    invoke: async (command) => values[command] ?? null,
  };
  document.addEventListener("input", event => {
    if (!event.target.matches(".palette-input")) return;
    const start = performance.now();
    requestAnimationFrame(() => {
      const items = document.querySelectorAll('.palette-item[data-value^="File "]');
      if (items[0]?.textContent.toLowerCase().includes(event.target.value)) {
        (window.fixtureSamples ??= []).push(performance.now() - start);
      }
    });
  }, true);
}
"""


def fulfill(route):
    name = unquote(urlparse(route.request.url).path).lstrip("/") or "index.html"
    path = dist / name
    if urlparse(route.request.url).hostname == "pulse.test" and path.is_file():
        route.fulfill(path=str(path))
    else:
        route.abort()


with sync_playwright() as p:
    chromium = p.chromium.launch(executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE"))
    samples = []
    for _ in range(1 if args.screenshot else 5):
        page = chromium.new_page(viewport={"width": 1366, "height": 900}, color_scheme="light")
        page.add_init_script(f"({init})({json.dumps(dict(size=args.size, screenshot=bool(args.screenshot)))})")
        page.route("**/*", fulfill)
        page.goto("http://pulse.test/")
        page.locator(".search-trigger").click()
        query = page.locator(".palette-input")
        if args.screenshot:
            query.fill("regression")
            page.get_by_role("button", name="Include saved text").click()
            expect(page.get_by_text("Body match", exact=True)).to_have_count(2)
            page.mouse.move(1200, 830)
            args.screenshot.parent.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(args.screenshot))
        else:
            for iteration in range(21):
                query.fill("statistics" if iteration % 2 else "regression")
                page.wait_for_function("(count) => window.fixtureSamples?.length === count", arg=iteration + 1)
            samples.append(page.evaluate("window.fixtureSamples"))
        page.close()
    if samples:
        cold = sorted(row[0] for row in samples)
        warm = sorted(value for row in samples for value in row[1:])
        print(json.dumps(dict(size=args.size, chromium=chromium.version,
                              coldP50Ms=statistics.median(cold), coldP95Ms=cold[-1],
                              warmP50Ms=statistics.median(warm), warmP95Ms=warm[94])))
