# PDF renderer compatibility decision

## Decision

No product OS decision is required. Keep Tauri's macOS minimum at 10.15, but define the app's supported macOS WebKit target as Safari 15.6 or newer,. Catalina did not ship with that engine: Tauri documents 10.15's original WebKit as Safari 13.0.2. Catalina later received Safari 15.4 and 15.6 updates (Apple); therefore 10.15 does not imply a frozen 2019 engine. PDF.js 5.6.205's legacy build lists Safari 15.4+ as “Mostly” supported, while modern build targets latest browsers. Use legacy for the supported Catalina target. Safari 15.4 is the upstream minimum; Safari 15.6 is this project's minimum supported runtime. Engines below 15.4 are unsupported for PDF; show the existing “Preview isn't available for this file” state and retain Open saved copy / Show in folder. Do not replace thumbnails/search with decorative controls or claim PDF preview support there.

## Imports and build contract

Use one matching pair, pinned to `pdfjs-dist` 5.6.205:

```ts
// Selected (legacy pair)
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
// Modern alternative, only if target policy changes: build/pdf.mjs + build/pdf.worker.mjs?url
```

Vite's explicit `?url` emits a hashed, same-build asset URL; it avoids `new URL(..., import.meta.url)` ambiguity through package/build transforms. Keep main and worker from the same package/build. Current Vite build target is ES2021; PDF.js legacy build includes its older-browser Babel/polyfill output. ES2021 does not polyfill runtime APIs or transpile an emitted worker asset. Test module-worker startup and worker asset loading in packaged WKWebView; no fake-worker fallback. PDF bytes remain `getDocument({data})` from authenticated API; no PDF URL/network fetch.

## Evidence and remaining proof

- PDF.js [browser support](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#faq-support), [5.6.205 release](https://github.com/mozilla/pdf.js/releases/tag/v5.6.205), [prebuilt files](https://github.com/mozilla/pdf.js/blob/master/docs/contents/getting_started/index.md).
- Apple [Safari 15.4 availability](https://support.apple.com/en-us/103193) and [Safari 15.6 availability](https://support.apple.com/en-us/102893): both include Catalina.
- Tauri [WebView versions](https://v2.tauri.app/reference/webview-versions/) (system WKWebView, Catalina original Safari 13.0.2); [Vite asset URL imports](https://vite.dev/guide/features#static-assets).

This WSL environment has no macOS/WKWebView; native verification was not performed. Acceptance still needs packaged worker-load/render/search smoke tests on Catalina/Safari 15.6, newest supported macOS, and WebView2. Controls must perform real rendering, thumbnails, text search and navigation; unavailable operations must report unsupported.
