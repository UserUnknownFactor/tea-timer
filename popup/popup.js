(() => {
  // ── Dark mode: use Firefox theme API ──
  (function applyInitialTheme() {
    const saved = localStorage.getItem("sticky_theme");
    const isDark = saved === "dark";
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.style.backgroundColor = isDark ? "#202124" : "#ffffff";
  })();
  
  async function updateTheme() {
    const STORAGE_KEY = "sticky_theme";
    const root = document.documentElement;
    const currentlyAppliedIsDark = root.classList.contains("dark");
  
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  
      if (tabs[0] && tabs[0].url && (tabs[0].url.startsWith("http") || tabs[0].url.startsWith("file"))) {
        
        const result = await browser.tabs.executeScript(tabs[0].id, {
          code: "window.matchMedia('(prefers-color-scheme: dark)').matches"
        });
  
        if (result && typeof result[0] === "boolean") {
          const detectedDark = result[0];
  
          if (detectedDark !== currentlyAppliedIsDark) {
            localStorage.setItem(STORAGE_KEY, detectedDark ? "dark" : "light");
            root.classList.toggle("dark", detectedDark);
            root.style.backgroundColor = detectedDark ? "#202124" : "#ffffff";
          }
          return;
        }
      }
    } catch (e) {
      console.log("Restricted page, maintaining sticky theme.");
    }
  }
  
  updateTheme();

  // ── Elements ──
  const $ = (s) => document.getElementById(s);
  const minIn = $("minInput");
  const secIn = $("secInput");
  const inputArea = $("inputArea");
  const countdownArea = $("countdownArea");
  const countdownTime = $("countdownTime");
  const countdownLabel = $("countdownLabel");
  const ringFg = $("ringFg");
  const presetRow = $("presetRow");
  const btnStart = $("btnStart");
  const btnPause = $("btnPause");
  const btnResume = $("btnResume");
  const btnReset = $("btnReset");
  const overlay = $("overlay");
  const doneText = $("doneText");
  const btnDismiss = $("btnDismiss");
  const btnSettings = $("btnSettings");

  const R = 84;
  const C = 2 * Math.PI * R;
  let pollTimer = null;
  let currentOptions = null;
  let activePresetIndex = -1;

  // ── Tick marks ──
  (() => {
    const g = $("tickMarks");
    for (let i = 0; i < 60; i++) {
      const ang = (i * 6 - 90) * (Math.PI / 180);
      const major = i % 5 === 0;
      const r1 = major ? 91 : 93;
      const r2 = 97;
      const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
      l.setAttribute("x1", 100 + r1 * Math.cos(ang));
      l.setAttribute("y1", 100 + r1 * Math.sin(ang));
      l.setAttribute("x2", 100 + r2 * Math.cos(ang));
      l.setAttribute("y2", 100 + r2 * Math.sin(ang));
      if (major) l.classList.add("major");
      g.appendChild(l);
    }
  })();

  ringFg.style.strokeDasharray = C;
  ringFg.style.strokeDashoffset = 0;

  const pad = (n) => String(n).padStart(2, "0");

  function clamp(el, max) {
    let v = el.value.replace(/\D/g, "").slice(0, 2);
    let n = parseInt(v, 10);
    if (isNaN(n)) n = 0;
    if (n > max) n = max;
    return n;
  }

  function fmt(secs) {
    return pad(Math.floor(secs / 60)) + ":" + pad(Math.floor(secs % 60));
  }

  function setProgress(frac) {
    const f = Math.max(0, Math.min(1, frac));
    ringFg.style.strokeDashoffset = C * (1 - f);
    ringFg.classList.remove("warn", "crit", "done");
    if (f <= 0) ringFg.classList.add("done");
    else if (f < 0.1) ringFg.classList.add("crit");
    else if (f < 0.25) ringFg.classList.add("warn");
  }

  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }

  // ── Build presets ──
  function buildPresets(opts) {
    currentOptions = opts;
    presetRow.innerHTML = "";
    activePresetIndex = -1;
    if (!opts || !opts.presets) return;

    opts.presets.forEach((p, i) => {
      const totalSec = (p.minutes || 0) * 60 + (p.seconds || 0);
      if (totalSec <= 0) return;

      const btn = document.createElement("button");
      btn.className = "preset";
      btn.dataset.index = i;
      btn.dataset.min = p.minutes || 0;
      btn.dataset.sec = p.seconds || 0;
      btn.title = (p.label || "Timer") + " — " + fmt(totalSec);

      const nameSpan = document.createElement("span");
      nameSpan.className = "preset-name";
      nameSpan.textContent = p.label || "Timer";

      const timeSpan = document.createElement("span");
      timeSpan.className = "preset-time";
      timeSpan.textContent = fmt(totalSec);

      btn.appendChild(nameSpan);
      btn.appendChild(timeSpan);

      btn.addEventListener("click", () => {
        document.querySelectorAll(".preset").forEach((b) =>
          b.classList.remove("active"));
        btn.classList.add("active");
        activePresetIndex = i;
        minIn.value = pad(p.minutes || 0);
        secIn.value = pad(p.seconds || 0);
      });

      presetRow.appendChild(btn);
    });

    matchPresetToInputs();
  }

  function matchPresetToInputs() {
    if (!currentOptions || !currentOptions.presets) return;
    const m = parseInt(minIn.value, 10) || 0;
    const s = parseInt(secIn.value, 10) || 0;
    activePresetIndex = -1;
    document.querySelectorAll(".preset").forEach((btn) => {
      const pm = parseInt(btn.dataset.min, 10) || 0;
      const ps = parseInt(btn.dataset.sec, 10) || 0;
      const match = pm === m && ps === s;
      btn.classList.toggle("active", match);
      if (match) activePresetIndex = parseInt(btn.dataset.index, 10);
    });
  }

  function loadOptions() {
    browser.runtime.sendMessage({ type: "getOptions" }).then((opts) => {
      buildPresets(opts);
      if (opts && opts.toastText) {
        doneText.textContent = opts.toastText;
      }
    }).catch(() => {});
  }

  // ── Input events ──
  [minIn, secIn].forEach((el) => {
    el.addEventListener("focus", () => el.select());
    el.addEventListener("input", () => {
      el.value = el.value.replace(/\D/g, "").slice(0, 2);
      matchPresetToInputs();
    });
  });

  minIn.addEventListener("blur", () => {
    minIn.value = pad(clamp(minIn, 99));
    matchPresetToInputs();
  });
  secIn.addEventListener("blur", () => {
    secIn.value = pad(clamp(secIn, 59));
    matchPresetToInputs();
  });

  minIn.addEventListener("keydown", (e) => {
    if (e.key === ":" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault(); secIn.focus();
    }
    if (e.key === "Enter") { e.preventDefault(); doStart(); }
  });
  secIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); doStart(); }
  });

  // ── Quick-add ──
  document.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const add = parseInt(btn.dataset.sec, 10);
      browser.runtime.sendMessage({ type: "getState" }).then((st) => {
        if (st.status === "idle") {
          let total = (parseInt(minIn.value, 10) || 0) * 60
                    + (parseInt(secIn.value, 10) || 0) + add;
          minIn.value = pad(Math.min(99, Math.floor(total / 60)));
          secIn.value = pad(total % 60);
          matchPresetToInputs();
        } else if (st.status === "running" || st.status === "paused") {
          browser.runtime.sendMessage({ type: "addTime", seconds: add });
        }
      });
    });
  });

  // ── Controls ──
  btnStart.addEventListener("click", doStart);
  btnPause.addEventListener("click", () =>
    browser.runtime.sendMessage({ type: "pause" }));
  btnResume.addEventListener("click", () =>
    browser.runtime.sendMessage({ type: "resume" }));
  btnReset.addEventListener("click", () =>
    browser.runtime.sendMessage({ type: "reset" }));
  btnDismiss.addEventListener("click", () =>
    browser.runtime.sendMessage({ type: "reset" }));
  btnSettings.addEventListener("click", () => {
    browser.runtime.openOptionsPage();
    window.close();
  });

  function doStart() {
    const m = clamp(minIn, 99);
    const s = clamp(secIn, 59);
    const total = m * 60 + s;
    if (total <= 0) {
      minIn.classList.add("shake");
      secIn.classList.add("shake");
      setTimeout(() => {
        minIn.classList.remove("shake");
        secIn.classList.remove("shake");
      }, 400);
      return;
    }
    browser.runtime.sendMessage({ type: "start", totalSeconds: total });
  }

  function updateUI(state) {
    const { status, totalSeconds, remainingSeconds } = state;
    switch (status) {
      case "idle":
        show(inputArea); hide(countdownArea);
        show(btnStart); hide(btnPause); hide(btnResume); hide(btnReset);
        presetRow.style.display = "";
        hide(overlay);
        setProgress(1);
        break;
      case "running":
        hide(inputArea); show(countdownArea);
        countdownTime.textContent = fmt(remainingSeconds);
        countdownLabel.textContent = "remaining";
        hide(btnStart); show(btnPause); hide(btnResume); show(btnReset);
        presetRow.style.display = "none";
        hide(overlay);
        if (totalSeconds > 0) setProgress(remainingSeconds / totalSeconds);
        break;
      case "paused":
        hide(inputArea); show(countdownArea);
        countdownTime.textContent = fmt(remainingSeconds);
        countdownLabel.textContent = "paused";
        hide(btnStart); hide(btnPause); show(btnResume); show(btnReset);
        presetRow.style.display = "none";
        hide(overlay);
        if (totalSeconds > 0) setProgress(remainingSeconds / totalSeconds);
        break;
      case "finished":
        hide(inputArea); show(countdownArea);
        countdownTime.textContent = "00:00";
        countdownLabel.textContent = "done!";
        hide(btnStart); hide(btnPause); hide(btnResume); hide(btnReset);
        presetRow.style.display = "none";
        show(overlay);
        setProgress(0);
        break;
    }
  }

  function poll() {
    browser.runtime.sendMessage({ type: "getState" })
      .then(updateUI).catch(() => {});
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "finished" || msg.type === "stateChanged") poll();
    if (msg.type === "optionsUpdated") loadOptions();
  });

  loadOptions();
  poll();
  pollTimer = setInterval(poll, 400);
  window.addEventListener("unload", () => {
    if (pollTimer) clearInterval(pollTimer);
  });
})();