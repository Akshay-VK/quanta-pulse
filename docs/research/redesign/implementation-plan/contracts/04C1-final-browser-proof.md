# 04C1 final browser proof

The production Vite bundle was built from the current working tree into a fresh `/tmp` run. The harness replaced only Tauri events and `src/lib/api.ts` with local fixtures; no native app or live LMS data was used.

At **1280×800**, J/K moved row focus without opening inspection or calling acknowledgement APIs. Focus-only styling measured the hover background and a 2px inset accent bar; the E keycap was present. Enter opened one inspector (`peekCount: 1`, zero synthetic row clicks); Escape closed it and restored row focus. X enabled multi-selection with inspection closed. Its neutral fill (`rgb(27, 27, 32)`) and 3px accent bar differed from focus-only (`rgb(20, 20, 23)`, 2px bar).

At **820×540**, the selected row kept the E keycap, 40px time track and 92px action track inside the viewport. The Delete dialog was fully contained, retained focus internally, and Escape restored the originating row. No document overflow occurred. Geist fonts loaded; captured browser errors were zero. J from the nested course and action buttons retained their native focus and made no acknowledgement calls. Library and Agenda detail buttons were both reached by Tab and had native `tabIndex=0` with no explicit tabindex.

Artifacts: [raw browser JSON](/tmp/quanta-redesign-progress/20261116T034500Z/freshports/browser-proof.json), [focused-only 1280×800 PNG](/tmp/quanta-redesign-progress/20261116T034500Z/freshports/focused-only-1280x800.png), [selected 820×540 PNG](/tmp/quanta-redesign-progress/20261116T034500Z/freshports/selected-minimum-820x540.png).
