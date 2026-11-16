# Final browser proof — 2026-11-16

Validation-only run against the actual React app, built once into the fresh external fixture directory. Only the copied API fixture was changed: `ensureLocal` returns the real `LocalFile` DTO shape and `openLocalFile` succeeds. No native app or live Quanta access was used.

At 1280×800 the inspector is 340px inline; at 960×700 it is a 320px modal with a full-screen scrim. The selected heading is visible at 24px high, text stays within the inspector, and neither viewport has document overflow. A temporary 320px inspector height demonstrated internal scrolling; every action button remained reachable. Tab and Shift+Tab stayed within the modal. The successful download/open path showed “Opened saved copy”; Escape closed the inspector and scrim and restored focus to the selected row. No page errors were recorded.

Screenshots: [1280×800](/tmp/quanta-redesign-progress/20261116T084500Z/inspector-1280x800.png), [960×700](/tmp/quanta-redesign-progress/20261116T084500Z/inspector-960x700.png). Full machine-readable observations follow.

```json
{
  "fixture": {
    "title": "Quanta Pulse",
    "titles": [
      "Lecture 12 · Graph Coloring",
      "Tutorial Sheet 8",
      "Assignment 3: Submission deadline"
    ],
    "fonts": "loaded",
    "geist": true,
    "errors": []
  },
  "selectedRow": "Lecture 12 · Graph Coloring",
  "wide": {
    "viewport": {
      "width": 1280,
      "height": 800
    },
    "panel": {
      "tag": "ASIDE",
      "cls": "peek open",
      "rect": {
        "x": 931,
        "y": 53,
        "width": 340,
        "height": 708,
        "right": 1271,
        "bottom": 761
      }
    },
    "dialog": null,
    "scrim": null,
    "active": {
      "tag": "H2",
      "cls": "peek-title",
      "text": "Lecture 12 · Graph Coloring"
    },
    "overflow": {
      "x": false,
      "y": false
    },
    "title": {
      "text": "Lecture 12 · Graph Coloring",
      "x": 956,
      "y": 113,
      "width": 281,
      "height": 24,
      "right": 1237,
      "bottom": 137,
      "visible": true
    },
    "inner": {
      "clientWidth": 329,
      "scrollWidth": 329,
      "clientHeight": 708,
      "scrollHeight": 719
    }
  },
  "narrow": {
    "viewport": {
      "width": 960,
      "height": 700
    },
    "panel": {
      "tag": "ASIDE",
      "cls": "peek open",
      "rect": {
        "x": 632,
        "y": 8,
        "width": 320,
        "height": 684,
        "right": 952,
        "bottom": 692
      }
    },
    "dialog": {
      "rect": {
        "x": 632,
        "y": 8,
        "width": 320,
        "height": 684,
        "right": 952,
        "bottom": 692
      },
      "ariaModal": "true"
    },
    "scrim": {
      "rect": {
        "x": 0,
        "y": 0,
        "width": 960,
        "height": 700,
        "right": 960,
        "bottom": 700
      },
      "display": "block",
      "visibility": "visible",
      "opacity": "1",
      "pointerEvents": "auto"
    },
    "active": {
      "tag": "H2",
      "cls": "peek-title",
      "text": "Lecture 12 · Graph Coloring"
    },
    "overflow": {
      "x": false,
      "y": false
    },
    "title": {
      "text": "Lecture 12 · Graph Coloring",
      "x": 657,
      "y": 68,
      "width": 261,
      "height": 24,
      "right": 918,
      "bottom": 92,
      "visible": true
    },
    "inner": {
      "clientWidth": 309,
      "scrollWidth": 309,
      "clientHeight": 684,
      "scrollHeight": 754
    }
  },
  "scrimIntercept": {
    "topElement": "dialog-overlay workspace-inspector-scrim",
    "insideScrim": true,
    "rowCount": 3
  },
  "tightContentScroll": {
    "start": {
      "height": 24,
      "client": 320,
      "scroll": 754,
      "buttons": [
        "Close details",
        "Copy file",
        "Copy page",
        "Download and open",
        "Preview",
        "More actions"
      ]
    },
    "end": {
      "scrollTop": 754,
      "buttons": [
        {
          "name": "Close details",
          "reachable": true
        },
        {
          "name": "Copy file",
          "reachable": true
        },
        {
          "name": "Copy page",
          "reachable": true
        },
        {
          "name": "Download and open",
          "reachable": true
        },
        {
          "name": "Preview",
          "reachable": true
        },
        {
          "name": "More actions",
          "reachable": true
        }
      ]
    }
  },
  "keyboard": {
    "focusEntry": {
      "tag": "H2",
      "cls": "peek-title",
      "text": "Lecture 12 · Graph Coloring"
    },
    "tabSequence": [
      {
        "name": "Copy file",
        "text": "",
        "inside": true
      },
      {
        "name": "Copy page",
        "text": "",
        "inside": true
      },
      {
        "name": null,
        "text": "Download and open",
        "inside": true
      },
      {
        "name": null,
        "text": "Preview",
        "inside": true
      },
      {
        "name": "More actions",
        "text": "",
        "inside": true
      },
      {
        "name": "Close details",
        "text": "",
        "inside": true
      },
      {
        "name": "Copy file",
        "text": "",
        "inside": true
      },
      {
        "name": "Copy page",
        "text": "",
        "inside": true
      },
      {
        "name": null,
        "text": "Download and open",
        "inside": true
      }
    ],
    "shiftTab": {
      "name": "Copy page",
      "text": "",
      "inside": true
    },
    "allContained": true,
    "escape": {
      "dialog": false,
      "panel": false,
      "scrim": false,
      "scrimDisplay": null,
      "active": {
        "tag": "BUTTON",
        "label": "Show details for Lecture 12 · Graph Coloring"
      },
      "errors": []
    }
  },
  "explicitLocalAction": {
    "fixtureSupported": true,
    "toastObserved": {
      "text": "Opened saved copy: /tmp/quanta-pulse-fixture/Lecture 12 - Graph Coloring.pdf",
      "visible": false,
      "panel": true
    },
    "panelRemainedOpenBeforeEscape": true
  },
  "screenshots": [
    "inspector-1280x800.png",
    "inspector-960x700.png"
  ]
}
```
