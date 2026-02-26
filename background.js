const api = typeof browser !== "undefined" ? browser : chrome;

function storageGet(key) {
  return new Promise((resolve) => {
    api.storage.local.get(key, (result) => {
      resolve(result);
    });
  });
}

function storageSet(data) {
  return new Promise((resolve) => {
    api.storage.local.set(data, () => {
      resolve();
    });
  });
}

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    api.runtime.sendMessage(msg, (response) => {
      if (api.runtime.lastError) {
        reject(api.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

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

let options = null;
let timerState = {
  status: "idle",
  totalSeconds: 0,
  remainingSeconds: 0,
  startedAt: null,
  pausedRemaining: null,
};

let tickInterval = null;
let audioCtx = null;
let alarmInterval = null;
let alarmTimeout = null;

// ── Options ──

async function loadOptions() {
  const result = await storageGet("options");
  options = Object.assign({}, DEFAULT_OPTIONS, result.options || {});
  if (!Array.isArray(options.presets) || options.presets.length !== 3) {
    options.presets = DEFAULT_OPTIONS.presets;
  }
  return options;
}

// ── Init ──

async function init() {
  await loadOptions();
  const result = await storageGet("timerState");
  if (result.timerState) {
    timerState = result.timerState;
    if (timerState.status === "running") {
      const elapsed = (Date.now() - timerState.startedAt) / 1000;
      timerState.remainingSeconds = Math.max(0, timerState.pausedRemaining - elapsed);
      if (timerState.remainingSeconds <= 0) {
        timerFinished();
      } else {
        startTicking();
      }
    } else if (timerState.status === "paused") {
      timerState.remainingSeconds = timerState.pausedRemaining;
      updateBadge();
    } else if (timerState.status === "finished") {
      updateBadge();
      startAlarm();
    }
  }
}

init();

// ── State ──

function saveState() {
  storageSet({ timerState });
}

function startTicking() {
  stopTicking();
  updateBadge();
  tickInterval = setInterval(() => {
    if (timerState.status !== "running") {
      stopTicking();
      return;
    }
    const elapsed = (Date.now() - timerState.startedAt) / 1000;
    timerState.remainingSeconds = Math.max(0, timerState.pausedRemaining - elapsed);
    if (timerState.remainingSeconds <= 0) {
      timerFinished();
    } else {
      updateBadge();
    }
  }, 500);
}

function stopTicking() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function timerFinished() {
  stopTicking();
  timerState.status = "finished";
  timerState.remainingSeconds = 0;
  saveState();
  updateBadge();
  startAlarm();
  sendMessage({ type: "finished" }).catch(() => {});

  if (options && options.showToast) {
    api.notifications.create("tea-timer-done", {
      type: "basic",
      iconUrl: api.runtime.getURL("icons/timer.svg"),
      title: "Tea Timer",
      message: (options && options.toastText) || DEFAULT_OPTIONS.toastText,
    });
  }
}

function resetTimer() {
  stopTicking();
  stopAlarm();
  timerState.status = "idle";
  timerState.totalSeconds = 0;
  timerState.remainingSeconds = 0;
  timerState.startedAt = null;
  timerState.pausedRemaining = null;
  saveState();
  updateBadge();
}

// ── Badge ──

function updateBadge() {
  const r = Math.ceil(timerState.remainingSeconds);

  // Use browserAction for MV2, action for MV3
  const badgeApi = api.browserAction || api.action;

  if (timerState.status === "idle") {
    badgeApi.setBadgeText({ text: "" });
    return;
  }

  if (timerState.status === "finished") {
    badgeApi.setBadgeText({ text: "!" });
    badgeApi.setBadgeBackgroundColor({ color: "#d93025" });
    if (badgeApi.setBadgeTextColor) {
      badgeApi.setBadgeTextColor({ color: "#ffffff" });
    }
    return;
  }

  let text;
  if (r >= 3600) {
    text = Math.ceil(r / 3600) + "h";
  } else if (r >= 60) {
    text = Math.ceil(r / 60) + "m";
  } else {
    text = r + "s";
  }

  badgeApi.setBadgeText({ text });
  badgeApi.setBadgeBackgroundColor({
    color: r <= 10 ? "#d93025" : r <= 30 ? "#ea8600" : "#1a73e8",
  });
  if (badgeApi.setBadgeTextColor) {
    badgeApi.setBadgeTextColor({ color: "#ffffff" });
  }
}

// ── Sound ──

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function pingOnce() {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    [880, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + i * 0.18);
      gain.gain.setValueAtTime(0, now + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.35, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.45);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.5);
    });
  } catch (e) {
    console.warn("Audio ping failed:", e);
  }
}

function startAlarm() {
  if (alarmInterval) return;
  pingOnce();
  alarmInterval = setInterval(pingOnce, 1200);

  // Auto-dismiss
  clearAlarmTimeout();
  if (options && options.autoDismiss) {
    const dur = (options.alarmDuration || DEFAULT_OPTIONS.alarmDuration) * 1000;
    alarmTimeout = setTimeout(() => {
      stopAlarm();
      // Auto-reset to idle after alarm ends
      resetTimer();
      sendMessage({ type: "stateChanged" }).catch(() => {});
    }, dur);
  }
}

function stopAlarm() {
  if (alarmInterval) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
  clearAlarmTimeout();
}

function clearAlarmTimeout() {
  if (alarmTimeout) {
    clearTimeout(alarmTimeout);
    alarmTimeout = null;
  }
}

// ── Messages ──

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case "start":
      stopAlarm();
      timerState.status = "running";
      timerState.totalSeconds = msg.totalSeconds;
      timerState.remainingSeconds = msg.totalSeconds;
      timerState.pausedRemaining = msg.totalSeconds;
      timerState.startedAt = Date.now();
      saveState();
      startTicking();
      sendResponse({ ok: true });
      break;

    case "pause":
      if (timerState.status === "running") {
        const elapsed = (Date.now() - timerState.startedAt) / 1000;
        timerState.pausedRemaining = Math.max(0, timerState.pausedRemaining - elapsed);
        timerState.remainingSeconds = timerState.pausedRemaining;
        timerState.status = "paused";
        stopTicking();
        saveState();
        updateBadge();
      }
      sendResponse({ ok: true });
      break;

    case "resume":
      if (timerState.status === "paused") {
        timerState.status = "running";
        timerState.startedAt = Date.now();
        saveState();
        startTicking();
      }
      sendResponse({ ok: true });
      break;

    case "reset":
      resetTimer();
      sendResponse({ ok: true });
      break;

    case "addTime":
      if (timerState.status === "running") {
        timerState.pausedRemaining += msg.seconds;
        timerState.totalSeconds += msg.seconds;
      } else if (timerState.status === "paused") {
        timerState.pausedRemaining += msg.seconds;
        timerState.remainingSeconds = timerState.pausedRemaining;
        timerState.totalSeconds += msg.seconds;
      }
      saveState();
      sendResponse({ ok: true });
      break;

    case "getState":
      if (timerState.status === "running") {
        const elapsed = (Date.now() - timerState.startedAt) / 1000;
        timerState.remainingSeconds = Math.max(0, timerState.pausedRemaining - elapsed);
      }
      sendResponse({
        status: timerState.status,
        totalSeconds: timerState.totalSeconds,
        remainingSeconds: timerState.remainingSeconds,
      });
      break;

    case "getOptions":
      if (options) {
        sendResponse(options);
      } else {
        loadOptions().then((o) => sendResponse(o));
        return true;
      }
      break;

    case "optionsChanged":
      loadOptions().then(() => {
        sendMessage({ type: "optionsUpdated" }).catch(() => {});
      });
      sendResponse({ ok: true });
      break;
  }
  return true;
});

api.notifications.onClicked.addListener((id) => {
  if (id === "tea-timer-done") {
    resetTimer();
    api.notifications.clear(id);
    sendMessage({ type: "stateChanged" }).catch(() => {});
  }
});