/**
 * Virtual clock (the heart of TockMux).
 *
 * A normal browser animates against the wall clock, so a screen recorder captures
 * whatever happens to be on screen when the CPU gets around to it. That is why
 * recordings stutter and differ from run to run.
 *
 * Instead we replace every time source the page can see with one we control:
 *   setTimeout / setInterval / requestAnimationFrame / requestIdleCallback
 *   Date / performance.now()
 *   CSS animations, CSS transitions and Web Animations (seeked explicitly)
 *   <video> elements (seeked explicitly)
 *   Math.random (seeded, so repeat renders are identical)
 *
 * The renderer then calls `window.__tmx.stepTo(ms)` once per video frame and takes a
 * screenshot. Time only moves when we say so, so a slow machine gives the same
 * frames as a fast one.
 *
 * `clockMain` is stringified and injected before any page script runs, so it must
 * not reference anything outside its own body.
 */
function clockMain(cfg) {
  if (window.__tmx) return;

  const RealDate = Date;
  const realSetTimeout = window.setTimeout.bind(window);
  const S = {
    now: 0,
    lastSync: 0,
    nextId: 1,
    seq: 0,
    timers: new Map(),
    raf: new Map(),
    rafId: 1,
    errors: [],
    notes: [],
    actions: [],
    actionIdx: 0,
    autoscroll: null
  };

  const report = (e) => {
    try {
      if (typeof reportError === "function") reportError(e);
      else console.error(e);
    } catch (_) {
      /* ignore */
    }
  };

  /* ---------- Math.random: seeded so every render is identical ---------- */
  if (cfg.seed !== null && cfg.seed !== undefined) {
    let a = cfg.seed >>> 0;
    Math.random = function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- Date ---------- */
  const FakeDate = new Proxy(RealDate, {
    construct(target, args) {
      if (args.length === 0) return new target(cfg.epoch + S.now);
      return new target(...args);
    },
    apply(target) {
      return new target(cfg.epoch + S.now).toString();
    },
    get(target, prop) {
      if (prop === "now") return () => cfg.epoch + S.now;
      return Reflect.get(target, prop, target);
    }
  });
  try {
    window.Date = FakeDate;
  } catch (_) {
    /* ignore */
  }
  try {
    performance.now = () => S.now;
  } catch (_) {
    /* ignore */
  }

  /* ---------- Timers ---------- */
  const addTimer = (fn, delay, args, repeat) => {
    if (typeof fn === "string") {
      const src = fn;
      fn = () => (0, eval)(src);
    }
    if (typeof fn !== "function") return 0;
    let d = Number(delay);
    if (!(d >= 0)) d = 0;
    d = Math.max(1, d); // browsers clamp to >= 1ms; also prevents zero-delay loops
    const id = S.nextId++;
    S.timers.set(id, { id, fn, args, at: S.now + d, seq: S.seq++, repeat: repeat ? d : 0 });
    return id;
  };
  window.setTimeout = (fn, delay, ...args) => addTimer(fn, delay, args, false);
  window.setInterval = (fn, delay, ...args) => addTimer(fn, delay, args, true);
  window.clearTimeout = (id) => {
    S.timers.delete(id);
  };
  window.clearInterval = window.clearTimeout;
  window.requestIdleCallback = (cb) =>
    addTimer(() => cb({ didTimeout: false, timeRemaining: () => 16 }), 1, [], false);
  window.cancelIdleCallback = window.clearTimeout;

  function runTimers(target) {
    let guard = 0;
    for (;;) {
      let best = null;
      for (const t of S.timers.values()) {
        if (t.at <= target && (!best || t.at < best.at || (t.at === best.at && t.seq < best.seq))) best = t;
      }
      if (!best) break;
      if (++guard > 200000) {
        S.errors.push("Too many timers fired in one frame (possible infinite setTimeout loop).");
        break;
      }
      S.now = Math.max(S.now, best.at);
      if (best.repeat) {
        best.at += best.repeat;
        best.seq = S.seq++;
      } else {
        S.timers.delete(best.id);
      }
      try {
        best.fn.apply(window, best.args);
      } catch (e) {
        report(e);
      }
    }
    S.now = target;
  }

  /* ---------- requestAnimationFrame ---------- */
  window.requestAnimationFrame = (cb) => {
    const id = S.rafId++;
    S.raf.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    S.raf.delete(id);
  };
  function runRaf() {
    const batch = Array.from(S.raf.values());
    S.raf.clear();
    for (const cb of batch) {
      try {
        cb(S.now);
      } catch (e) {
        report(e);
      }
    }
  }

  /* ---------- CSS animations, transitions, Web Animations ---------- */
  const meta = new WeakMap();
  function track(anim, base) {
    if (meta.has(anim)) return meta.get(anim);
    const m = { base };
    meta.set(anim, m);
    try {
      anim.pause();
    } catch (_) {
      /* ignore */
    }
    return m;
  }
  try {
    const origAnimate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const anim = origAnimate.apply(this, args);
      track(anim, S.now);
      return anim;
    };
  } catch (_) {
    /* ignore */
  }
  function syncAnimations() {
    let list;
    try {
      list = document.getAnimations();
    } catch (_) {
      return;
    }
    for (const a of list) {
      const m = meta.get(a) || track(a, S.lastSync);
      try {
        a.currentTime = Math.max(0, S.now - m.base);
      } catch (_) {
        /* ignore */
      }
    }
    S.lastSync = S.now;
  }

  // Freeze CSS animations from the very first style resolution, so none of them
  // advances in real time while the page is loading.
  const FREEZE_CSS =
    "*,*::before,*::after{animation-play-state:paused !important;scroll-behavior:auto !important;caret-color:transparent !important}";
  const injectFreeze = () => {
    const root = document.documentElement;
    if (!root) return false;
    const st = document.createElement("style");
    st.id = "__tmx_freeze";
    st.textContent = FREEZE_CSS;
    root.appendChild(st);
    return true;
  };
  if (!injectFreeze()) {
    const mo = new MutationObserver(() => {
      if (injectFreeze()) mo.disconnect();
    });
    mo.observe(document, { childList: true });
  }

  /* ---------- <video> elements ---------- */
  function syncVideos() {
    const waits = [];
    for (const v of document.querySelectorAll("video")) {
      if (!v.__tmx) v.__tmx = { base: S.lastSync };
      try {
        v.pause();
      } catch (_) {
        /* ignore */
      }
      if (v.readyState < 1) continue;
      let target = Math.max(0, (S.now - v.__tmx.base) / 1000);
      const dur = v.duration;
      if (isFinite(dur) && dur > 0) target = v.loop ? target % dur : Math.min(target, dur - 0.001);
      if (Math.abs(v.currentTime - target) > 0.0005) {
        waits.push(
          new Promise((resolve) => {
            const done = () => {
              v.removeEventListener("seeked", done);
              resolve();
            };
            v.addEventListener("seeked", done);
            realSetTimeout(done, 1500);
            v.currentTime = target;
          })
        );
      }
    }
    return waits;
  }

  /* ---------- scripted actions & autoscroll ---------- */
  function runDueActions() {
    while (S.actionIdx < S.actions.length && S.actions[S.actionIdx].at <= S.now + 1e-6) {
      const a = S.actions[S.actionIdx++];
      try {
        if (a.type === "click") {
          const el = document.querySelector(a.selector);
          if (el) el.click();
          else S.notes.push("Action target not found: " + a.selector);
        } else if (a.type === "scroll") {
          window.scrollTo(0, a.y || 0);
        }
      } catch (e) {
        S.notes.push("Action failed: " + (e && e.message));
      }
    }
  }
  function applyAutoscroll() {
    if (!S.autoscroll) return;
    const el = document.scrollingElement || document.documentElement;
    const max = Math.max(0, el.scrollHeight - window.innerHeight);
    const { startMs, durationMs } = S.autoscroll;
    let p = durationMs > 0 ? (S.now - startMs) / durationMs : 1;
    p = Math.min(1, Math.max(0, p));
    const eased = p * p * (3 - 2 * p);
    window.scrollTo(0, Math.round(max * eased));
  }

  /* ---------- public API used by the renderer ---------- */
  async function flush() {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  }

  const api = {
    version: 1,
    prepare(opts) {
      S.actions = (opts.actions || []).slice().sort((x, y) => x.at - y.at);
      S.actionIdx = 0;
      S.autoscroll = opts.autoscroll || null;
      runDueActions();
      applyAutoscroll();
      syncAnimations();
      return true;
    },
    async stepTo(ms) {
      if (ms < S.now) return S.now;
      runTimers(ms);
      runDueActions();
      applyAutoscroll();
      syncAnimations();
      runRaf();
      syncAnimations();
      if (typeof window.__seek === "function") {
        try {
          await window.__seek(S.now);
        } catch (e) {
          report(e);
        }
      }
      await flush();
      const waits = syncVideos();
      if (waits.length) await Promise.all(waits);
      return S.now;
    },
    async fastForward(fromFrame, toFrame, frameMs) {
      for (let i = fromFrame; i <= toFrame; i++) await api.stepTo(i * frameMs);
      return S.now;
    },
    now: () => S.now,
    take() {
      const out = { errors: S.errors.splice(0), notes: S.notes.splice(0) };
      return out;
    },
    info() {
      let finiteEnd = 0;
      let infinite = 0;
      try {
        for (const a of document.getAnimations()) {
          const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
          if (!t) continue;
          if (isFinite(t.endTime)) finiteEnd = Math.max(finiteEnd, t.endTime);
          else infinite++;
        }
      } catch (_) {
        /* ignore */
      }
      const el = document.scrollingElement || document.documentElement;
      return {
        title: document.title,
        finiteAnimationEndMs: finiteEnd,
        infiniteAnimations: infinite,
        scrollWidth: el.scrollWidth,
        scrollHeight: el.scrollHeight,
        videos: document.querySelectorAll("video").length,
        audios: document.querySelectorAll("audio").length,
        hasSeekHook: typeof window.__seek === "function",
        readyFlag: typeof window.__READY === "undefined" ? null : window.__READY === true
      };
    }
  };
  Object.defineProperty(window, "__tmx", { value: api, enumerable: false });
}

/** Returns JavaScript source to inject with `page.addInitScript({ content })`. */
export function buildClockScript({ seed = 1337, epoch = 1767225600000 } = {}) {
  return `(${clockMain.toString()})(${JSON.stringify({ seed, epoch })});`;
}
