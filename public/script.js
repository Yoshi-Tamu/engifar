import {
  calculateOutcome,
  computeMetrics,
  FLIGHT_RANKS,
  getFlightRank,
  OUTPUT_THRESHOLD,
  SAFETY_THRESHOLD,
} from "./game-rules.js";

(() => {
  "use strict";

  const STORAGE_KEY = "engifar-mission-v4";
  const ROOM_AUTH_STORAGE_KEY = "engifar-room-auth-v1";
  let quizConfig = Object.freeze({ questionCount: 24, answerTimeSeconds: 10, reviewTimeSeconds: 5 });
  let authoritativeResults = null;
  const PROFILE_ROLES = Object.freeze({
    "フロントエンド": { role: "INTERFACE CREATOR", copy: "画面の構造・見た目・動きを心地よく組み立てるクルー" },
    "バックエンド": { role: "SERVICE BUILDER", copy: "サービスを支える処理と実行環境を組み立てるクルー" },
    "データベース": { role: "DATA ARCHITECT", copy: "データの形とつながりを鮮やかに設計するクルー" },
    "インフラ": { role: "ORBIT OPERATOR", copy: "アプリがのびのび動ける環境を整えるクルー" },
    "API": { role: "CONNECTION DESIGNER", copy: "サービス同士をなめらかにつなぐクルー" },
    "セキュリティ": { role: "TRUST ENGINEER", copy: "安心して使えるサービス体験を育てるクルー" }
  });

  const app = document.querySelector("#app");
  if (!app) return;

  const page = app.dataset.page || "home";
  const reducedMotion = globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (page === "quiz") {
    globalThis.addEventListener("pageshow", (event) => {
      // BFCacheから古い回答タイマーを復元せず、保存済みの最新進行へ同期する。
      if (event.persisted) globalThis.location.reload();
    });
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function safeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function wait(milliseconds) {
    return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
  }

  const CREW_COLORS = ["#54d37c", "#5ca9ff", "#f5cf4b", "#ff665f", "#b889ff", "#62e4ec"];

  function colorForParticipant(participant, index, selfParticipantId, selfColor) {
    if (participant.id === selfParticipantId) return selfColor;
    let hash = 0;
    for (const character of participant.id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return CREW_COLORS[(hash + index) % CREW_COLORS.length];
  }

  async function requestApi(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload && payload.error && payload.error.message
        ? payload.error.message
        : `API request failed (${response.status})`);
      error.code = payload && payload.error ? payload.error.code : null;
      error.status = response.status;
      throw error;
    }
    return payload.data;
  }

  function saveRoomAuth(membership) {
    const value = {
      roomCode: membership.room.code,
      roomId: membership.room.id,
      accessToken: membership.accessToken,
      participantId: membership.participant.id,
      role: membership.participant.role
    };
    globalThis.sessionStorage.setItem(ROOM_AUTH_STORAGE_KEY, JSON.stringify(value));
    return value;
  }

  function loadRoomAuth(code) {
    try {
      const value = JSON.parse(globalThis.sessionStorage.getItem(ROOM_AUTH_STORAGE_KEY) || "null");
      if (!value || value.roomCode !== code || typeof value.accessToken !== "string") return null;
      return value;
    } catch {
      return null;
    }
  }

  function bearerHeaders(auth) {
    return { authorization: `Bearer ${auth.accessToken}` };
  }

  function metricsFromResult(result) {
    return {
      power: Math.round(clamp(safeNumber(result.power), 0, 100)),
      safety: Math.round(clamp(safeNumber(result.safety), 0, 100)),
      categoryScores: result.categoryScores && typeof result.categoryScores === "object"
        ? result.categoryScores
        : {}
    };
  }

  async function fetchAuthoritativeResults(auth) {
    const results = await requestApi(
      `/api/sessions/${encodeURIComponent(state.room.sessionId)}/results`,
      { headers: bearerHeaders(auth) }
    );
    if (!results.personal || results.personal.participantId !== auth.participantId) {
      throw new Error("自分の結果を確認できませんでした。");
    }
    authoritativeResults = results;
    state.quiz.index = results.questionCount;
    state.metrics = metricsFromResult(results.personal);
    if (typeof results.personal.isProfilePublic === "boolean") {
      state.player.isProfilePublic = results.personal.isProfilePublic;
    }
    persist(state);
    return results;
  }

  function connectRoomSocket(auth, onEvent = () => {}, onStatus = () => {}) {
    let socket = null;
    let heartbeatTimer = null;
    let reconnectTimer = null;
    let stopped = false;
    let retryCount = 0;

    function clearTimers() {
      if (heartbeatTimer !== null) globalThis.clearInterval(heartbeatTimer);
      if (reconnectTimer !== null) globalThis.clearTimeout(reconnectTimer);
      heartbeatTimer = null;
      reconnectTimer = null;
    }

    function open() {
      if (stopped) return;
      const url = new URL("/ws", globalThis.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("roomCode", auth.roomCode);
      socket = new WebSocket(url, ["engifar-v1", auth.accessToken]);
      onStatus("connecting");

      socket.addEventListener("open", () => {
        retryCount = 0;
        onStatus("connected");
        heartbeatTimer = globalThis.setInterval(() => {
          if (socket && socket.readyState === WebSocket.OPEN) socket.send("heartbeat");
        }, 5_000);
      });
      socket.addEventListener("message", (event) => {
        try {
          onEvent(JSON.parse(event.data));
        } catch {
          // Unknown messages are ignored so a malformed event cannot stop reconnection.
        }
      });
      socket.addEventListener("close", () => {
        if (heartbeatTimer !== null) globalThis.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        socket = null;
        if (stopped) return;
        onStatus("reconnecting");
        retryCount += 1;
        const delay = Math.min(5_000, 500 * 2 ** Math.min(retryCount - 1, 4));
        reconnectTimer = globalThis.setTimeout(open, delay);
      });
      socket.addEventListener("error", () => onStatus("reconnecting"));
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      clearTimers();
      socket?.close();
    }

    globalThis.addEventListener("pagehide", stop, { once: true });
    open();
    return { stop };
  }

  function createDefaultState() {
    return {
      version: 4,
      missionId: String(Date.now()),
      updatedAt: Date.now(),
      status: "setup",
      playerConfigured: false,
      cardOpened: false,
      pngSaved: false,
      player: { name: "CREW MEMBER", color: "#54d37c", isProfilePublic: true },
      room: { mode: "create", name: "ロケット部", code: "------", sessionId: null, participants: [] },
      quiz: {
        index: 0,
        answers: Array(quizConfig.questionCount).fill(null),
        records: Array(quizConfig.questionCount).fill(null),
        progressToken: null
      },
      metrics: null,
      outcome: null
    };
  }

  function normalizeColor(value) {
    const text = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : "#54d37c";
  }

  function normalizeState(source) {
    const fallback = createDefaultState();
    if (!source || typeof source !== "object") return fallback;

    const playerSource = source.player && typeof source.player === "object" ? source.player : {};
    const quizSource = source.quiz && typeof source.quiz === "object" ? source.quiz : {};
    const roomSource = source.room && typeof source.room === "object" ? source.room : {};
    const answers = Array.isArray(quizSource.answers) ? quizSource.answers.slice(0, quizConfig.questionCount) : [];
    const records = Array.isArray(quizSource.records) ? quizSource.records.slice(0, quizConfig.questionCount) : [];
    while (answers.length < quizConfig.questionCount) answers.push(null);
    while (records.length < quizConfig.questionCount) records.push(null);

    let metrics = null;
    if (source.metrics && Number.isFinite(Number(source.metrics.power)) && Number.isFinite(Number(source.metrics.safety))) {
      metrics = {
        power: Math.round(clamp(safeNumber(source.metrics.power), 0, 100)),
        safety: Math.round(clamp(safeNumber(source.metrics.safety), 0, 100)),
        categoryScores: source.metrics.categoryScores && typeof source.metrics.categoryScores === "object"
          ? source.metrics.categoryScores
          : {}
      };
    }

    const outcome = source.outcome && metrics ? calculateOutcome(metrics) : null;

    const name = String(playerSource.name || "CREW MEMBER").trim().slice(0, 18) || "CREW MEMBER";
    const participants = Array.isArray(roomSource.participants)
      ? roomSource.participants
        .map((participant) => ({
          id: String((participant && participant.id) || ""),
          displayName: String((participant && participant.displayName) || "CREW MEMBER").trim().slice(0, 50) ||
            "CREW MEMBER",
          color: normalizeColor(participant && participant.color)
        }))
        .filter((participant) => participant.id)
        .slice(0, 500)
      : [];
    return {
      version: 4,
      missionId: String(source.missionId || fallback.missionId),
      updatedAt: Math.max(0, safeNumber(source.updatedAt, 0)),
      status: String(source.status || (outcome ? "result" : metrics ? "rocket" : "setup")),
      playerConfigured: Boolean(source.playerConfigured || playerSource.name || metrics),
      cardOpened: Boolean(source.cardOpened),
      pngSaved: Boolean(source.pngSaved),
      player: {
        name,
        color: normalizeColor(playerSource.color),
        isProfilePublic: playerSource.isProfilePublic !== false
      },
      room: {
        mode: roomSource.mode === "join" ? "join" : "create",
        name: String(roomSource.name || "ロケット部").trim().slice(0, 20) || "ロケット部",
        code: String(roomSource.code || "------").trim().toUpperCase().slice(0, 8) || "------",
        sessionId: typeof roomSource.sessionId === "string" ? roomSource.sessionId : null,
        participants
      },
      quiz: {
        index: Math.round(clamp(safeNumber(quizSource.index, 0), 0, quizConfig.questionCount)),
        answers,
        records,
        progressToken: typeof quizSource.progressToken === "string" ? quizSource.progressToken : null
      },
      metrics,
      outcome
    };
  }

  function readStoredState(key) {
    try {
      const value = globalThis.sessionStorage.getItem(key);
      return value ? normalizeState(JSON.parse(value)) : null;
    } catch {
      return null;
    }
  }

  function loadState() {
    return readStoredState(STORAGE_KEY) || createDefaultState();
  }

  let state = loadState();

  function persist(nextState = state) {
    nextState.updatedAt = Date.now();
    state = normalizeState(nextState);
    state.updatedAt = nextState.updatedAt;
    try {
      globalThis.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storageが使えない場合も、状態をURLへ露出させず現在のページ内でのみ続行する。
    }
    return state;
  }

  function goTo(path, nextState = state, replace = false) {
    persist(nextState);
    if (replace) globalThis.location.replace(path);
    else globalThis.location.assign(path);
  }

  function setStateLink(element, path) {
    if (element) element.href = path;
  }

  function requirePlayer() {
    if (state.playerConfigured) return true;
    goTo("./index.html", state, true);
    return false;
  }

  function requireMetrics() {
    if (!requirePlayer()) return false;
    if (state.quiz.index >= quizConfig.questionCount && state.metrics) return true;
    goTo("./quiz.html", state, true);
    return false;
  }

  function requireOutcome() {
    if (!requireMetrics()) return false;
    if (state.outcome) return true;
    goTo("./rocket.html", state, true);
    return false;
  }

  function hexToRgb(hex) {
    const value = normalizeColor(hex).slice(1);
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16)
    };
  }

  function rgbToHsl({ r, g, b }) {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    let hue = 0;
    if (delta) {
      if (max === red) hue = 60 * (((green - blue) / delta) % 6);
      else if (max === green) hue = 60 * ((blue - red) / delta + 2);
      else hue = 60 * ((red - green) / delta + 4);
    }
    if (hue < 0) hue += 360;
    const lightness = (max + min) / 2;
    const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
    return { h: Math.round(hue), s: Math.round(saturation * 100), l: Math.round(lightness * 100) };
  }

  function hslToHex(hue, saturation, lightness) {
    const s = saturation / 100;
    const l = lightness / 100;
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const section = ((hue % 360) + 360) % 360 / 60;
    const x = chroma * (1 - Math.abs(section % 2 - 1));
    let red = 0;
    let green = 0;
    let blue = 0;
    if (section < 1) [red, green] = [chroma, x];
    else if (section < 2) [red, green] = [x, chroma];
    else if (section < 3) [green, blue] = [chroma, x];
    else if (section < 4) [green, blue] = [x, chroma];
    else if (section < 5) [red, blue] = [x, chroma];
    else [red, blue] = [chroma, x];
    const match = l - chroma / 2;
    const toHex = (channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0");
    return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
  }

  function initHome() {
    const nameInput = document.querySelector("#player-name");
    const colorInput = document.querySelector("#player-color");
    const hueSlider = document.querySelector("#hue-slider");
    const palette = document.querySelector("#tone-palette");
    const colorCode = document.querySelector("#color-code");
    const colorSwatch = document.querySelector("#selected-color-swatch");
    const colorOptionsToggle = document.querySelector("#color-options-toggle");
    const colorOptionsPanel = document.querySelector("#color-options-panel");
    const randomColorButton = document.querySelector("#random-color-button");
    const preview = document.querySelector("#player-preview");
    const joinToggle = document.querySelector("#join-room-button");
    const joinPanel = document.querySelector("#join-room-panel");
    const createButton = document.querySelector("#start-button");
    const joinButton = document.querySelector("#enter-room-button");
    const roomCode = document.querySelector("#room-code");
    const roomStatus = document.querySelector("#home-room-status");
    if (
      !nameInput || !colorInput || !hueSlider || !palette || !colorSwatch ||
      !colorOptionsToggle || !colorOptionsPanel || !randomColorButton || !joinToggle ||
      !joinPanel || !createButton || !joinButton || !roomCode || !roomStatus
    ) return;

    nameInput.value = state.player.name;
    colorInput.value = state.player.color;
    hueSlider.value = String(rgbToHsl(hexToRgb(state.player.color)).h);

    const tones = [
      { s: 78, l: 82 },
      { s: 74, l: 70 },
      { s: 72, l: 59 },
      { s: 76, l: 49 },
      { s: 62, l: 39 },
      { s: 48, l: 29 }
    ];

    function applyColor(value, syncHue = true) {
      const color = normalizeColor(value);
      colorInput.value = color;
      colorCode.value = color.toUpperCase();
      colorSwatch.style.setProperty("--swatch-color", color);
      preview.style.setProperty("--crew-color", color);
      if (syncHue) hueSlider.value = String(rgbToHsl(hexToRgb(color)).h);
      document.documentElement.style.setProperty("--selected-hue", hueSlider.value);
      palette.querySelectorAll(".tone-button").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.color === color));
      });
    }

    function renderPalette(selectMiddle = false) {
      const hue = Number(hueSlider.value);
      document.documentElement.style.setProperty("--selected-hue", String(hue));
      palette.replaceChildren();
      tones.forEach((tone, index) => {
        const color = hslToHex(hue, tone.s, tone.l);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tone-button";
        button.dataset.color = color;
        button.style.setProperty("--tone", color);
        button.setAttribute("aria-label", `カラー ${index + 1}`);
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => applyColor(color, false));
        palette.append(button);
      });
      if (selectMiddle) applyColor(hslToHex(hue, tones[2].s, tones[2].l), false);
      else applyColor(colorInput.value, false);
    }

    renderPalette(false);
    applyColor(state.player.color);

    colorInput.addEventListener("input", () => {
      applyColor(colorInput.value, true);
      renderPalette(false);
    });

    hueSlider.addEventListener("input", () => renderPalette(true));
    colorOptionsToggle.addEventListener("click", () => {
      const expanded = colorOptionsPanel.hidden;
      colorOptionsPanel.hidden = !expanded;
      colorOptionsToggle.setAttribute("aria-expanded", String(expanded));
      colorOptionsToggle.textContent = expanded ? "色設定を閉じる" : "色を変更";
    });
    randomColorButton.addEventListener("click", () => {
      hueSlider.value = String(Math.floor(Math.random() * 360));
      renderPalette(true);
    });

    async function enterRoom(mode) {
      if (createButton.disabled || joinButton.disabled) return;
      const requestedCode = roomCode.value.trim().toUpperCase();
      if (mode === "join" && !/^[A-Z0-9]{6,8}$/.test(requestedCode)) {
        roomStatus.textContent = "招待コードを6〜8文字の英数字で入力してください。";
        roomStatus.dataset.kind = "error";
        roomCode.focus();
        return;
      }

      const fresh = createDefaultState();
      fresh.playerConfigured = true;
      fresh.status = "room";
      fresh.player = {
        name: nameInput.value.trim().slice(0, 18) || "CREW MEMBER",
        color: normalizeColor(colorInput.value)
      };
      createButton.disabled = true;
      joinButton.disabled = true;
      roomStatus.textContent = mode === "create" ? "ルームを作成しています…" : "ルームへ参加しています…";
      roomStatus.dataset.kind = "loading";

      try {
        const path = mode === "create"
          ? "/api/rooms"
          : `/api/rooms/${encodeURIComponent(requestedCode)}/participants`;
        const membership = await requestApi(path, {
          method: "POST",
          body: JSON.stringify({ displayName: fresh.player.name })
        });
        saveRoomAuth(membership);
        fresh.room = {
          mode,
          name: mode === "join" ? "招待ルーム" : "ENGIFAR",
          code: membership.room.code,
          sessionId: null
        };
        goTo("./room.html", fresh);
      } catch (error) {
        const messages = {
          ROOM_NOT_FOUND: "その招待コードのルームは見つかりませんでした。",
          ROOM_NOT_JOINABLE: "このルームのクイズはすでに始まっています。"
        };
        roomStatus.textContent = messages[error.code] || `ルームへ接続できませんでした。${error.message}`;
        roomStatus.dataset.kind = "error";
        createButton.disabled = false;
        joinButton.disabled = false;
      }
    }

    function toggleJoinPanel() {
      const openJoin = joinPanel.hidden;
      joinPanel.hidden = !openJoin;
      joinToggle.setAttribute("aria-expanded", String(openJoin));
    }

    joinToggle.addEventListener("click", toggleJoinPanel);
    createButton.addEventListener("click", () => void enterRoom("create"));
    joinButton.addEventListener("click", () => void enterRoom("join"));
    nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void enterRoom(joinPanel.hidden ? "create" : "join");
    });
    roomCode.addEventListener("input", () => {
      roomCode.value = roomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
      roomStatus.textContent = "";
      roomStatus.dataset.kind = "";
    });
    roomCode.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void enterRoom("join");
    });
  }

  function initRoom() {
    if (!requirePlayer()) return;
    if (state.status !== "room" && !state.room.sessionId) {
      goTo("./index.html", state, true);
      return;
    }
    const playerAvatar = document.querySelector("#room-player-avatar");
    const playerList = document.querySelector("#room-player-list");
    const roomCodeValue = document.querySelector("#room-code-value");
    const startButton = document.querySelector("#room-start-button");
    const lobbyMessage = document.querySelector("#room-lobby-message");
    const lobbyStatus = document.querySelector("#room-lobby-status");
    if (
      !playerAvatar || !playerList || !roomCodeValue || !startButton || !lobbyMessage ||
      !lobbyStatus
    ) return;

    playerAvatar.style.setProperty("--crew-color", state.player.color);
    roomCodeValue.textContent = state.room.code;
    setStateLink(document.querySelector("#room-home-link"), "./index.html", state);

    const copyButton = document.querySelector("#room-code-copy-button");
    const copyLabel = document.querySelector("#room-code-copy-label");
    if (copyButton && copyLabel) {
      let copyResetTimer = null;
      copyButton.addEventListener("click", async () => {
        const code = state.room.code;
        let copied = false;
        try {
          await navigator.clipboard.writeText(code);
          copied = true;
        } catch {
          try {
            const scratch = document.createElement("textarea");
            scratch.value = code;
            scratch.style.position = "fixed";
            scratch.style.opacity = "0";
            document.body.append(scratch);
            scratch.select();
            copied = document.execCommand("copy");
            scratch.remove();
          } catch {
            copied = false;
          }
        }
        if (copyResetTimer !== null) globalThis.clearTimeout(copyResetTimer);
        copyLabel.textContent = copied ? "コピーしました！" : "コピーできませんでした";
        copyButton.classList.toggle("is-copied", copied);
        copyResetTimer = globalThis.setTimeout(() => {
          copyLabel.textContent = "ROOM CODE";
          copyButton.classList.remove("is-copied");
        }, 1800);
      });
    }

    const auth = loadRoomAuth(state.room.code);
    if (!auth) {
      startButton.disabled = true;
      lobbyStatus.textContent = "参加情報を確認できません。トップ画面からルームへ入り直してください。";
      lobbyStatus.dataset.kind = "error";
      return;
    }

    let enteredQuiz = false;
    let refreshing = false;

    function colorFor(participant, index) {
      return colorForParticipant(participant, index, auth.participantId, state.player.color);
    }

    function renderParticipants(participants) {
      state.room.participants = participants.map((participant, index) => ({
        id: participant.id,
        displayName: participant.displayName,
        color: colorFor(participant, index)
      }));
      persist(state);
      playerList.replaceChildren();
      participants.forEach((participant, index) => {
        const card = document.createElement("div");
        card.className = "room-player-card";
        if (participant.id === auth.participantId) card.classList.add("is-you");

        const avatar = document.createElement("span");
        avatar.className = "crew-avatar crew-avatar--small";
        avatar.style.setProperty("--crew-color", colorFor(participant, index));
        avatar.setAttribute("aria-hidden", "true");
        avatar.append(document.createElement("i"));

        const copy = document.createElement("div");
        const role = document.createElement("small");
        role.textContent = participant.role === "host" ? "HOST CREW" : "READY CREW";
        const name = document.createElement("strong");
        name.textContent = participant.displayName;
        copy.append(role, name);

        const badge = document.createElement("span");
        badge.className = "ready-badge";
        badge.textContent = participant.id === auth.participantId ? "YOU" : "準備OK";
        card.append(avatar, copy, badge);
        playerList.append(card);
      });
      lobbyMessage.textContent = `${participants.length}人のクルーが参加中です。招待コードを仲間に伝えましょう。`;
    }

    function enterQuiz(session) {
      if (enteredQuiz || !session || !session.id) return;
      enteredQuiz = true;
      const next = createDefaultState();
      next.playerConfigured = true;
      next.player = { ...state.player };
      next.room = { ...state.room, sessionId: session.id };
      next.status = "quiz";
      goTo("./quiz.html", next);
    }

    async function refreshRoom() {
      if (refreshing || enteredQuiz) return;
      refreshing = true;
      try {
        const room = await requestApi(
          `/api/rooms/${encodeURIComponent(state.room.code)}`,
          { headers: bearerHeaders(auth) }
        );
        renderParticipants(room.participants);
        lobbyStatus.textContent = "サーバーに接続済み";
        lobbyStatus.dataset.kind = "connected";
        if (room.status === "playing" && room.activeSession) enterQuiz(room.activeSession);
        if (room.status === "results") {
          startButton.disabled = true;
          lobbyStatus.textContent = "このルームのクイズは終了しました。";
        }
      } catch (error) {
        lobbyStatus.textContent = `ロビーを更新できませんでした。${error.message}`;
        lobbyStatus.dataset.kind = "error";
      } finally {
        refreshing = false;
      }
    }

    if (auth.role === "host") {
      startButton.addEventListener("click", async () => {
        if (startButton.disabled || enteredQuiz) return;
        startButton.disabled = true;
        startButton.querySelector("span").textContent = "開始しています…";
        try {
          const session = await requestApi(
            `/api/rooms/${encodeURIComponent(state.room.code)}/sessions`,
            { method: "POST", headers: bearerHeaders(auth) }
          );
          enterQuiz(session);
        } catch (error) {
          lobbyStatus.textContent = `クイズを開始できませんでした。${error.message}`;
          lobbyStatus.dataset.kind = "error";
          startButton.disabled = false;
          startButton.querySelector("span").textContent = "クイズを始める";
        }
      });
    } else {
      startButton.disabled = true;
      startButton.querySelector("span").textContent = "ホストの開始を待っています";
      lobbyMessage.textContent = "ホストがクイズを開始すると、自動で同じクイズへ移動します。";
    }

    connectRoomSocket(
      auth,
      (event) => {
        if (event.type === "player_joined" || event.type === "player_left") {
          void refreshRoom();
        } else if (event.type === "host_started" && event.session) {
          enterQuiz(event.session);
        }
      },
      (connectionStatus) => {
        if (lobbyStatus.dataset.kind === "error") return;
        lobbyStatus.textContent = connectionStatus === "connected"
          ? "リアルタイム接続済み"
          : connectionStatus === "reconnecting"
          ? "再接続しています…"
          : "接続しています…";
        lobbyStatus.dataset.kind = connectionStatus === "connected" ? "connected" : "loading";
      }
    );

    void refreshRoom();
    // 参加・開始通知はWebSocketで受け、15秒ごとの取得は通知を逃した場合の復旧用にする。
    globalThis.setInterval(() => void refreshRoom(), 15_000);
  }

  function initGuide() {
    const openButtons = [...document.querySelectorAll(".guide-open-button")];
    if (!openButtons.length) return;

    const wrapper = document.createElement("div");
    wrapper.className = "guide-layer";
    wrapper.innerHTML = `
      <div class="guide-overlay" data-guide-close></div>
      <section class="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title" tabindex="-1">
        <button class="guide-close-x" type="button" data-guide-close aria-label="遊び方を閉じる">×</button>
        <div class="guide-scroll">
          <header class="guide-heading">
            <p>MISSION GUIDE</p>
            <h2 id="guide-title">EngiFarの遊び方</h2>
            <span>知識をロケットの力に変えて、遠くのランクを目指そう！</span>
          </header>
          <ol class="guide-steps">
            <li class="guide-step">
              <div class="guide-step-copy"><b>1</b><div><h3>プレイヤーを決める</h3><p>名前を入力し、カラーパレットから自分だけのクルーカラーを選びます。</p></div></div>
              <figure class="guide-image"><picture><source media="(max-width: 620px)" srcset="./assets/tutorial/home-mobile.png"><img src="./assets/tutorial/home.png" alt="プレイヤー名とクルーカラーを設定するホーム画面"></picture></figure>
            </li>
            <li class="guide-step">
              <div class="guide-step-copy"><b>2</b><div><h3>ルームに集合する</h3><p>ルームを作るか、招待コードを入力して仲間のルームへ参加します。</p></div></div>
              <figure class="guide-image"><img src="./assets/tutorial/room.png" alt="ロケットの周りにクルーが集まるルーム画面"></figure>
            </li>
            <li class="guide-step">
              <div class="guide-step-copy"><b>3</b><div><h3>Web基礎クイズに回答</h3><p>1問10秒。時間内は回答を変更でき、その後5秒間で答えを確認します。</p></div></div>
              <figure class="guide-image"><img src="./assets/tutorial/quiz.png" alt="四つの選択肢から回答するクイズ画面"></figure>
            </li>
            <li class="guide-step">
              <div class="guide-step-copy"><b>4</b><div><h3>ロケットを打ち上げる</h3><p>正答率が出力強度に、6分野のバランスが安全性になり、飛び方と距離へ反映されます。</p></div></div>
              <figure class="guide-image guide-image--wide"><img src="./assets/tutorial/rocket.png" alt="クルーを乗せたロケットが打ち上がる画面"></figure>
            </li>
            <li class="guide-step">
              <div class="guide-step-copy"><b>5</b><div><h3>ランクと記録を確認</h3><p>到達距離による〇〇級、6分野レーダー、適正役割を確認して自己紹介カードを保存できます。</p></div></div>
              <div class="guide-images"><figure class="guide-image"><img src="./assets/tutorial/result.png" alt="到達ランクとレーダーチャートを確認するリザルト画面"></figure><figure class="guide-image"><img src="./assets/tutorial/card.png" alt="適正役割とレーダーチャートが入った自己紹介カード画面"></figure></div>
            </li>
          </ol>
          <p class="guide-highlight">クイズのスコアが高いほど、ロケットの到達距離が伸びる！</p>
          <button class="guide-finish-button" type="button" data-guide-close>ミッション準備OK！</button>
        </div>
      </section>`;
    document.body.append(wrapper);

    const modal = wrapper.querySelector(".guide-modal");
    let returnFocus = null;
    function openGuide(trigger) {
      returnFocus = trigger || document.activeElement;
      document.body.classList.add("guide-open");
      globalThis.requestAnimationFrame(() => modal.focus());
    }
    function closeGuide() {
      document.body.classList.remove("guide-open");
      if (returnFocus && typeof returnFocus.focus === "function") returnFocus.focus();
    }
    openButtons.forEach((button) => button.addEventListener("click", () => openGuide(button)));
    wrapper.querySelectorAll("[data-guide-close]").forEach((button) => button.addEventListener("click", closeGuide));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.classList.contains("guide-open")) closeGuide();
    });

    if (page === "home") {
      let alreadyShown = false;
      try {
        alreadyShown = globalThis.sessionStorage.getItem("engifar-guide-shown") === "1";
        globalThis.sessionStorage.setItem("engifar-guide-shown", "1");
      } catch {
        alreadyShown = false;
      }
      if (!alreadyShown) globalThis.setTimeout(() => openGuide(null), reducedMotion ? 0 : 350);
    }
  }

  function difficultyLabel(weight) {
    if (weight >= 1.2) return "CHALLENGE";
    if (weight >= 1.1) return "STANDARD";
    return "BASIC";
  }

  function runClock(seconds, onTick, onComplete) {
    const startedAt = performance.now();
    let requestId = 0;
    let lastShown = null;

    function frame(now) {
      const remaining = Math.max(0, seconds - (now - startedAt) / 1000);
      const shown = Math.ceil(remaining);
      if (shown !== lastShown || remaining === 0) {
        lastShown = shown;
        onTick(shown, remaining / seconds);
      }
      if (remaining <= 0) {
        onComplete();
        return;
      }
      requestId = globalThis.requestAnimationFrame(frame);
    }

    onTick(seconds, 1);
    requestId = globalThis.requestAnimationFrame(frame);
    return () => globalThis.cancelAnimationFrame(requestId);
  }

  async function initMultiplayerQuiz(elements, auth) {
    const sessionId = state.room.sessionId;
    let currentSession = null;
    let currentRenderedIndex = null;
    let currentQuestionToken = null;
    let reviewingIndex = null;
    let syncing = false;
    let rendering = false;
    let finished = false;
    let phaseToken = 0;
    let cancelClock = () => {};
    let answerQueue = Promise.resolve();
    let syncTimer = null;

    globalThis.addEventListener("pagehide", () => {
      finished = true;
      phaseToken += 1;
      cancelClock();
      if (syncTimer !== null) globalThis.clearInterval(syncTimer);
    }, { once: true });

    function launchRoomCorrectConfetti() {
      document.querySelectorAll(".correct-confetti").forEach((effect) => effect.remove());
      const effect = document.createElement("div");
      effect.className = "correct-confetti";
      effect.setAttribute("aria-hidden", "true");
      const colors = ["#fff176", "#ffd83d", "#ffc928", "#ffb817"];
      ["left", "right"].forEach((side) => {
        for (let index = 0; index < 18; index += 1) {
          const piece = document.createElement("i");
          const horizontal = 45 + Math.random() * 230;
          const vertical = 150 + Math.random() * 310;
          piece.className = `confetti-piece confetti-piece--${side}`;
          piece.style.setProperty("--confetti-x", `${side === "left" ? horizontal : -horizontal}px`);
          piece.style.setProperty("--confetti-apex-x", `${side === "left" ? horizontal * .7 : -horizontal * .7}px`);
          piece.style.setProperty("--confetti-apex-y", `${-vertical}px`);
          piece.style.setProperty("--confetti-end-y", `${-vertical * .48}px`);
          piece.style.setProperty("--confetti-rotate", `${Math.round(220 + Math.random() * 620)}deg`);
          piece.style.setProperty("--confetti-delay", `${(Math.random() * .22).toFixed(2)}s`);
          piece.style.setProperty("--confetti-color", colors[index % colors.length]);
          effect.append(piece);
        }
      });
      document.body.append(effect);
      globalThis.setTimeout(() => effect.remove(), 1900);
    }

    function answerEndTime(session) {
      return session.questionStartedAt
        ? Date.parse(session.questionStartedAt) + session.answerTimeSeconds * 1000
        : Date.now();
    }

    let finishing = false;
    async function finishQuiz() {
      if (finished || finishing) return;
      finishing = true;
      try {
        await fetchAuthoritativeResults(auth);
        finished = true;
        phaseToken += 1;
        cancelClock();
        if (syncTimer !== null) globalThis.clearInterval(syncTimer);
        state.outcome = null;
        state.status = "rocket";
        goTo("./loading.html", state, true);
      } catch (error) {
        elements.feedbackIcon.textContent = "!";
        elements.feedbackTitle.textContent = "結果を取得できませんでした";
        elements.feedbackText.textContent = `${error.message} 自動的に再試行します。`;
      } finally {
        finishing = false;
      }
    }

    async function createAttemptIfNeeded() {
      if (state.quiz.progressToken || state.quiz.index >= quizConfig.questionCount) return;
      const attempt = await requestApi("/api/quiz/attempts", { method: "POST" });
      state.quiz.index = 0;
      state.quiz.answers = Array(quizConfig.questionCount).fill(null);
      state.quiz.records = Array(quizConfig.questionCount).fill(null);
      state.quiz.progressToken = attempt.progressToken;
      state.metrics = null;
      state.outcome = null;
      persist(state);
    }

    async function gradeQuestion(index, questionToken, showFeedback) {
      let result;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          result = await requestApi(`/api/quiz/questions/${index}/grade`, {
            method: "POST",
            body: JSON.stringify({
              questionToken,
              selectedOption: Number.isInteger(state.quiz.answers[index])
                ? state.quiz.answers[index]
                : null
            })
          });
          break;
        } catch (error) {
          if (error.code !== "QUIZ_REVIEW_NOT_READY" || attempt === 11) throw error;
          await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
        }
      }

      const selectedChoice = Number.isInteger(state.quiz.answers[index])
        ? state.quiz.answers[index]
        : null;
      state.quiz.records[index] = {
        selected: selectedChoice,
        correct: result.correct,
        category: result.category,
        weight: result.weight
      };
      state.quiz.index = index + 1;
      state.quiz.progressToken = result.nextProgressToken;
      persist(state);

      if (showFeedback) {
        if (result.correct) launchRoomCorrectConfetti();
        [...elements.answers.children].forEach((button, answerIndex) => {
          button.disabled = true;
          button.classList.toggle("is-answer", answerIndex === result.correctOption);
          button.classList.toggle(
            "is-selected",
            answerIndex === selectedChoice && answerIndex !== result.correctOption
          );
          button.classList.toggle(
            "is-muted",
            answerIndex !== result.correctOption && answerIndex !== selectedChoice
          );
        });
        elements.feedbackIcon.textContent = result.correct ? "✓" : "✦";
        elements.feedbackTitle.textContent = result.correct ? "ナイスチャージ！" : "正解を確認！";
        elements.feedbackText.textContent = selectedChoice === null
          ? `今回は自動で答えを確認しました。${result.explanation}`
          : `${result.explanation} 次の推進力にしよう。`;
      }
      return result;
    }

    async function catchUpTo(targetIndex) {
      while (state.quiz.index < targetIndex) {
        const index = state.quiz.index;
        const start = await requestApi(
          `/api/sessions/${encodeURIComponent(sessionId)}/quiz/questions/${index}/start`,
          {
            method: "POST",
            headers: bearerHeaders(auth),
            body: JSON.stringify({ progressToken: state.quiz.progressToken })
          }
        );
        await gradeQuestion(index, start.questionToken, false);
      }
    }

    // reviewEndsAtは正解表示の見た目のカウントダウンにのみ使う(進行の主導権はサーバーのsleepが持つ)。
    // WSの question_ended から直接渡された場合は絶対時刻が正確、それ以外(壁時計フォールバック)は概算値。
    async function showReview(index, token, reviewEndsAt) {
      if (
        finished || token !== phaseToken || reviewingIndex === index ||
        state.quiz.index !== index || !currentQuestionToken
      ) return;
      reviewingIndex = index;
      cancelClock();
      elements.card.dataset.mode = "review";
      elements.timerLabel.textContent = "確認";
      elements.reviewCount.hidden = false;
      [...elements.answers.children].forEach((button) => button.disabled = true);

      try {
        await gradeQuestion(index, currentQuestionToken, true);
      } catch (error) {
        if (token !== phaseToken) return;
        reviewingIndex = null;
        elements.feedbackIcon.textContent = "!";
        elements.feedbackTitle.textContent = "答え合わせに失敗しました";
        elements.feedbackText.textContent = error.message;
        return;
      }
      if (token !== phaseToken) return;

      const remainingSeconds = Math.max(0.05, (reviewEndsAt - Date.now()) / 1000);
      cancelClock = runClock(
        remainingSeconds,
        (shown, ratio) => {
          elements.timerValue.textContent = String(shown);
          elements.reviewCount.textContent = String(shown);
          elements.timer.style.setProperty("--timer-progress", String(ratio));
        },
        () => void syncSession()
      );
    }

    async function renderQuestion(session) {
      const index = session.currentQuestionIndex;
      if (
        finished || rendering || index === null || currentRenderedIndex === index ||
        state.quiz.index !== index
      ) return;
      rendering = true;
      phaseToken += 1;
      const token = phaseToken;
      cancelClock();
      reviewingIndex = null;
      currentQuestionToken = null;
      document.querySelectorAll(".correct-confetti").forEach((effect) => effect.remove());

      elements.card.dataset.mode = "answer";
      elements.feedbackIcon.textContent = "✦";
      elements.feedbackTitle.textContent = "問題を読み込んでいます";
      elements.feedbackText.textContent = "ルームの進行と同期しています。";
      elements.answers.replaceChildren();

      try {
        const start = await requestApi(
          `/api/sessions/${encodeURIComponent(sessionId)}/quiz/questions/${index}/start`,
          {
            method: "POST",
            headers: bearerHeaders(auth),
            body: JSON.stringify({ progressToken: state.quiz.progressToken })
          }
        );
        if (token !== phaseToken) return;

        const question = start.question;
        const selectedChoice = Number.isInteger(state.quiz.answers[index])
          ? state.quiz.answers[index]
          : null;
        currentRenderedIndex = index;
        currentQuestionToken = start.questionToken;
        elements.current.textContent = String(index + 1).padStart(2, "0");
        elements.category.textContent = question.category;
        elements.difficulty.textContent = difficultyLabel(question.weight);
        elements.progress.style.width = `${((index + 1) / quizConfig.questionCount) * 100}%`;
        elements.timerLabel.textContent = "回答";
        elements.instruction.textContent = question.instruction;
        elements.question.textContent = question.question;
        elements.feedbackIcon.textContent = "✦";
        elements.feedbackTitle.textContent = "仲間と同じ問題に挑戦中です";
        elements.feedbackText.textContent = "選んだ答えはルームへ送信され、時間内なら変更できます。";
        elements.reviewCount.hidden = true;

        question.choices.forEach((choice, choiceIndex) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "answer-button";
          button.dataset.choice = String(choiceIndex);
          button.innerHTML = `<span>${String.fromCharCode(65 + choiceIndex)}</span><span></span>`;
          button.lastElementChild.textContent = choice;
          button.classList.toggle("is-selected", choiceIndex === selectedChoice);
          button.setAttribute("aria-pressed", String(choiceIndex === selectedChoice));
          button.addEventListener("click", () => {
            state.quiz.answers[index] = choiceIndex;
            persist(state);
            [...elements.answers.children].forEach((answerButton, answerIndex) => {
              const selected = answerIndex === choiceIndex;
              answerButton.classList.toggle("is-selected", selected);
              answerButton.setAttribute("aria-pressed", String(selected));
            });

            answerQueue = answerQueue.then(() => requestApi(
              `/api/sessions/${encodeURIComponent(sessionId)}/answers/${index}`,
              {
                method: "PUT",
                headers: bearerHeaders(auth),
                body: JSON.stringify({ selectedOption: choiceIndex })
              }
            )).catch((error) => {
              if (currentRenderedIndex !== index || reviewingIndex === index) return;
              elements.feedbackIcon.textContent = "!";
              elements.feedbackTitle.textContent = "回答を送信できませんでした";
              elements.feedbackText.textContent = error.message;
            });
          });
          elements.answers.append(button);
        });

        // 通常はWSのquestion_endedで即座にshowReviewへ進む。ここは、そのWS通知を
        // 受け取れなかった場合の壁時計フォールバック(reviewEndsAtは概算値)。
        const remainingSeconds = Math.max(0.05, (answerEndTime(session) - Date.now()) / 1000);
        cancelClock = runClock(
          remainingSeconds,
          (shown, ratio) => {
            elements.timerValue.textContent = String(shown);
            elements.timer.style.setProperty("--timer-progress", String(ratio));
          },
          () => void showReview(index, token, Date.now() + quizConfig.reviewTimeSeconds * 1000)
        );
      } catch (error) {
        if (token !== phaseToken) return;
        elements.feedbackIcon.textContent = "!";
        elements.feedbackTitle.textContent = "問題を読み込めませんでした";
        elements.feedbackText.textContent = error.message;
      } finally {
        rendering = false;
      }
    }

    async function syncSession() {
      if (syncing || finished) return;
      syncing = true;
      try {
        const session = await requestApi(`/api/sessions/${encodeURIComponent(sessionId)}`, {
          headers: bearerHeaders(auth)
        });
        currentSession = session;
        if (session.questionCount !== quizConfig.questionCount) {
          throw new Error("ルームとクイズの問題数が一致していません。ルームを作り直してください。");
        }

        if (session.status === "completed") {
          await catchUpTo(session.questionCount);
          await finishQuiz();
          return;
        }
        if (session.currentQuestionIndex === null) return;

        await catchUpTo(session.currentQuestionIndex);
        if (state.quiz.index === session.currentQuestionIndex) {
          await renderQuestion(session);
          // WSのquestion_endedを取りこぼした場合の壁時計フォールバック(reviewEndsAtは概算値)。
          if (
            currentRenderedIndex === session.currentQuestionIndex &&
            reviewingIndex !== session.currentQuestionIndex && Date.now() >= answerEndTime(session)
          ) {
            const fallbackReviewEndsAt = answerEndTime(session) +
              quizConfig.reviewTimeSeconds * 1000;
            await showReview(session.currentQuestionIndex, phaseToken, fallbackReviewEndsAt);
          }
        }
      } catch (error) {
        elements.feedbackIcon.textContent = "!";
        elements.feedbackTitle.textContent = "ルームとの同期に失敗しました";
        elements.feedbackText.textContent = error.message;
      } finally {
        syncing = false;
      }
    }

    try {
      await createAttemptIfNeeded();
      await syncSession();
      if (currentSession) elements.total.textContent = String(currentSession.questionCount);
    } catch (error) {
      elements.feedbackTitle.textContent = "ルームのクイズを開始できませんでした";
      elements.feedbackText.textContent = error.message;
      return;
    }

    if (!finished) {
      connectRoomSocket(auth, (event) => {
        if (event.type === "question_started" || event.type === "all_questions_done") {
          void syncSession();
          return;
        }
        if (event.type === "question_ended") {
          // ポーリングや壁時計チェックを待たず、受信した瞬間に答え合わせへ進める。
          // まだ描画が追いついていない場合はshowReview内のガードで無視され、
          // 直後のsyncSessionで通常の追いつき処理に任せる。
          void showReview(event.questionIndex, phaseToken, event.reviewEndsAt);
          void syncSession();
        }
      });
      // WebSocketを通常経路とし、取りこぼし・別インスタンス時だけ10秒ごとに復旧する。
      syncTimer = globalThis.setInterval(() => void syncSession(), 10_000);
    }
  }

  async function initQuiz() {
    if (!requirePlayer()) return;

    const elements = {
      card: document.querySelector("#quiz-card"),
      avatar: document.querySelector("#quiz-player-avatar"),
      playerName: document.querySelector("#quiz-player-name"),
      current: document.querySelector("#question-current"),
      total: document.querySelector("#question-total"),
      category: document.querySelector("#question-category"),
      difficulty: document.querySelector("#question-difficulty"),
      progress: document.querySelector("#quiz-progress"),
      timer: document.querySelector("#timer-dial"),
      timerLabel: document.querySelector("#timer-label"),
      timerValue: document.querySelector("#timer-value"),
      instruction: document.querySelector("#question-instruction"),
      question: document.querySelector("#question-text"),
      answers: document.querySelector("#answer-grid"),
      feedbackIcon: document.querySelector("#feedback-icon"),
      feedbackTitle: document.querySelector("#feedback-title"),
      feedbackText: document.querySelector("#feedback-text"),
      reviewCount: document.querySelector("#review-count")
    };

    elements.avatar.style.setProperty("--crew-color", state.player.color);
    elements.playerName.textContent = state.player.name;

    try {
      quizConfig = Object.freeze(await requestApi("/api/quiz/config"));
      state = normalizeState(state);
      elements.total.textContent = String(quizConfig.questionCount);
    } catch (error) {
      elements.feedbackTitle.textContent = "問題を読み込めませんでした";
      elements.feedbackText.textContent = error.message;
      return;
    }

    if (state.quiz.index >= quizConfig.questionCount) {
      if (state.room.sessionId) {
        const roomAuth = loadRoomAuth(state.room.code);
        if (!roomAuth) {
          goTo("./index.html", state, true);
          return;
        }
        try {
          await fetchAuthoritativeResults(roomAuth);
        } catch (error) {
          elements.feedbackTitle.textContent = "結果を取得できませんでした";
          elements.feedbackText.textContent = error.message;
          return;
        }
      } else if (!state.metrics) {
        state.metrics = computeMetrics(state.quiz.records);
        persist(state);
      }
      goTo("./loading.html", state, true);
      return;
    }

    if (state.status !== "quiz") {
      goTo(state.status === "room" ? "./room.html" : "./index.html", state, true);
      return;
    }

    if (state.room.sessionId) {
      const roomAuth = loadRoomAuth(state.room.code);
      if (!roomAuth) {
        elements.feedbackTitle.textContent = "ルームの参加情報がありません";
        elements.feedbackText.textContent = "トップ画面から招待コードを入力して入り直してください。";
        return;
      }
      await initMultiplayerQuiz(elements, roomAuth);
      return;
    }

    if (!state.quiz.progressToken) {
      try {
        const attempt = await requestApi("/api/quiz/attempts", { method: "POST" });
        state.quiz.index = 0;
        state.quiz.answers = Array(quizConfig.questionCount).fill(null);
        state.quiz.records = Array(quizConfig.questionCount).fill(null);
        state.quiz.progressToken = attempt.progressToken;
        state.metrics = null;
        state.outcome = null;
        persist(state);
      } catch (error) {
        elements.feedbackTitle.textContent = "クイズを開始できませんでした";
        elements.feedbackText.textContent = error.message;
        return;
      }
    }

    let questionIndex = Math.min(state.quiz.index, quizConfig.questionCount - 1);
    let selectedChoice = Number.isInteger(state.quiz.answers[questionIndex])
      ? state.quiz.answers[questionIndex]
      : null;
    let questionToken = null;
    let cancelClock = () => {};
    let phaseToken = 0;

    globalThis.addEventListener("pagehide", () => {
      phaseToken += 1;
      cancelClock();
    }, { once: true });

    function launchCorrectConfetti() {
      document.querySelectorAll(".correct-confetti").forEach((effect) => effect.remove());
      const effect = document.createElement("div");
      effect.className = "correct-confetti";
      effect.setAttribute("aria-hidden", "true");
      const colors = ["#fff176", "#ffd83d", "#ffc928", "#ffb817"];
      ["left", "right"].forEach((side) => {
        for (let index = 0; index < 18; index += 1) {
          const piece = document.createElement("i");
          const horizontal = 45 + Math.random() * 230;
          const vertical = 150 + Math.random() * 310;
          piece.className = `confetti-piece confetti-piece--${side}`;
          piece.style.setProperty("--confetti-x", `${side === "left" ? horizontal : -horizontal}px`);
          piece.style.setProperty("--confetti-apex-x", `${side === "left" ? horizontal * .7 : -horizontal * .7}px`);
          piece.style.setProperty("--confetti-apex-y", `${-vertical}px`);
          piece.style.setProperty("--confetti-end-y", `${-vertical * .48}px`);
          piece.style.setProperty("--confetti-rotate", `${Math.round(220 + Math.random() * 620)}deg`);
          piece.style.setProperty("--confetti-delay", `${(Math.random() * .22).toFixed(2)}s`);
          piece.style.setProperty("--confetti-color", colors[index % colors.length]);
          effect.append(piece);
        }
      });
      document.body.append(effect);
      globalThis.setTimeout(() => effect.remove(), 1900);
    }

    function finishQuiz() {
      cancelClock();
      state.quiz.index = quizConfig.questionCount;
      state.metrics = computeMetrics(state.quiz.records);
      state.outcome = null;
      state.status = "rocket";
      goTo("./loading.html", state, true);
    }

    async function showReview(token) {
      if (token !== phaseToken) return;
      elements.card.dataset.mode = "review";
      elements.timerLabel.textContent = "答え合わせ";
      elements.reviewCount.hidden = false;

      [...elements.answers.children].forEach((button) => {
        button.disabled = true;
      });

      let result;
      try {
        result = await requestApi(`/api/quiz/questions/${questionIndex}/grade`, {
          method: "POST",
          body: JSON.stringify({ questionToken, selectedOption: selectedChoice })
        });
      } catch (error) {
        if (token !== phaseToken) return;
        elements.feedbackIcon.textContent = "!";
        elements.feedbackTitle.textContent = "答え合わせに失敗しました";
        elements.feedbackText.textContent = error.message;
        return;
      }
      if (token !== phaseToken) return;

      const isCorrect = result.correct;
      if (isCorrect) launchCorrectConfetti();
      state.quiz.answers[questionIndex] = selectedChoice;
      state.quiz.records[questionIndex] = {
        selected: selectedChoice,
        correct: isCorrect,
        category: result.category,
        weight: result.weight
      };
      state.quiz.index = questionIndex + 1;
      state.quiz.progressToken = result.nextProgressToken;
      persist(state);

      [...elements.answers.children].forEach((button, index) => {
        button.disabled = true;
        button.classList.toggle("is-answer", index === result.correctOption);
        button.classList.toggle("is-selected", index === selectedChoice && index !== result.correctOption);
        button.classList.toggle("is-muted", index !== result.correctOption && index !== selectedChoice);
      });

      elements.feedbackIcon.textContent = isCorrect ? "✓" : "✦";
      elements.feedbackTitle.textContent = isCorrect ? "ナイスチャージ！" : "正解を確認！";
      elements.feedbackText.textContent = selectedChoice === null
        ? `今回は自動で答えを確認しました。${result.explanation}`
        : `${result.explanation} 次の推進力にしよう。`;

      cancelClock = runClock(
        quizConfig.reviewTimeSeconds,
        (shown, ratio) => {
          elements.timerValue.textContent = String(shown);
          elements.reviewCount.textContent = String(shown);
          elements.timer.style.setProperty("--timer-progress", String(ratio));
        },
        () => {
          if (token !== phaseToken) return;
          if (state.quiz.index >= quizConfig.questionCount) {
            finishQuiz();
            return;
          }
          questionIndex = state.quiz.index;
          selectedChoice = Number.isInteger(state.quiz.answers[questionIndex])
            ? state.quiz.answers[questionIndex]
            : null;
          void renderQuestion();
        }
      );
    }

    async function renderQuestion() {
      document.querySelectorAll(".correct-confetti").forEach((effect) => effect.remove());
      phaseToken += 1;
      const token = phaseToken;
      cancelClock();

      elements.card.dataset.mode = "answer";
      elements.feedbackIcon.textContent = "✦";
      elements.feedbackTitle.textContent = "問題を読み込んでいます";
      elements.feedbackText.textContent = "少し待ってください。";
      elements.answers.replaceChildren();

      let start;
      try {
        start = await requestApi(`/api/quiz/questions/${questionIndex}/start`, {
          method: "POST",
          body: JSON.stringify({ progressToken: state.quiz.progressToken })
        });
      } catch (error) {
        if (token !== phaseToken) return;
        elements.feedbackIcon.textContent = "!";
        elements.feedbackTitle.textContent = "問題を読み込めませんでした";
        elements.feedbackText.textContent = error.message;
        return;
      }
      if (token !== phaseToken) return;

      const question = start.question;
      questionToken = start.questionToken;
      elements.current.textContent = String(questionIndex + 1).padStart(2, "0");
      elements.category.textContent = question.category;
      elements.difficulty.textContent = difficultyLabel(question.weight);
      elements.progress.style.width = `${((questionIndex + 1) / quizConfig.questionCount) * 100}%`;
      elements.timerLabel.textContent = "回答";
      elements.timerValue.textContent = String(start.answerTimeSeconds);
      elements.timer.style.setProperty("--timer-progress", "1");
      elements.instruction.textContent = question.instruction;
      elements.question.textContent = question.question;
      elements.feedbackIcon.textContent = "✦";
      elements.feedbackTitle.textContent = `${start.answerTimeSeconds}秒間は何度でも回答を変更できます`;
      elements.feedbackText.textContent = "選んだ答えはオレンジ色で表示されます。";
      elements.reviewCount.hidden = true;
      elements.answers.replaceChildren();

      question.choices.forEach((choice, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "answer-button";
        button.dataset.choice = String(index);
        button.innerHTML = `<span>${String.fromCharCode(65 + index)}</span><span></span>`;
        button.lastElementChild.textContent = choice;
        button.classList.toggle("is-selected", index === selectedChoice);
        button.setAttribute("aria-pressed", String(index === selectedChoice));
        button.addEventListener("click", () => {
          selectedChoice = index;
          state.quiz.answers[questionIndex] = index;
          persist(state);
          [...elements.answers.children].forEach((answerButton, answerIndex) => {
            const selected = answerIndex === selectedChoice;
            answerButton.classList.toggle("is-selected", selected);
            answerButton.setAttribute("aria-pressed", String(selected));
          });
        });
        elements.answers.append(button);
      });

      cancelClock = runClock(
        start.answerTimeSeconds,
        (shown, ratio) => {
          elements.timerValue.textContent = String(shown);
          elements.timer.style.setProperty("--timer-progress", String(ratio));
        },
        () => void showReview(token)
      );
    }

    void renderQuestion();
  }

  function initLoading() {
    if (!requireMetrics()) return;
    const avatar = document.querySelector("#loading-avatar");
    const hint = document.querySelector("#loading-hint");
    if (avatar) avatar.style.setProperty("--crew-color", state.player.color);

    const hints = [
      "出力強度を集計しています…",
      "6分野のバランスを確認しています…",
      "到達可能な軌道を計算しています…",
      "クルーの搭乗準備をしています…"
    ];
    let hintIndex = 0;
    const hintTimer = hint
      ? globalThis.setInterval(() => {
        hintIndex = (hintIndex + 1) % hints.length;
        hint.textContent = hints[hintIndex];
      }, 700)
      : null;

    async function proceed() {
      const minWait = wait(reducedMotion ? 200 : 1700);
      if (state.room.sessionId) {
        const auth = loadRoomAuth(state.room.code);
        if (auth) {
          try {
            const room = await requestApi(
              `/api/rooms/${encodeURIComponent(state.room.code)}`,
              { headers: bearerHeaders(auth) }
            );
            state.room.participants = room.participants.map((participant, index) => ({
              id: participant.id,
              displayName: participant.displayName,
              color: colorForParticipant(participant, index, auth.participantId, state.player.color)
            }));
            persist(state);
          } catch {
            // ルームの最新人数を取得できなくても、直前のロビー時点の人数で搭乗演出を続行する。
          }
        }
      }
      await minWait;
      if (hintTimer !== null) globalThis.clearInterval(hintTimer);
      goTo("./rocket.html", state, true);
    }

    void proceed();
  }

  function initRocket() {
    if (!requireMetrics()) return;
    const elements = {
      setup: document.querySelector("#screenSetup"), launch: document.querySelector("#screenLaunch"), result: document.querySelector("#screenResult"),
      launchButton: document.querySelector("#launchBtn"), bots: document.querySelector("#botsRunway"), rocket: document.querySelector("#rocketWrap"),
      hatch: document.querySelector("#rlHatch"), sky: document.querySelector("#rlSky"), ground: document.querySelector("#rlGroundLine"),
      approach: document.querySelector("#approachBody"), countdown: document.querySelector("#rlCountdown"), caption: document.querySelector("#flightCaption"),
      resultBg: document.querySelector("#resultBg"), resultTitle: document.querySelector("#resultTitle"), resultIllustration: document.querySelector("#resultIllustration"),
      impactAltitude: document.querySelector("#impactAltitude"), resultDest: document.querySelector("#resultDest"), resultButton: document.querySelector("#againBtn")
    };
    const outcome = calculateOutcome(state.metrics);
    const rank = getFlightRank(outcome.altitude);
    const resultContent = globalThis.ROCKET_LAUNCH_RESULTS || {};
    const captions = { ground: "発射準備", sky: "上空へ", "atmosphere-edge": "大気圏付近", space: "宇宙空間", sea: "着水" };
    const WALK_IN_MAX_CREW = 10;
    const TOSS_MAX_VISIBLE = 20;
    let running = false;

    const showScreen = (target) => [elements.setup, elements.launch, elements.result].forEach((screen) => {
      const active = screen === target;
      screen.classList.toggle("is-active", active);
      screen.setAttribute("aria-hidden", String(!active));
    });
    const setSkyLeg = (leg) => elements.sky.querySelectorAll(".rl-sky-layer").forEach((layer) => layer.classList.toggle("is-visible", layer.dataset.leg === leg));
    const setCaption = (text) => { elements.caption.textContent = text; elements.caption.classList.toggle("is-visible", Boolean(text)); };
    const robotSvg = (color) => `<svg class="bot-svg" viewBox="0 0 100 130" role="img" aria-hidden="true"><ellipse cx="50" cy="118" rx="24" ry="7" fill="${color}" opacity="0.3"/><line x1="50" y1="10" x2="50" y2="24" stroke="${color}" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="8" r="6" fill="oklch(0.85 0.1 202)"/><rect x="20" y="22" width="60" height="76" rx="30" fill="${color}" stroke="oklch(0.2 0.02 260 / 0.25)" stroke-width="2"/><rect x="32" y="42" width="36" height="26" rx="12" fill="oklch(0.97 0.006 260)"/><circle cx="43" cy="55" r="4" fill="oklch(0.22 0.03 262)"/><circle cx="57" cy="55" r="4" fill="oklch(0.22 0.03 262)"/></svg>`;

    function boardingRoster() {
      const participants = Array.isArray(state.room.participants) ? state.room.participants : [];
      if (participants.length) return participants.map((participant) => participant.color);
      return [state.player.color];
    }

    // 10人以下: 一人ずつ歩いて階段を上り、扉からロケットへ乗り込む自然な演出。
    async function boardCrewWalkIn(colors) {
      elements.hatch.classList.add("is-open");
      await wait(250);
      const spawnSpots = colors.map((_color, index) => {
        const side = index % 2 === 0 ? -1 : 1;
        const lane = Math.floor(index / 2);
        return { left: `${50 + side * (16 + lane * 9)}%`, top: `${88 - lane * 3}%` };
      });
      const walkers = colors.map((color, index) => {
        const walker = document.createElement("div");
        walker.className = "rl-runway-bot rl-runway-bot--walk";
        walker.style.left = spawnSpots[index].left;
        walker.style.top = spawnSpots[index].top;
        walker.innerHTML = `<div class="rl-runway-bot-bob">${robotSvg(color)}</div>`;
        elements.bots.append(walker);
        return walker;
      });
      await wait(100);
      await Promise.all(walkers.map(async (walker, index) => {
        await wait(index * 140);
        walker.style.left = "47%";
        walker.style.top = "82%";
        await wait(430);
        walker.style.left = "51%";
        walker.style.top = "58%";
        await wait(430);
        walker.classList.add("is-entering");
        await wait(240);
        walker.remove();
      }));
      await wait(150);
      elements.hatch.classList.remove("is-open");
    }

    // 11人以上: ロケット上部の蓋が開き、クルーが一斉に投げ込まれるコミカルな演出。
    async function boardCrewMassBatch(colors) {
      const visible = colors.slice(0, TOSS_MAX_VISIBLE);
      elements.rocket.classList.add("is-hatch-open");
      await wait(550);
      visible.forEach((color, index) => {
        const bot = document.createElement("div");
        bot.className = "rl-runway-bot rl-runway-bot--toss";
        const scatter = (index % 5 - 2) * 6;
        bot.style.left = `${50 + scatter}%`;
        bot.style.top = "34%";
        bot.style.setProperty("--toss-delay", `${index * 45}ms`);
        bot.innerHTML = robotSvg(color);
        elements.bots.append(bot);
      });
      await wait(30);
      elements.bots.querySelectorAll(".rl-runway-bot--toss").forEach((bot) => bot.classList.add("is-tossed"));
      await wait(950);
      elements.bots.innerHTML = "";
      if (colors.length > 1) setCaption(`${colors.length}人のクルーが搭乗完了！`);
      await wait(500);
      elements.rocket.classList.remove("is-hatch-open");
      await wait(300);
      setCaption("");
    }

    async function boardCrew() {
      elements.bots.innerHTML = "";
      const colors = boardingRoster();
      if (colors.length > WALK_IN_MAX_CREW) await boardCrewMassBatch(colors);
      else await boardCrewWalkIn(colors);
    }
    async function bounceRocket() { elements.rocket.classList.add("is-bouncing"); await wait(700); elements.rocket.classList.remove("is-bouncing"); }
    async function igniteRocket() {
      elements.rocket.classList.add("is-igniting");
      for (const number of ["3", "2", "1"]) { elements.countdown.textContent = number; elements.countdown.classList.remove("is-visible"); void elements.countdown.offsetWidth; elements.countdown.classList.add("is-visible"); await wait(650); }
      elements.countdown.classList.remove("is-visible");
    }
    async function liftoffRocket() { setSkyLeg("sky"); elements.ground.classList.add("is-hidden"); elements.rocket.classList.remove("is-igniting"); elements.rocket.classList.add("is-flying"); setCaption("発射!"); await wait(1000); elements.rocket.classList.remove("is-flying"); elements.rocket.classList.add("is-cruising"); }
    async function flyThrough() {
      for (let index = 0; index < rank.legs.length; index += 1) {
        const leg = rank.legs[index]; const last = index === rank.legs.length - 1; setSkyLeg(leg); setCaption(captions[leg] || "");
        if (leg === "space" && rank.approachColor && last) { elements.approach.style.setProperty("--approach-color", rank.approachColor); elements.approach.classList.add("is-visible"); setCaption(`${rank.destination}へ接近`); }
        await wait(last ? 900 : 650);
      }
      if (rank.crashLanding) { setCaption("エンジン停止..."); elements.rocket.classList.remove("is-cruising"); await wait(500); elements.rocket.classList.add("is-tumbling"); setCaption("落下中!"); await wait(700); setSkyLeg("sea"); await wait(700); setCaption("着水..."); await wait(500); elements.rocket.classList.remove("is-tumbling"); }
    }
    function showResult() {
      const content = resultContent[rank.key] || {};
      elements.resultTitle.textContent = rank.name;
      elements.resultTitle.className = `rl-result-title rl-title-${rank.key}`;
      elements.resultBg.className = `rl-result-bg rl-bg-${rank.key}`;
      elements.resultBg.style.background = content.backgroundGradient || "";
      elements.resultIllustration.innerHTML = content.svgMarkup || "";
      elements.impactAltitude.textContent = (outcome.altitude * 1000).toLocaleString("ja-JP");
      elements.resultDest.textContent = `到達地点: ${rank.destination} / 到達距離 ${(outcome.altitude * 1000).toLocaleString("ja-JP")}km`;
      elements.approach.classList.remove("is-visible");
      state.outcome = outcome; state.status = "result"; persist(state); showScreen(elements.result);
    }
    async function runLaunchSequence() {
      if (running) return; running = true; showScreen(elements.launch); setSkyLeg("ground"); elements.ground.classList.remove("is-hidden"); elements.rocket.className = "rl-rocket-wrap"; elements.approach.classList.remove("is-visible"); setCaption("");
      await boardCrew(); await bounceRocket(); await igniteRocket(); await liftoffRocket(); await flyThrough(); showResult(); running = false;
    }
    if (state.outcome) showResult();
    else elements.launchButton.addEventListener("click", runLaunchSequence);
    elements.resultButton.addEventListener("click", () => {
      goTo(state.room.sessionId ? "./ranking.html" : "./result.html", state);
    });
  }

  function initRanking() {
    if (!requireOutcome()) return;
    if (!state.room.sessionId) {
      goTo("./result.html", state, true);
      return;
    }
    const auth = loadRoomAuth(state.room.code);
    if (!auth) {
      goTo("./index.html", state, true);
      return;
    }

    const list = document.querySelector("#ranking-list");
    const hint = document.querySelector("#ranking-hint");
    const nextButton = document.querySelector("#ranking-next-button");

    async function reveal() {
      let results;
      try {
        results = authoritativeResults || await fetchAuthoritativeResults(auth);
      } catch (error) {
        hint.textContent = `ランキングを取得できませんでした。${error.message}`;
        nextButton.disabled = false;
        return;
      }
      const ordered = [...results.participants].sort((a, b) =>
        b.power - a.power || b.safety - a.safety
      );
      const revealOrder = [...ordered].reverse();

      for (let index = 0; index < revealOrder.length; index += 1) {
        const participant = revealOrder[index];
        const rank = ordered.length - index;
        const item = document.createElement("li");
        item.className = "ranking-item";
        if (participant.participantId === auth.participantId) item.classList.add("is-you");
        if (rank === 1) item.classList.add("is-champion");
        item.innerHTML = `<span class="ranking-place">${rank}</span><span class="ranking-name"></span><strong class="ranking-score">${participant.power}%</strong>`;
        item.querySelector(".ranking-name").textContent = participant.displayName;
        list.prepend(item);
        globalThis.requestAnimationFrame(() => item.classList.add("is-revealed"));
        hint.textContent = rank === 1 ? "1位は…！" : `${rank}位…`;
        await wait(reducedMotion ? 80 : rank === 1 ? 1100 : 550);
      }
      hint.textContent = "発表終了！お疲れさまでした。";
      nextButton.disabled = false;
    }

    nextButton.addEventListener("click", () => goTo("./award.html", state));
    void reveal();
  }

  function initAward() {
    if (!requireOutcome()) return;
    if (!state.room.sessionId) {
      goTo("./result.html", state, true);
      return;
    }
    const auth = loadRoomAuth(state.room.code);
    if (!auth) {
      goTo("./index.html", state, true);
      return;
    }

    const podium = document.querySelector("#podium");
    const nextButton = document.querySelector("#award-next-button");

    function colorForResultParticipant(participantId) {
      const roster = Array.isArray(state.room.participants) ? state.room.participants : [];
      const match = roster.find((participant) => participant.id === participantId);
      if (match) return match.color;
      return participantId === auth.participantId ? state.player.color : "#5ca9ff";
    }

    async function render() {
      let results;
      try {
        results = authoritativeResults || await fetchAuthoritativeResults(auth);
      } catch (error) {
        podium.textContent = `表彰台のデータを取得できませんでした。${error.message}`;
        return;
      }
      const ordered = [...results.participants].sort((a, b) =>
        b.power - a.power || b.safety - a.safety
      );
      if (!ordered.length) {
        podium.textContent = "参加者データがありません。";
        return;
      }
      const topThree = ordered.slice(0, 3);
      const medals = ["🥇", "🥈", "🥉"];
      const podiumOrder = topThree.length === 3
        ? [topThree[1], topThree[0], topThree[2]]
        : topThree.length === 2
        ? [topThree[1], topThree[0]]
        : [topThree[0]];

      podium.replaceChildren();
      podiumOrder.forEach((participant) => {
        const rank = ordered.indexOf(participant) + 1;
        const step = document.createElement("div");
        step.className = `podium-step podium-step--rank${rank}`;
        if (participant.participantId === auth.participantId) step.classList.add("is-you");
        step.innerHTML = `<b class="podium-medal">${medals[rank - 1]}</b><span class="crew-avatar crew-avatar--medium" style="--crew-color:${colorForResultParticipant(participant.participantId)}" aria-hidden="true"><i></i></span><strong class="podium-name"></strong><span class="podium-score">${participant.power}%</span>`;
        step.querySelector(".podium-name").textContent = participant.displayName;
        podium.append(step);
      });
    }

    nextButton.addEventListener("click", () => goTo("./result.html", state));
    void render();
  }

  function resultCopy(outcome, metrics) {
    if (outcome.reachedOrbit) {
      return {
        kicker: "BRILLIANT ORBIT",
        title: "軌道到達！",
        message: "出力と分野バランスがそろい、ロケットは星空の先へ進みました。"
      };
    }
    const average = (metrics.power + metrics.safety) / 2;
    if (average >= 72) {
      return {
        kicker: "SKY SPARK",
        title: "星空手前で大きなきらめき！",
        message: "ここまで積み上げた知識が、空いっぱいの光になりました。"
      };
    }
    if (average >= 48) {
      return {
        kicker: "CLOUD FLIGHT",
        title: "雲の上までフライト！",
        message: "一つひとつの答えが推進力になり、すてきな景色へ届きました。"
      };
    }
    return {
      kicker: "FIRST SKY STEP",
      title: "空へ一歩、ナイスフライト！",
      message: "今日つかんだWebの基礎が、次のフライトをもっと遠くへ運びます。"
    };
  }

  function animateNumber(element, target, duration = 850) {
    if (!element) return;
    if (reducedMotion) {
      element.textContent = target.toLocaleString("ja-JP");
      return;
    }
    const startedAt = performance.now();
    function frame(now) {
      const progress = clamp((now - startedAt) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = Math.round(target * eased).toLocaleString("ja-JP");
      if (progress < 1) globalThis.requestAnimationFrame(frame);
    }
    globalThis.requestAnimationFrame(frame);
  }

  function addResultSparkles(container) {
    if (!container) return;
    const positions = [
      [8, 18], [21, 35], [34, 8], [47, 28], [61, 11], [78, 31],
      [90, 14], [14, 68], [28, 83], [45, 71], [65, 86], [82, 66]
    ];
    positions.forEach(([left, top], index) => {
      const sparkle = document.createElement("span");
      sparkle.textContent = index % 3 === 0 ? "✦" : "·";
      sparkle.style.left = `${left}%`;
      sparkle.style.top = `${top}%`;
      sparkle.style.animationDelay = `${-index * .17}s`;
      container.append(sparkle);
    });
  }

  function radarEntries() {
    const categoryScores = state.metrics && state.metrics.categoryScores ? state.metrics.categoryScores : {};
    const labels = ["フロントエンド", "バックエンド", "データベース", "API", "インフラ", "セキュリティ"];
    return labels.map((label) => ({ label, value: Math.round(clamp(safeNumber(categoryScores[label]), 0, 100)) }));
  }

  function getCrewProfile() {
    const scores = Object.entries(state.metrics && state.metrics.categoryScores ? state.metrics.categoryScores : {});
    const strongestCategory = scores.sort((a, b) => safeNumber(b[1]) - safeNumber(a[1]))[0]?.[0] || "フロントエンド";
    return { strongestCategory, ...(PROFILE_ROLES[strongestCategory] || PROFILE_ROLES["フロントエンド"]) };
  }

  function radarPoint(index, value, centerX, centerY, radius) {
    const angle = -Math.PI / 2 + index * Math.PI / 3;
    const scaled = radius * clamp(value / 100, 0, 1);
    return [centerX + Math.cos(angle) * scaled, centerY + Math.sin(angle) * scaled];
  }

  function renderRadar(svg) {
    if (!svg) return;
    const namespace = "http://www.w3.org/2000/svg";
    const centerX = 180;
    const centerY = 137;
    const radius = 88;
    const values = radarEntries();
    svg.replaceChildren();

    const make = (name, attributes = {}) => {
      const element = document.createElementNS(namespace, name);
      Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
      return element;
    };

    [25, 50, 75, 100].forEach((level) => {
      const points = values.map((_, index) => radarPoint(index, level, centerX, centerY, radius).join(",")).join(" ");
      svg.append(make("polygon", { points, class: level === 100 ? "radar-grid radar-grid--edge" : "radar-grid" }));
    });
    values.forEach((_, index) => {
      const [x, y] = radarPoint(index, 100, centerX, centerY, radius);
      svg.append(make("line", { x1: centerX, y1: centerY, x2: x, y2: y, class: "radar-axis" }));
    });
    const scorePoints = values.map((entry, index) => radarPoint(index, entry.value, centerX, centerY, radius).join(",")).join(" ");
    svg.append(make("polygon", { points: scorePoints, class: "radar-score" }));
    values.forEach((entry, index) => {
      const [dotX, dotY] = radarPoint(index, entry.value, centerX, centerY, radius);
      svg.append(make("circle", { cx: dotX, cy: dotY, r: 4, class: "radar-dot" }));
      const [labelX, labelY] = radarPoint(index, 132, centerX, centerY, radius);
      const anchor = Math.abs(labelX - centerX) < 5 ? "middle" : labelX < centerX ? "end" : "start";
      const label = make("text", { x: labelX, y: labelY - 3, "text-anchor": anchor, class: "radar-label" });
      label.textContent = entry.label;
      const value = make("tspan", { x: labelX, dy: 15, class: "radar-value" });
      value.textContent = `${entry.value}%`;
      label.append(value);
      svg.append(label);
    });
  }

  function initResult() {
    if (!requireOutcome()) return;

    const copy = resultCopy(state.outcome, state.metrics);
    const rank = getFlightRank(state.outcome.altitude);
    app.dataset.outcome = state.outcome.kind;
    document.querySelector("#result-player-avatar").style.setProperty("--crew-color", state.player.color);
    document.querySelector("#button-crew").style.setProperty("--crew-color", state.player.color);
    document.querySelector("#result-player-name").textContent = state.player.name;
    document.querySelector("#result-kicker").textContent = copy.kicker;
    document.querySelector("#result-title").textContent = copy.title;
    document.querySelector("#result-message").textContent = copy.message;
    document.querySelector("#result-rank").textContent = rank.name;
    document.querySelector("#result-rank").style.setProperty("--rank-color", rank.color);
    animateNumber(document.querySelector("#result-power"), state.metrics.power);
    animateNumber(document.querySelector("#result-safety"), state.metrics.safety);
    animateNumber(document.querySelector("#result-altitude"), state.outcome.altitude * 1000, 1100);
    addResultSparkles(document.querySelector("#result-sparkles"));
    renderRadar(document.querySelector("#result-radar"));

    const auth = state.room.sessionId ? loadRoomAuth(state.room.code) : null;
    const crewResults = document.querySelector("#crew-results");
    const crewResultsStatus = document.querySelector("#crew-results-status");
    const crewResultsList = document.querySelector("#crew-results-list");
    if (auth && crewResults && crewResultsStatus && crewResultsList) {
      crewResults.hidden = false;
      const resultsPromise = authoritativeResults
        ? Promise.resolve(authoritativeResults)
        : fetchAuthoritativeResults(auth);
      void resultsPromise.then((results) => {
        crewResultsList.replaceChildren();
        results.participants.forEach((participant) => {
          const item = document.createElement("li");
          if (participant.participantId === auth.participantId) item.classList.add("is-you");

          const name = document.createElement("span");
          name.className = "crew-results-name";
          name.textContent = participant.displayName;
          const detail = document.createElement("span");
          detail.className = "crew-results-detail";
          detail.textContent = `${participant.correctCount}/${results.questionCount}問正解`;
          const score = document.createElement("strong");
          score.className = "crew-results-score";
          score.textContent = `${participant.power}%`;
          item.append(name, detail, score);
          crewResultsList.append(item);
        });
        crewResultsStatus.hidden = false;
        crewResultsStatus.textContent = results.participants.length
          ? `チーム出力 ${results.team.power}% / 安全性 ${results.team.safety}% / 回答完了 ${results.team.completionRate}%`
          : "共有結果はありません。";
      }).catch((error) => {
        crewResultsStatus.textContent = `共有結果を読み込めませんでした。${error.message}`;
      });
    }

    const visibilityRow = document.querySelector("#visibility-toggle-row");
    const visibilitySwitch = document.querySelector("#visibility-switch");
    const visibilityStateLabel = document.querySelector("#visibility-switch-state");
    const visibilityHint = document.querySelector("#visibility-toggle-hint");
    if (auth && visibilityRow && visibilitySwitch && visibilityStateLabel && visibilityHint) {
      visibilityRow.hidden = false;

      function renderVisibility(isPublic) {
        visibilitySwitch.setAttribute("aria-checked", String(isPublic));
        visibilitySwitch.classList.toggle("is-public", isPublic);
        visibilityStateLabel.textContent = isPublic ? "公開" : "非公開";
        visibilityHint.textContent = isPublic
          ? "チームの仲間にあなたの結果を表示しています"
          : "あなたの結果はチームの仲間には表示されません";
      }

      renderVisibility(state.player.isProfilePublic !== false);

      let togglingVisibility = false;
      visibilitySwitch.addEventListener("click", async () => {
        if (togglingVisibility) return;
        togglingVisibility = true;
        visibilitySwitch.disabled = true;
        const next = !(state.player.isProfilePublic !== false);
        try {
          const updated = await requestApi(
            `/api/rooms/${encodeURIComponent(state.room.code)}/participants/visibility`,
            {
              method: "PUT",
              headers: bearerHeaders(auth),
              body: JSON.stringify({ isProfilePublic: next })
            }
          );
          state.player.isProfilePublic = updated.isProfilePublic !== false;
          persist(state);
          renderVisibility(state.player.isProfilePublic);
        } catch (error) {
          visibilityHint.textContent = `切り替えに失敗しました。${error.message}`;
        } finally {
          visibilitySwitch.disabled = false;
          togglingVisibility = false;
        }
      });
    }

    const cardLink = document.querySelector("#card-link");
    setStateLink(cardLink, "./card.html", state);
    cardLink.addEventListener("click", (event) => {
      event.preventDefault();
      state.cardOpened = true;
      goTo("./card.html", state);
    });

    function startNewMission() {
      const fresh = createDefaultState();
      fresh.player = { ...state.player };
      fresh.playerConfigured = true;
      goTo("./index.html", fresh);
    }

    const retryButton = document.querySelector("#retry-button");
    const retryWarning = document.querySelector("#retry-warning");
    const retryWarningConfirm = document.querySelector("#retry-warning-confirm");
    const retryWarningCancel = document.querySelector("#retry-warning-cancel");
    retryWarning?.style.setProperty("--crew-color", state.player.color);
    retryButton.disabled = !state.cardOpened;
    retryButton.setAttribute("aria-disabled", String(!state.cardOpened));
    retryButton.title = state.cardOpened ? "もう一度チャレンジ" : "自己紹介カードを開くと次のチャレンジへ進めます";
    retryButton.addEventListener("click", () => {
      if (!state.cardOpened) return;
      if (!state.pngSaved && retryWarning) {
        retryWarning.hidden = false;
        globalThis.requestAnimationFrame(() => retryWarningCancel?.focus());
        return;
      }
      startNewMission();
    });
    retryWarningConfirm?.addEventListener("click", startNewMission);
    retryWarningCancel?.addEventListener("click", () => {
      retryWarning.hidden = true;
      retryButton.focus();
    });
  }

  function roundedRectPath(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function drawCrew(context, x, y, size, color) {
    context.save();
    context.translate(x, y);
    context.lineCap = "round";

    context.globalAlpha = .24;
    context.fillStyle = color;
    context.beginPath();
    context.ellipse(0, size * .55, size * .24, size * .065, 0, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;

    context.strokeStyle = color;
    context.lineWidth = size * .045;
    context.beginPath();
    context.moveTo(0, -size * .56);
    context.lineTo(0, -size * .43);
    context.stroke();
    context.fillStyle = "#62e4ec";
    context.beginPath();
    context.arc(0, -size * .59, size * .06, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = color;
    roundedRectPath(context, -size * .31, -size * .43, size * .62, size * .84, size * .28);
    context.fill();

    context.fillStyle = "#f3f8f6";
    roundedRectPath(context, -size * .22, -size * .17, size * .44, size * .27, size * .13);
    context.fill();

    context.fillStyle = "#102132";
    context.beginPath();
    context.arc(-size * .075, -size * .035, size * .036, 0, Math.PI * 2);
    context.arc(size * .075, -size * .035, size * .036, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function fitText(context, text, maxWidth, startSize, family, weight = 800) {
    let size = startSize;
    do {
      context.font = `${weight} ${size}px ${family}`;
      if (context.measureText(text).width <= maxWidth) break;
      size -= 2;
    } while (size > 24);
    return size;
  }

  function drawCanvasRadar(context, entries, centerX, centerY, radius, color, family) {
    context.save();
    context.lineJoin = "round";
    [25, 50, 75, 100].forEach((level) => {
      context.beginPath();
      entries.forEach((_entry, index) => {
        const [x, y] = radarPoint(index, level, centerX, centerY, radius);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
      context.strokeStyle = level === 100 ? "rgba(98,228,236,.42)" : "rgba(98,228,236,.17)";
      context.lineWidth = level === 100 ? 2 : 1;
      context.stroke();
    });
    entries.forEach((_entry, index) => {
      const [x, y] = radarPoint(index, 100, centerX, centerY, radius);
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.lineTo(x, y);
      context.strokeStyle = "rgba(98,228,236,.16)";
      context.stroke();
    });
    context.beginPath();
    entries.forEach((entry, index) => {
      const [x, y] = radarPoint(index, entry.value, centerX, centerY, radius);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.fillStyle = `${color}55`;
    context.strokeStyle = color;
    context.lineWidth = 4;
    context.fill();
    context.stroke();
    entries.forEach((entry, index) => {
      const [x, y] = radarPoint(index, 125, centerX, centerY, radius);
      context.fillStyle = "#b7c7d1";
      context.font = `800 12px ${family}`;
      context.textAlign = Math.abs(x - centerX) < 5 ? "center" : x < centerX ? "right" : "left";
      context.fillText(entry.label, x, y);
      context.fillStyle = "#f4f8f7";
      context.font = `900 13px ${family}`;
      context.fillText(`${entry.value}%`, x, y + 16);
    });
    context.restore();
  }

  function drawProfileCard(canvas) {
    const context = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const family = '"Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif';
    const mono = '"Cascadia Code", "Segoe UI", monospace';
    const color = state.player.color;

    context.clearRect(0, 0, width, height);
    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#07111f");
    background.addColorStop(.55, "#0c2639");
    background.addColorStop(1, "#11172e");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    const glow = context.createRadialGradient(240, 330, 20, 240, 330, 360);
    glow.addColorStop(0, `${color}55`);
    glow.addColorStop(1, "transparent");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    const stars = [
      [64, 76, 2], [198, 112, 3], [359, 63, 2], [526, 134, 2], [736, 72, 3],
      [893, 124, 2], [1094, 70, 2], [1028, 303, 3], [682, 338, 2], [1112, 578, 2]
    ];
    context.fillStyle = "rgba(240,250,249,.72)";
    stars.forEach(([x, y, radius]) => {
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    });

    context.strokeStyle = "rgba(98,228,236,.22)";
    context.lineWidth = 2;
    context.beginPath();
    context.ellipse(250, 355, 235, 150, -.15, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.ellipse(250, 355, 176, 112, .12, 0, Math.PI * 2);
    context.stroke();

    context.fillStyle = "#62e4ec";
    context.font = `900 25px ${mono}`;
    context.letterSpacing = "4px";
    context.fillText("ENGIFAR / CREW PROFILE", 62, 70);
    context.letterSpacing = "0px";

    context.fillStyle = "rgba(244,248,247,.72)";
    context.font = `800 17px ${family}`;
    context.fillText("WEB QUIZ FLIGHT MEMORY", 62, 103);

    drawCrew(context, 242, 322, 248, color);

    context.fillStyle = "#9eb0bf";
    context.font = `900 17px ${mono}`;
    context.fillText("CREW MEMBER", 450, 205);
    const nameSize = fitText(context, state.player.name, 650, 54, family, 900);
    context.fillStyle = "#f4f8f7";
    context.font = `900 ${nameSize}px ${family}`;
    context.fillText(state.player.name, 450, 267);

    const metrics = [
      { label: "OUTPUT / 正答率", value: `${state.metrics.power}%`, color: "#62e4ec" },
      { label: "SAFETY / 分野バランス", value: `${state.metrics.safety}%`, color: "#c9f765" },
      { label: "DISTANCE / 到達距離", value: `${(state.outcome.altitude * 1000).toLocaleString("ja-JP")} km`, color: "#ff9b55" }
    ];

    const metricLayout = [
      { x: 420, width: 192 },
      { x: 630, width: 192 },
      { x: 840, width: 320 }
    ];
    metrics.forEach((metric, index) => {
      const x = metricLayout[index].x;
      const y = 625;
      const boxWidth = metricLayout[index].width;
      roundedRectPath(context, x, y, boxWidth, 102, 18);
      context.fillStyle = "rgba(5,15,28,.72)";
      context.fill();
      context.strokeStyle = index === 2 ? "rgba(255,155,85,.32)" : "rgba(98,228,236,.2)";
      context.stroke();
      context.fillStyle = "#8296a7";
      context.font = `900 14px ${family}`;
      context.fillText(metric.label, x + 20, y + 29);
      context.fillStyle = metric.color;
      context.font = `900 ${index === 2 ? 27 : 38}px ${family}`;
      context.fillText(metric.value, x + 20, y + 78);
    });

    const rank = getFlightRank(state.outcome.altitude);
    const profile = getCrewProfile();
    context.textAlign = "left";
    context.fillStyle = "#8296a7";
    context.font = `900 14px ${family}`;
    context.fillText("FLIGHT RANK", 62, 564);
    context.fillStyle = rank.color;
    context.font = `900 30px ${family}`;
    context.fillText(rank.name, 62, 600);
    context.fillStyle = "#8296a7";
    context.font = `900 13px ${family}`;
    context.fillText(`FIT ROLE / ${profile.strongestCategory}`, 62, 632);
    context.fillStyle = "#62e4ec";
    context.font = `900 23px ${family}`;
    context.fillText(profile.role, 62, 661);
    context.fillStyle = "#b7c7d1";
    context.font = `800 13px ${family}`;
    context.fillText(profile.copy, 62, 690);
    context.fillStyle = "#8296a7";
    context.font = `900 14px ${family}`;
    context.fillText("6 FIELD RADAR", 1010, 230);
    drawCanvasRadar(context, radarEntries(), 930, 420, 155, color, family);

    context.fillStyle = "#ff7541";
    context.fillRect(0, height - 16, width, 16);
    context.fillStyle = color;
    context.fillRect(0, 0, 16, height);
  }

  function initCard() {
    if (!requireOutcome()) return;

    state.cardOpened = true;
    persist(state);

    const canvas = document.querySelector("#profile-card");
    const saveButton = document.querySelector("#save-card-button");
    const saveLabel = document.querySelector("#save-card-label");
    document.querySelector("#card-player-avatar").style.setProperty("--crew-color", state.player.color);
    document.querySelector("#card-player-name").textContent = state.player.name;
    document.querySelector("#card-power").textContent = state.metrics.power;
    document.querySelector("#card-safety").textContent = state.metrics.safety;
    document.querySelector("#card-altitude").textContent = (state.outcome.altitude * 1000).toLocaleString("ja-JP");
    document.querySelector("#card-rank").textContent = getFlightRank(state.outcome.altitude).name;
    const profile = getCrewProfile();
    document.querySelector("#card-role").textContent = profile.role;
    document.querySelector("#card-comment").textContent = profile.copy;
    setStateLink(document.querySelector("#result-back-top"), "./result.html", state);
    setStateLink(document.querySelector("#result-back-link"), "./result.html", state);
    drawProfileCard(canvas);

    saveButton.addEventListener("click", () => {
      saveButton.disabled = true;
      saveLabel.textContent = "画像を準備中…";
      const safeName = state.player.name.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "crew";

      function finishSave(url) {
        const link = document.createElement("a");
        link.href = url;
        link.download = `engifar-card-${safeName}.png`;
        document.body.append(link);
        link.click();
        link.remove();
        state.pngSaved = true;
        persist(state);
        saveLabel.textContent = "保存しました！";
        globalThis.setTimeout(() => {
          saveButton.disabled = false;
          saveLabel.textContent = "PNGで保存";
          if (url.startsWith("blob:")) URL.revokeObjectURL(url);
        }, 1400);
      }

      if (canvas.toBlob) {
        canvas.toBlob((blob) => {
          if (blob) finishSave(URL.createObjectURL(blob));
          else finishSave(canvas.toDataURL("image/png"));
        }, "image/png");
      } else {
        finishSave(canvas.toDataURL("image/png"));
      }
    });
  }

  globalThis.EngiFar = Object.freeze({
    get questionCount() { return quizConfig.questionCount; },
    thresholds: Object.freeze({ output: OUTPUT_THRESHOLD, safety: SAFETY_THRESHOLD }),
    calculateOutcome,
    computeMetrics,
    getFlightRank,
    ranks: FLIGHT_RANKS
  });

  async function initAuthoritativeResultPage() {
    if (state.room.sessionId) {
      const roomAuth = loadRoomAuth(state.room.code);
      if (!roomAuth) {
        goTo("./index.html", state, true);
        return;
      }
      try {
        await fetchAuthoritativeResults(roomAuth);
      } catch {
        state.metrics = null;
        state.outcome = null;
        state.status = "quiz";
        persist(state);
        goTo("./quiz.html", state, true);
        return;
      }
      if (page === "rocket" && state.status === "rocket") state.outcome = null;
      else state.outcome = calculateOutcome(state.metrics);
      persist(state);
      connectRoomSocket(roomAuth);
    }

    if (page === "rocket") initRocket();
    else if (page === "ranking") initRanking();
    else if (page === "award") initAward();
    else if (page === "result") initResult();
    else initCard();
  }

  if (page === "home") initHome();
  else if (page === "room") initRoom();
  else if (page === "quiz") void initQuiz();
  else if (page === "loading") initLoading();
  else if (["rocket", "ranking", "award", "result", "card"].includes(page)) void initAuthoritativeResultPage();
  if (page === "home" || page === "room") initGuide();
})();
