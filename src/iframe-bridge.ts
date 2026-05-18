// Script that runs INSIDE the sandboxed iframe. Written as a plain string so the
// CLI can inject it before </head> in the user's HTML, and the dev path can
// inject the same source. Keep this dependency-free — it runs against whatever
// the agent generated.
//
// String.raw keeps backslash escapes (\s, \n, etc. inside the regex literals
// below) intact but still evaluates ${…} substitutions at compile time. The
// body deliberately uses NO ${…} interpolations — add one and you'll get a
// JS-eval'd value baked into the bridge at build time, which is almost never
// what you want. If you need a JS variable here, treat it as host→bridge
// data and pass it via postMessage instead.
//
// IMPORTANT: the string literals "__htmlnote" and "data-htmlnote" below MUST
// stay in lockstep with BRIDGE_TAG and DATA_ATTR in src/shared/constants.ts.
// The bridge runs inside the user's iframe with no module system, so we
// can't import; if you rename the constants, hand-sync this file.

export const IFRAME_BRIDGE_SCRIPT = String.raw`
(function () {
  if (window.__htmlnoteBridge) return;
  window.__htmlnoteBridge = true;

  var mode = "preview"; // "preview" | "annotate"
  var hoverPaused = false; // true while a draft composer is open on the host
  var lastHover = null;
  var hoverOutline = null;
  var selectorLabel = null;

  function ensureOutline() {
    if (hoverOutline) return;
    hoverOutline = document.createElement("div");
    hoverOutline.setAttribute("data-htmlnote", "outline");
    hoverOutline.style.cssText = [
      "position:fixed",
      "pointer-events:none",
      "z-index:2147483646",
      "border:1px solid #f59e0b",
      "background:rgba(245,158,11,0.08)",
      "transition:all 60ms linear",
      "display:none",
    ].join(";");
    document.documentElement.appendChild(hoverOutline);

    selectorLabel = document.createElement("div");
    selectorLabel.setAttribute("data-htmlnote", "label");
    selectorLabel.style.cssText = [
      "position:fixed",
      "pointer-events:none",
      "z-index:2147483647",
      "font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
      "color:#0a0a0a",
      "background:#f59e0b",
      "padding:2px 6px",
      "border-radius:2px",
      "white-space:nowrap",
      "max-width:60vw",
      "overflow:hidden",
      "text-overflow:ellipsis",
      "display:none",
    ].join(";");
    document.documentElement.appendChild(selectorLabel);
  }

  function clearOutline() {
    if (!hoverOutline) return;
    hoverOutline.style.display = "none";
    selectorLabel.style.display = "none";
  }

  function isOwn(el) {
    return el && el.getAttribute && el.getAttribute("data-htmlnote") !== null;
  }

  // Build a reasonably stable CSS selector path for an element.
  function selectorPath(el) {
    if (!el || el === document.body || el === document.documentElement) return "body";
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 8) {
      if (node === document.body) { parts.unshift("body"); break; }
      var part = node.tagName.toLowerCase();
      if (node.id) {
        part = "#" + cssEscape(node.id);
        parts.unshift(part);
        break;
      }
      var cls = (node.getAttribute("class") || "")
        .trim().split(/\s+/).filter(Boolean).filter(function (c) {
          return !/^(hover|active|focus|is-|has-)/.test(c);
        });
      if (cls.length) part += "." + cls.slice(0, 2).map(cssEscape).join(".");
      var parent = node.parentElement;
      if (parent) {
        var sib = Array.prototype.filter.call(
          parent.children,
          function (c) { return c.tagName === node.tagName; },
        );
        if (sib.length > 1) {
          var i = sib.indexOf(node) + 1;
          part += ":nth-of-type(" + i + ")";
        }
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function describe(el) {
    var rect = el.getBoundingClientRect();
    var text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 500);
    // 6000 chars covers realistic landing-page sections (hero blocks,
    // pricing cards, nav containers with several children) without
    // their HTML getting truncated mid-element. Server-side validation
    // caps this at 10000 — bridge stays under that for safety.
    var outer = (el.outerHTML || "").slice(0, 6000);
    return {
      kind: "element",
      selector: selectorPath(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classes: el.getAttribute("class") || undefined,
      textContent: text || undefined,
      outerHTMLSnippet: outer,
      rect: rectToDoc(rect),
    };
  }

  function rectToDoc(r) {
    return {
      x: r.left + window.scrollX,
      y: r.top + window.scrollY,
      w: r.width,
      h: r.height,
    };
  }

  // Collect line-by-line rects for a Range. getClientRects returns one rect
  // per visual line, which is exactly what we need to draw multi-line text
  // highlights from the host side. Empty/zero-area rects (collapsed at the
  // end of a line) are filtered out.
  function rectsFromRange(range) {
    var raw = range.getClientRects();
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var r = raw[i];
      if (r.width <= 0 || r.height <= 0) continue;
      out.push(rectToDoc(r));
    }
    return out;
  }

  function describeSelection(sel) {
    if (!sel || sel.isCollapsed) return null;
    var text = sel.toString().replace(/\s+/g, " ").trim();
    if (!text) return null;
    var range = sel.getRangeAt(0);
    var ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType !== 1) ancestor = ancestor.parentElement;
    if (!ancestor || isOwn(ancestor)) return null;
    var rects = rectsFromRange(range);
    if (rects.length === 0) return null;
    var fullText = (ancestor.textContent || "").replace(/\s+/g, " ");
    var offset = fullText.indexOf(text);
    return {
      kind: "text",
      selector: selectorPath(ancestor),
      quotedText: text.slice(0, 240),
      charOffset: offset >= 0 ? offset : 0,
      rects: rects,
      primaryRect: rects[0],
    };
  }

  function paintOutline(el) {
    ensureOutline();
    var r = el.getBoundingClientRect();
    hoverOutline.style.left = r.left + "px";
    hoverOutline.style.top = r.top + "px";
    hoverOutline.style.width = r.width + "px";
    hoverOutline.style.height = r.height + "px";
    hoverOutline.style.display = "block";

    var sel = selectorPath(el);
    selectorLabel.textContent = sel;
    selectorLabel.style.left = Math.min(r.left, window.innerWidth - 320) + "px";
    var top = r.top - 18;
    if (top < 4) top = r.bottom + 4;
    selectorLabel.style.top = top + "px";
    selectorLabel.style.display = "block";
  }

  function send(msg) { window.parent.postMessage({ __htmlnote: true, ...msg }, "*"); }

  document.addEventListener("mousemove", function (e) {
    if (mode !== "annotate") return clearOutline();
    // While a host composer is open, pin the outline to the just-clicked
    // element instead of letting the cursor drag it around — the user is
    // typing, not picking a new target.
    if (hoverPaused) return;
    var el = e.target;
    if (!el || el.nodeType !== 1) return; // defensive: skip non-elements
    if (isOwn(el)) return;
    if (el === lastHover) return;
    lastHover = el;
    paintOutline(el);
  }, true);

  document.addEventListener("mouseleave", function () {
    // While a composer is open the outline is anchoring the user to the
    // element they're writing about. The composer lives outside the iframe,
    // so the cursor MUST leave the iframe to reach it — without this guard
    // that very motion clears the outline.
    if (hoverPaused) return;
    lastHover = null;
    clearOutline();
  }, true);

  // Annotate-mode logic lives on mouseup so we can inspect window.getSelection()
  // before the browser collapses it. Text-drag → text annotation; plain click
  // → element annotation. The click handler below only suppresses default
  // navigation; it does NOT send anything.
  document.addEventListener("mouseup", function (e) {
    if (mode !== "annotate") return;
    var el = e.target;
    if (!el || el.nodeType !== 1 || isOwn(el)) return;
    var selection = window.getSelection();
    var textTarget = describeSelection(selection);
    if (textTarget) {
      send({ type: "textSelect", target: textTarget });
      if (selection && selection.removeAllRanges) selection.removeAllRanges();
      return;
    }
    send({ type: "click", target: describe(el) });
  }, true);

  // Forward non-modifier keys to the host so global hotkeys (E, N, J, K, ?,
  // Esc) still fire when the iframe document has focus. Without this the
  // first keystroke after clicking the rendered HTML is silently swallowed
  // because keydown events in the iframe don't bubble to the parent window.
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // let the browser have ⌘/Ctrl combos
    var t = e.target;
    if (
      t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
        (t.isContentEditable === true))
    ) return; // user is typing into an AI-generated form field
    send({ type: "key", key: e.key, shiftKey: e.shiftKey });
  });

  // Forward wheel events to the host. The iframe is sandbox="allow-scripts"
  // (no allow-same-origin), which makes it cross-origin to the parent.
  // Cross-origin iframes trap wheel events at the iframe document once it
  // has focus; since the iframe is sized to content (no internal scroll),
  // the wheel produces no visible scroll and the outer .canvas-wrap never
  // sees it. Forwarding deltas via postMessage routes around this — the
  // host applies them to its scroll container.
  document.addEventListener(
    "wheel",
    function (e) {
      send({ type: "wheel", deltaX: e.deltaX, deltaY: e.deltaY });
    },
    { passive: true },
  );

  document.addEventListener("click", function (e) {
    var el = e.target;
    if (!el || el.nodeType !== 1 || isOwn(el)) return;
    if (mode === "annotate") {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Preview mode: block link navigation that would leave the page (which
    // would drop our bridge), but allow in-page anchor jumps. The sandbox
    // already blocks top-frame nav, but iframe-self nav is still possible.
    var a = el.closest && el.closest("a[href]");
    if (a) {
      var href = a.getAttribute("href") || "";
      if (href && href.charAt(0) !== "#") e.preventDefault();
    }
  }, true);

  function emitResize() {
    send({
      type: "resize",
      w: document.documentElement.scrollWidth,
      h: document.documentElement.scrollHeight,
    });
  }

  window.addEventListener("resize", emitResize);

  // Track dynamic content size — pages with lazy-loaded images, <details>
  // toggles, or SPA mutations otherwise leave stale doc dimensions. We
  // observe <body> rather than <html>: <html>'s content box equals the
  // viewport (so it only fires on window.resize, which we already handle),
  // whereas <body> grows as DOM is added.
  if (typeof ResizeObserver !== "undefined" && document.body) {
    var lastH = 0;
    var lastW = 0;
    var ro = new ResizeObserver(function () {
      var w = document.documentElement.scrollWidth;
      var h = document.documentElement.scrollHeight;
      if (w === lastW && h === lastH) return;
      lastW = w; lastH = h;
      emitResize();
    });
    ro.observe(document.body);
  }

  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || !m.__htmlnote) return;
    if (m.type === "setMode") {
      mode = m.mode;
      if (mode === "preview") clearOutline();
      document.documentElement.style.cursor =
        mode === "annotate" && !hoverPaused ? "crosshair" : "";
    } else if (m.type === "setHoverPaused") {
      hoverPaused = !!m.paused;
      // Don't clearOutline on pause: the outline currently shows the element
      // the user just clicked, and we want that anchor visible while they
      // type. Reset lastHover so resuming triggers a fresh paint on the next
      // mousemove instead of skipping it as "same as before."
      lastHover = null;
      // Drop the crosshair while a composer is open so the cursor reflects
      // the actual interactive state (typing, not picking another target).
      document.documentElement.style.cursor =
        mode === "annotate" && !hoverPaused ? "crosshair" : "";
    } else if (m.type === "highlight") {
      if (!m.selector) return clearOutline();
      try {
        var el = document.querySelector(m.selector);
        if (el) paintOutline(el);
      } catch (_) {}
    }
  });

  function reportReady() {
    send({
      type: "ready",
      doc: {
        w: document.documentElement.scrollWidth,
        h: document.documentElement.scrollHeight,
      },
      title: document.title,
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", reportReady);
  } else {
    reportReady();
  }
})();
`;
