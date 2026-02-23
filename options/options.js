(() => {
  const DEFAULT_OPTIONS = {
    presets: [
      { label: "Green", minutes: 2, seconds: 0 },
      { label: "Black", minutes: 4, seconds: 0 },
      { label: "Herbal", minutes: 7, seconds: 0 }
    ],
    showToast: true,
    toastText: "Your tea is ready! 🍵",
    autoDismiss: true,
    alarmDuration: 15
  };

  const presetItems = document.querySelectorAll(".preset-item");
  const showToastEl = document.getElementById("showToast");
  const toastTextEl = document.getElementById("toastText");
  const toastTextRow = document.getElementById("toastTextRow");
  const autoDismissEl = document.getElementById("autoDismiss");
  const alarmDurationEl = document.getElementById("alarmDuration");
  const alarmDurationRow = document.getElementById("alarmDurationRow");
  const durBtns = document.querySelectorAll(".dur-btn");
  const btnSave = document.getElementById("btnSave");
  const btnReset = document.getElementById("btnReset");
  const savedToast = document.getElementById("savedToast");

  // ── Load ──

  async function load() {
    const result = await browser.storage.local.get("options");
    const opts = Object.assign({}, DEFAULT_OPTIONS, result.options || {});
    if (!Array.isArray(opts.presets) || opts.presets.length !== 3) {
      opts.presets = DEFAULT_OPTIONS.presets;
    }
    fillForm(opts);
  }

  // ── Fill form ──

  function fillForm(opts) {
    presetItems.forEach((item, i) => {
      const p = opts.presets[i];
      item.querySelector(".preset-label").value = p.label || "";
      item.querySelector(".preset-min").value = p.minutes || 0;
      item.querySelector(".preset-sec").value = p.seconds || 0;
    });

    showToastEl.checked = opts.showToast !== false;
    toastTextEl.value = opts.toastText || DEFAULT_OPTIONS.toastText;

    autoDismissEl.checked = opts.autoDismiss !== false;
    const dur = opts.alarmDuration || DEFAULT_OPTIONS.alarmDuration;
    alarmDurationEl.value = dur;

    durBtns.forEach((b) => {
      b.classList.toggle("active", parseInt(b.dataset.val, 10) === dur);
    });

    updateVisibility();
  }

  // ── Read form ──

  function readForm() {
    const presets = [];
    presetItems.forEach((item) => {
      presets.push({
        label: item.querySelector(".preset-label").value.trim() || "Timer",
        minutes: Math.max(0, Math.min(99,
          parseInt(item.querySelector(".preset-min").value, 10) || 0)),
        seconds: Math.max(0, Math.min(59,
          parseInt(item.querySelector(".preset-sec").value, 10) || 0)),
      });
    });

    let dur = parseInt(alarmDurationEl.value, 10);
    if (isNaN(dur) || dur < 3) dur = 3;
    if (dur > 300) dur = 300;

    return {
      presets,
      showToast: showToastEl.checked,
      toastText: toastTextEl.value.trim() || DEFAULT_OPTIONS.toastText,
      autoDismiss: autoDismissEl.checked,
      alarmDuration: dur,
    };
  }

  // ── Visibility toggling ──

  function updateVisibility() {
    toastTextRow.style.display = showToastEl.checked ? "" : "none";
    alarmDurationRow.style.display = autoDismissEl.checked ? "" : "none";
  }

  showToastEl.addEventListener("change", updateVisibility);
  autoDismissEl.addEventListener("change", updateVisibility);

  // ── Duration quick-pick ──

  durBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      durBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      alarmDurationEl.value = btn.dataset.val;
    });
  });

  alarmDurationEl.addEventListener("input", () => {
    const v = parseInt(alarmDurationEl.value, 10);
    durBtns.forEach((b) => {
      b.classList.toggle("active", parseInt(b.dataset.val, 10) === v);
    });
  });

  // ── Save ──

  btnSave.addEventListener("click", async () => {
    const opts = readForm();
    await browser.storage.local.set({ options: opts });
    browser.runtime.sendMessage({ type: "optionsChanged" }).catch(() => {});
    showSavedFeedback();
  });

  // ── Reset ──

  btnReset.addEventListener("click", () => {
    fillForm(DEFAULT_OPTIONS);
  });

  // ── Save feedback toast ──

  let toastTimer = null;

  function showSavedFeedback() {
    savedToast.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      savedToast.classList.add("hidden");
    }, 2500);
  }

  // ── Init ──

  load();
})();