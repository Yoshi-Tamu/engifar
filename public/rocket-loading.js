/* ============================================================
   ENGIFAR - ロケット製作ロード画面(独立ファイル)
   状態管理:
     repairing  (0〜約3秒)   通常速度で製作 / 「ロケット製作中」
     speedingUp (約3秒〜)    突然の高速製作が始まる瞬間
     smoke      (約2秒間)    煙が濃くなる / 「もう少しで完成しそうです...」
     completed  (以降)       煙が晴れて完成 / 「ロケットが完成しました!」
   見た目・タイミングは rocket-loading.css、絵は rocket-loading.html 側の
   責務とし、このファイルは「状態と挙動」だけを扱う。
   loading.html / loading.js には一切依存しない、独立したファイル。
   ============================================================ */

(function () {
  "use strict";

  const DURATIONS = {
    repairing: 3000,
    speedingUp: 400,
    smoke: 2000,
    // completed は自動遷移せず、そのまま保持する
  };

  const TEXTS = {
    repairing: { text: "ロケット製作中", className: "" },
    speedingUp: { text: "もう少しで完成しそうです...", className: "is-urgent" },
    smoke: { text: "もう少しで完成しそうです...", className: "is-urgent" },
    completed: { text: "ロケットが完成しました!", className: "is-complete" },
  };

  const el = {
    stage: null,
    text: null,
    restartBtn: null,
  };

  let currentState = null;
  let timers = [];

  function clearTimers() {
    timers.forEach((id) => clearTimeout(id));
    timers = [];
  }

  /* ---------------- ロードテキストの波アニメーション ---------------- */
  function renderWaveText(text) {
    el.text.innerHTML = "";
    const chars = Array.from(text);
    chars.forEach((ch, i) => {
      const span = document.createElement("span");
      span.className = "wave-char";
      span.style.setProperty("--i", i);
      span.textContent = ch === " " ? " " : ch;
      el.text.appendChild(span);
    });
  }

  function applyText(state) {
    const config = TEXTS[state];
    if (!config) return;
    el.text.className = "rocket-loading-text" + (config.className ? " " + config.className : "");
    if (state === "completed") {
      // 完成の一言は波打たせず、ポップアップで見せる(css側で拡大アニメーション)
      el.text.textContent = config.text;
    } else {
      renderWaveText(config.text);
    }
  }

  /* ---------------- 状態遷移 ---------------- */
  function setState(state) {
    currentState = state;
    el.stage.dataset.state = state;
    applyText(state);
    if (state === "completed") {
      document.dispatchEvent(new CustomEvent("engifar:rocket-loading-completed"));
    }
  }

  function play() {
    clearTimers();
    setState("repairing");
    timers.push(
      setTimeout(() => {
        setState("speedingUp");
        timers.push(
          setTimeout(() => {
            setState("smoke");
            timers.push(
              setTimeout(() => {
                setState("completed");
              }, DURATIONS.smoke)
            );
          }, DURATIONS.speedingUp)
        );
      }, DURATIONS.repairing)
    );
  }

  function restart() {
    play();
  }

  function getState() {
    return currentState;
  }

  function init() {
    el.stage = document.getElementById("rocketStage");
    el.text = document.getElementById("rocketLoadingText");
    el.restartBtn = document.getElementById("devRestartBtn");

    if (el.restartBtn) {
      el.restartBtn.addEventListener("click", restart);
    }

    play();
  }

  document.addEventListener("DOMContentLoaded", init);

  window.EngifarRocketLoading = {
    play,
    restart,
    getState,
  };
})();
