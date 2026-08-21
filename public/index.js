"use strict";

const SUCCESS_THRESHOLD = 90;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const elements = {
  app: document.querySelector("#app"),
  stage: document.querySelector("#flight-stage"),
  rocket: document.querySelector("#rocket"),
  explosion: document.querySelector("#explosion"),
  debris: document.querySelector("#debris"),
  celebration: document.querySelector("#celebration"),
  confetti: document.querySelector("#confetti"),
  flightEvent: document.querySelector("#flight-event"),
  eventLabel: document.querySelector("#event-label"),
  eventAltitude: document.querySelector("#event-altitude"),
  altitudeLive: document.querySelector("#altitude-live"),
  panelAltitude: document.querySelector("#panel-altitude"),
  telemetryProgress: document.querySelector("#telemetry-progress"),
  missionStatus: document.querySelector("#mission-status"),
  trajectoryLabel: document.querySelector("#trajectory-label"),
  engineLabel: document.querySelector("#engine-label"),
  setupPanel: document.querySelector("#setup-panel"),
  flightPanel: document.querySelector("#flight-panel"),
  resultPanel: document.querySelector("#result-panel"),
  power: document.querySelector("#power"),
  stability: document.querySelector("#stability"),
  powerValue: document.querySelector("#power-value"),
  stabilityValue: document.querySelector("#stability-value"),
  powerCard: document.querySelector("#power-card"),
  stabilityCard: document.querySelector("#stability-card"),
  thresholdHint: document.querySelector("#threshold-hint"),
  readinessTitle: document.querySelector("#readiness-title"),
  launchButton: document.querySelector("#launch-button"),
  retryButton: document.querySelector("#retry-button"),
  resultIcon: document.querySelector("#result-icon"),
  resultKicker: document.querySelector("#result-kicker"),
  resultTitle: document.querySelector("#result-title"),
  resultMessage: document.querySelector("#result-message"),
  resultPower: document.querySelector("#result-power"),
  resultStability: document.querySelector("#result-stability"),
  resultAltitude: document.querySelector("#result-altitude")
};

let animationFrame = 0;
let resultTimer = 0;
let currentState = "idle";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function formatAltitude(value) {
  return Math.max(0, Math.round(value)).toLocaleString("ja-JP");
}

function updateParameter(input, output, card) {
  const value = Number(input.value);
  output.textContent = `${value}%`;
  input.style.setProperty("--fill", `${value}%`);
  card.classList.toggle("is-ready", value >= SUCCESS_THRESHOLD);
  return value;
}

function updateControls() {
  const power = updateParameter(elements.power, elements.powerValue, elements.powerCard);
  const stability = updateParameter(elements.stability, elements.stabilityValue, elements.stabilityCard);
  const shortfall = Math.max(0, SUCCESS_THRESHOLD - Math.min(power, stability));
  const ready = shortfall === 0;

  elements.thresholdHint.classList.toggle("is-ready", ready);
  elements.readinessTitle.textContent = ready
    ? "軌道投入の準備完了"
    : `軌道投入まであと${shortfall}`;
}

function calculateOutcome(power, stability) {
  const success = power >= SUCCESS_THRESHOLD && stability >= SUCCESS_THRESHOLD;

  if (success) {
    return {
      success,
      altitude: Math.round(4200 + power * 38 + stability * 18),
      travel: 1
    };
  }

  const weakest = Math.min(power, stability);
  const average = (power + stability) / 2;
  const travel = clamp(0.25 + average * 0.0032 + weakest * 0.0015, 0.25, 0.7);
  const potentialAltitude = 1200 + power * 62 + stability * 24;

  return {
    success,
    altitude: Math.round(potentialAltitude * travel),
    travel
  };
}

function setPanels(panelName) {
  elements.setupPanel.hidden = panelName !== "setup";
  elements.flightPanel.hidden = panelName !== "flight";
  elements.resultPanel.hidden = panelName !== "result";
}

function setState(state) {
  currentState = state;
  elements.app.dataset.state = state;
}

function setAltitude(value) {
  const formatted = formatAltitude(value);
  elements.altitudeLive.textContent = formatted;
  elements.panelAltitude.textContent = formatted;
}

function createEffectPieces() {
  const debrisColors = ["#ff8a4c", "#ffdd75", "#ff5e66", "#cbd8df", "#7de8ed"];
  const confettiColors = ["#c9f765", "#7de8ed", "#ff8a4c", "#f3f8f5", "#ff6d83"];

  for (let index = 0; index < 18; index += 1) {
    const piece = document.createElement("i");
    piece.style.setProperty("--angle", `${index * 20 + (index % 3) * 5}deg`);
    piece.style.setProperty("--distance", `${46 + (index % 5) * 12}px`);
    piece.style.setProperty("--delay", `${(index % 4) * 0.018}s`);
    piece.style.setProperty("--piece-color", debrisColors[index % debrisColors.length]);
    elements.debris.append(piece);
  }

  for (let index = 0; index < 34; index += 1) {
    const piece = document.createElement("i");
    const x = 4 + ((index * 29) % 92);
    const fall = 70 + ((index * 17) % 30);
    const sway = -42 + ((index * 23) % 84);
    piece.style.setProperty("--x", `${x}%`);
    piece.style.setProperty("--fall", `${fall}%`);
    piece.style.setProperty("--sway", `${sway}px`);
    piece.style.setProperty("--rotate", `${220 + (index % 5) * 110}deg`);
    piece.style.setProperty("--duration", `${1.15 + (index % 6) * 0.13}s`);
    piece.style.setProperty("--delay", `${(index % 10) * 0.055}s`);
    piece.style.setProperty("--confetti-color", confettiColors[index % confettiColors.length]);
    elements.confetti.append(piece);
  }
}

function resetEffects() {
  elements.explosion.classList.remove("is-active");
  elements.celebration.classList.remove("is-active");
  elements.celebration.setAttribute("aria-hidden", "true");
  elements.flightEvent.classList.remove("is-visible");
  elements.flightEvent.setAttribute("aria-hidden", "true");
  elements.stage.style.setProperty("--rocket-bottom", "6%");
  elements.stage.style.setProperty("--rocket-drift", "0px");
  elements.stage.style.setProperty("--rocket-tilt", "0deg");
  elements.stage.style.setProperty("--scene-travel", "0px");
  elements.stage.style.setProperty("--explosion-bottom", "45%");
  elements.rocket.style.opacity = "1";
  elements.telemetryProgress.style.width = "0%";
}

function updateFlightVisual(travel, altitude, stability, elapsed) {
  const bottom = 6 + travel * 104;
  const instability = (100 - stability) / 100;
  const driftAmplitude = 2 + instability * 8;
  const drift = Math.sin(elapsed / 150) * driftAmplitude * Math.sin(Math.PI * travel);
  const tilt = Math.sin(elapsed / 115) * instability * 3.5;

  elements.stage.style.setProperty("--rocket-bottom", `${bottom}%`);
  elements.stage.style.setProperty("--rocket-drift", `${drift.toFixed(2)}px`);
  elements.stage.style.setProperty("--rocket-tilt", `${tilt.toFixed(2)}deg`);
  elements.stage.style.setProperty("--scene-travel", `${Math.min(130, travel * 130).toFixed(1)}px`);
  elements.telemetryProgress.style.width = `${Math.min(100, travel * 100)}%`;
  setAltitude(altitude);

  if (travel > 0.82) {
    elements.rocket.style.opacity = String(clamp(1 - (travel - 0.82) / 0.18, 0, 1));
  }
}

function getFailureMessage(power, stability) {
  if (power < SUCCESS_THRESHOLD && stability < SUCCESS_THRESHOLD) {
    return "出力と安定性が基準を下回り、飛行途中で機体が崩壊しました。";
  }

  if (power < SUCCESS_THRESHOLD) {
    return "出力不足により上昇を維持できず、飛行途中で機体が崩壊しました。";
  }

  return "姿勢制御が限界を超え、飛行途中で機体が崩壊しました。";
}

function populateResult(snapshot, outcome) {
  elements.resultPower.textContent = snapshot.power;
  elements.resultStability.textContent = snapshot.stability;
  elements.resultAltitude.textContent = formatAltitude(outcome.altitude);
  elements.resultPanel.classList.toggle("is-failure", !outcome.success);

  if (outcome.success) {
    elements.resultIcon.textContent = "✓";
    elements.resultKicker.textContent = "MISSION COMPLETE";
    elements.resultTitle.textContent = "打ち上げ成功";
    elements.resultMessage.textContent = "ロケットは安定した軌道へ到達しました。";
  } else {
    elements.resultIcon.textContent = "!";
    elements.resultKicker.textContent = "MISSION ABORTED";
    elements.resultTitle.textContent = "打ち上げ失敗";
    elements.resultMessage.textContent = getFailureMessage(snapshot.power, snapshot.stability);
  }
}

function finishSuccess(snapshot, outcome) {
  setState("success");
  elements.missionStatus.textContent = "SUCCESS";
  elements.trajectoryLabel.textContent = "ORBIT";
  elements.engineLabel.textContent = "CUTOFF";
  elements.eventLabel.textContent = "ORBIT ALTITUDE";
  elements.eventAltitude.textContent = formatAltitude(outcome.altitude);
  elements.celebration.classList.add("is-active");
  elements.celebration.setAttribute("aria-hidden", "false");

  resultTimer = window.setTimeout(() => {
    populateResult(snapshot, outcome);
    setPanels("result");
  }, prefersReducedMotion.matches ? 80 : 700);
}

function finishFailure(snapshot, outcome, finalTravel) {
  setState("failure");
  elements.missionStatus.textContent = "ABORTED";
  elements.trajectoryLabel.textContent = "LOST";
  elements.engineLabel.textContent = "OFFLINE";
  elements.stage.style.setProperty("--explosion-bottom", `${6 + finalTravel * 104 + 6}%`);
  elements.eventLabel.textContent = "BURST ALTITUDE";
  elements.eventAltitude.textContent = formatAltitude(outcome.altitude);
  elements.explosion.classList.add("is-active");

  window.setTimeout(() => {
    if (currentState !== "failure") return;
    elements.flightEvent.classList.add("is-visible");
    elements.flightEvent.setAttribute("aria-hidden", "false");
  }, prefersReducedMotion.matches ? 20 : 260);

  resultTimer = window.setTimeout(() => {
    populateResult(snapshot, outcome);
    setPanels("result");
  }, prefersReducedMotion.matches ? 90 : 850);
}

function launch() {
  if (currentState !== "idle") return;

  const snapshot = {
    power: Number(elements.power.value),
    stability: Number(elements.stability.value)
  };
  const outcome = calculateOutcome(snapshot.power, snapshot.stability);
  const duration = prefersReducedMotion.matches
    ? 350
    : outcome.success
      ? 4300
      : 2350 + outcome.travel * 1500;

  window.clearTimeout(resultTimer);
  window.cancelAnimationFrame(animationFrame);
  setState("launching");
  setPanels("flight");
  elements.power.disabled = true;
  elements.stability.disabled = true;
  elements.launchButton.disabled = true;
  elements.missionStatus.textContent = "LIFTOFF";
  elements.trajectoryLabel.textContent = "TRACKING";
  elements.engineLabel.textContent = "BURNING";
  elements.flightEvent.classList.remove("is-visible");
  elements.explosion.classList.remove("is-active");
  elements.celebration.classList.remove("is-active");
  elements.rocket.style.opacity = "1";
  setAltitude(0);

  const startedAt = performance.now();

  function animate(now) {
    const elapsed = now - startedAt;
    const timeProgress = clamp(elapsed / duration, 0, 1);
    const eased = outcome.success ? easeInOutCubic(timeProgress) : easeOutCubic(timeProgress);
    const travel = outcome.success ? eased : outcome.travel * eased;
    const currentAltitude = outcome.altitude * eased;

    updateFlightVisual(travel, currentAltitude, snapshot.stability, elapsed);

    if (timeProgress < 1) {
      animationFrame = window.requestAnimationFrame(animate);
      return;
    }

    setAltitude(outcome.altitude);
    if (outcome.success) {
      finishSuccess(snapshot, outcome);
    } else {
      finishFailure(snapshot, outcome, travel);
    }
  }

  animationFrame = window.requestAnimationFrame(animate);
}

function resetMission() {
  window.cancelAnimationFrame(animationFrame);
  window.clearTimeout(resultTimer);
  setState("idle");
  setPanels("setup");
  resetEffects();
  elements.power.disabled = false;
  elements.stability.disabled = false;
  elements.launchButton.disabled = false;
  elements.missionStatus.textContent = "STANDBY";
  elements.trajectoryLabel.textContent = "LOCKED";
  elements.engineLabel.textContent = "IDLE";
  setAltitude(0);
  updateControls();
  elements.launchButton.focus({ preventScroll: true });
}

elements.power.addEventListener("input", updateControls);
elements.stability.addEventListener("input", updateControls);
elements.launchButton.addEventListener("click", launch);
elements.retryButton.addEventListener("click", resetMission);

createEffectPieces();
updateControls();
setAltitude(0);
