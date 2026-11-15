# D06 PDF renderer review

## Recommendation

Use Mozilla `pdfjs-dist` **5.6.205** directly (not React-PDF, whose wrapper does not supply the requested product UI). Pin the exact version. PDF.js is the smallest established local renderer that exposes page rendering, page text extraction, and the PDF byte-array API needed for custom thumbnails, search, and navigation. The official release page identifies 5.6.205; Apache-2.0 is permissive for distribution with license/notice attribution. Do not copy the full generic viewer.

There is one platform compatibility blocker to surface before implementation: Tauri config still declares macOS 10.15 minimum, while PDF.js documents its legacy build only for Safari 15.4+ (and modern build targets latest browsers). PDF.js documentation does not establish support for the WebKit shipped with macOS 10.15. This is a product support decision only if 10.15 remains a supported target; engineering cannot infer compatibility from the release notes. Either prove the packaged app’s PDF path on the minimum OS/WebView or have the product owner raise the minimum. Windows WebView2 and current macOS WebKit are the expected engines, but native acceptance is still required.

## Bounded design

- Keep `api.previewResource(resource.id)` as the only content fetch. Backend already enforces `PREVIEW_MAX_BINARY_BYTES = 8 MiB`, rejects known oversize files before download where metadata permits, takes/releases the existing preview lease around fetch, and returns authenticated bytes as base64. Do not give PDF.js a URL, make a second request, persist bytes, or introduce a Tauri file path.
- Decode once to `Uint8Array`; call `getDocument({ data: bytes })`. PDF.js may transfer/consume this typed array into its worker, so treat it as owned by PDF.js and never reuse it. Avoid a PDF Blob/object URL entirely. Keep the existing object-URL path for image/audio/video, and revoke it on close/resource change as today.
- Bundle the worker through Vite using a same-build worker URL (e.g. `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` or Vite's supported worker import); set `GlobalWorkerOptions.workerSrc` explicitly. Worker and main library must come from the same pinned package version. Do not use CDN, runtime download, data URL, or fake-worker fallback as a normal path.
- Load on opening the dialog, render only the selected page plus a small visible thumbnail window (one render at a time); cancel pending render tasks and call `loadingTask.destroy()` when the document changes/closes. Zero canvas width/height on eviction/unmount. Keep only bounded thumbnail canvases and text-index data. Use PDF.js display API for `getPage`, `getViewport`, `render`, `getTextContent`; search extracted text page-by-page, retain a 200,000-character index cap (same order as current backend text cap), report truncation, and N/P cycles matches while setting selected page.
- Set a pixel guard before canvas allocation: max 16 megapixels per canvas, effective DPR no higher than 2, and reject/offer the open-original fallback for a page exceeding that budget. At 4 bytes/pixel this is 64 MiB per full canvas; ensure there is at most one full page canvas and a bounded thumbnail working set, not a canvas per document page. PDF.js API supports canvas viewport sizing; this explicit cap is application policy, not an upstream guarantee.

## Config, licensing, failure behavior

- Add exact `pdfjs-dist: 5.6.205` to dependencies and preserve its Apache-2.0 license/NOTICE in the shipped third-party notices. Verify the package metadata/license at lockfile time.
- `tauri.conf.json` currently has `security.csp: null`, so CSP currently imposes no app-specific worker restriction. If the app adopts explicit CSP, allow the bundled worker under `worker-src 'self'` (and only add `blob:` if the chosen Vite/Tauri worker URL demonstrably requires it); permit `blob:` under `img-src` only for existing non-PDF media previews. No `connect-src` Quanta exception is needed for PDF.js because bytes are already local. Verify packaged custom-protocol worker loading on WebView2 and WKWebView; Vite dev success alone is insufficient.
- Show retry/reconnect only for backend fetch/auth/network errors. Distinguish invalid/corrupt PDF, password-protected PDF (unsupported unless a deliberate password UX is added), worker startup/version mismatch, render failure/page pixel-budget rejection, and text-index truncation. Never silently fall back to native iframe controls or report search as complete when capped.

## Required task 12 proof

Add focused tests for worker URL configuration, PDF loading from byte data (no network/URL), page render and thumbnail navigation, full-document search with N/P/page selection, no-text PDF, corrupt/password PDF errors, render cancellation and document destroy on close/switch, stale async result suppression, canvas release, oversize backend result, and exactly one bounded text index. Existing `tests/preview.test.ts` and `tests/previewDialog.test.tsx` remain regression gates; new `tests/quickLook.test.tsx` owns PDF UI behavior. Add a rendered packaged-WebView smoke on the supported minimum OS/engine proving bundled worker load and memory behavior; jsdom cannot prove either.

## Exact task 12 consumer excerpt

From `tasks/12.md`:

> Implement 980×712 clamped shell, PDF thumbnails/search N/P, image fit/zoom, 640px text reading column, audio/video controls, loading, unsupported, oversized, network/auth retry/reconnect. Keep authenticated backend fetching, content size limits, safe text, object-URL cleanup and stale request guards. Saved-copy/reveal actions use shared material policy. Repeated Space/Escape closes and restores focus. Complete actual PDF functions per D06 rather than decorative controls.

> `package.json only if D06 authorizes dependency`

> Regression proof: `tests/previewDialog.test.tsx`, `tests/preview.test.ts`, `new tests/quickLook.test.tsx`; include renderer loading/search/page/navigation and cleanup.

## Official primary sources

- PDF.js stable releases (5.6.205): https://github.com/mozilla/pdf.js/releases
- PDF.js browser compatibility (modern vs legacy, Safari 15.4+): https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions
- PDF.js API examples (byte arrays, page render, viewport/canvas): https://mozilla.github.io/pdf.js/examples/
- PDF.js API (loading task destruction, byte ownership, text extraction): https://mozilla.github.io/pdf.js/api/index.html
- PDF.js license: https://github.com/mozilla/pdf.js/blob/master/LICENSE
- Tauri CSP: https://v2.tauri.app/security/csp/
