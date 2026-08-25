(() => {
  "use strict";

  const STORAGE_KEY = "engifar-mission-v3";
  const LEGACY_STORAGE_KEY = "engifar-mission-v2";
  const OUTPUT_THRESHOLD = 60;
  const SAFETY_THRESHOLD = 75;
  const ANSWER_SECONDS = 10;
  const REVIEW_SECONDS = 5;
  const FLIGHT_RANKS = Object.freeze([
    { key: "crash", min: 0, name: "不時着級", destination: "海（不時着）", color: "#62e4ec", legs: ["sky", "atmosphere-edge"], crashLanding: true },
    { key: "space_entry", min: 2800, name: "宇宙突入級", destination: "宇宙空間", color: "#8fe8ff", legs: ["sky", "atmosphere-edge", "space"] },
    { key: "moon", min: 4200, name: "月面着陸級", destination: "月", color: "#e7e4d7", legs: ["sky", "atmosphere-edge", "space", "space"], approachColor: "oklch(0.88 0.02 90)" },
    { key: "mars", min: 6500, name: "火星着陸級", destination: "火星", color: "#ff855f", legs: ["sky", "atmosphere-edge", "space", "space"], approachColor: "oklch(0.62 0.19 32)" },
    { key: "uranus", min: 8500, name: "天王星着陸級", destination: "天王星", color: "#72e3e6", legs: ["sky", "atmosphere-edge", "space", "space"], approachColor: "oklch(0.82 0.09 200)" },
    { key: "neptune", min: 10500, name: "海王星着陸級", destination: "海王星", color: "#678eff", legs: ["sky", "atmosphere-edge", "space", "space"], approachColor: "oklch(0.5 0.16 262)" },
    { key: "galaxy", min: 12000, name: "銀河超越級", destination: "新しい銀河", color: "#d58cff", legs: ["sky", "atmosphere-edge", "space", "space", "space"], approachColor: "oklch(0.7 0.16 300)" },
    { key: "unknown", min: 13500, name: "未知の惑星到達級", destination: "未知の惑星", color: "#ffd36a", legs: ["sky", "atmosphere-edge", "space", "space", "space"], approachColor: "oklch(0.85 0.18 40)" }
  ]);
  const PROFILE_ROLES = Object.freeze({
    "フロントエンド": { role: "INTERFACE CREATOR", copy: "画面の構造・見た目・動きを心地よく組み立てるクルー" },
    "バックエンド": { role: "SERVICE BUILDER", copy: "サービスを支える処理と実行環境を組み立てるクルー" },
    "データベース": { role: "DATA ARCHITECT", copy: "データの形とつながりを鮮やかに設計するクルー" },
    "インフラ": { role: "ORBIT OPERATOR", copy: "アプリがのびのび動ける環境を整えるクルー" },
    "API": { role: "CONNECTION DESIGNER", copy: "サービス同士をなめらかにつなぐクルー" },
    "セキュリティ": { role: "TRUST ENGINEER", copy: "安心して使えるサービス体験を育てるクルー" }
  });

  const rawQuestions = [
    { category: "フロントエンド", weight: 1, instruction: "「EngiFar」をページで最も重要な見出しとして表示します。空欄に入るHTMLタグ名を選んでください。", question: "<＿＿＿>EngiFar</＿＿＿>", choices: ["h1", "p", "span", "div"], answer: 0, explanation: "h1は、ページの中心となる見出しを表すHTMLタグです。" },
    { category: "フロントエンド", weight: 1, instruction: "「プロフィール」から /profile ページへ移動できるリンクを作ります。URLを指定する属性を選んでください。", question: '<a ＿＿＿="/profile">プロフィール</a>', choices: ["href", "src", "action", "to"], answer: 0, explanation: "aタグのhref属性に移動先のURLを指定します。" },
    { category: "フロントエンド", weight: 1, instruction: "タイトルの文字色を緑色にします。CSSで文字色を指定するプロパティを選んでください。", question: ".title {\n  ＿＿＿: #c9f765;\n}", choices: ["color", "background-color", "font-color", "text-color"], answer: 0, explanation: "colorプロパティは文字の色を指定します。" },
    { category: "フロントエンド", weight: 1.2, instruction: "ボタンをクリックしたときにstart関数が動くようにします。空欄に入るイベント名を選んでください。", question: 'button.addEventListener("＿＿＿", start);', choices: ["click", "press", "tap", "onClick"], answer: 0, explanation: "clickイベントは、ボタンなどがクリックされたときに発生します。" },

    { category: "バックエンド", weight: 1, instruction: "DenoでWebサーバーを起動して「Hello」と返します。サーバーを開始するメソッド名を選んでください。", question: 'Deno.＿＿＿(() => new Response("Hello"));', choices: ["serve", "start", "listenWeb", "runServer"], answer: 0, explanation: "Deno.serve()を使うと、HTTPリクエストを受け取るサーバーを起動できます。" },
    { category: "バックエンド", weight: 1, instruction: "非同期のfetchUser関数が完了するまで待ち、結果をuserへ入れます。空欄に入るキーワードを選んでください。", question: "const user = ＿＿＿ fetchUser();", choices: ["await", "wait", "async", "then"], answer: 0, explanation: "awaitはPromiseの完了を待って、その結果を受け取ります。" },
    { category: "バックエンド", weight: 1.1, instruction: "JavaScriptのオブジェクトをAPIで送れるJSON文字列へ変換します。使うメソッド名を選んでください。", question: "const body = JSON.＿＿＿({ ok: true });", choices: ["stringify", "parse", "encode", "toJSON"], answer: 0, explanation: "JSON.stringify()は、オブジェクトをJSON形式の文字列へ変換します。" },
    { category: "バックエンド", weight: 1.2, instruction: "config.txtの内容を文字列として読み込みます。Denoのファイル読み込みメソッドを選んでください。", question: 'const text = await Deno.＿＿＿("config.txt");', choices: ["readTextFile", "readFileText", "openText", "load"], answer: 0, explanation: "Deno.readTextFile()は、ファイルの内容を文字列として読み取ります。" },

    { category: "データベース", weight: 1, instruction: "usersテーブルにあるすべての列を取得します。空欄に入るSQLの命令を選んでください。", question: "＿＿＿ * FROM users;", choices: ["SELECT", "GET", "READ", "FIND"], answer: 0, explanation: "SELECTは、データベースからデータを取得するSQLの命令です。" },
    { category: "データベース", weight: 1, instruction: "usersテーブルからidが3の行だけを取得します。条件を指定するキーワードを選んでください。", question: "SELECT * FROM users\n＿＿＿ id = 3;", choices: ["WHERE", "WHEN", "IF", "FILTER"], answer: 0, explanation: "WHEREを使うと、取得する行の条件を指定できます。" },
    { category: "データベース", weight: 1.1, instruction: "usersテーブルへ名前がAoiのデータを1件追加します。空欄に入るSQLの命令を選んでください。", question: '＿＿＿ INTO users (name)\nVALUES ("Aoi");', choices: ["INSERT", "ADD", "CREATE", "PUSH"], answer: 0, explanation: "INSERT INTOは、テーブルへ新しい行を追加するSQLの命令です。" },
    { category: "データベース", weight: 1.2, instruction: "ordersテーブルをuser_idごとにまとめ、ユーザー別の注文数を数えます。空欄を選んでください。", question: "SELECT user_id, COUNT(*)\nFROM orders\n＿＿＿ user_id;", choices: ["GROUP BY", "ORDER BY", "COLLECT BY", "PARTITION WITH"], answer: 0, explanation: "GROUP BYは、同じuser_idの行をグループにまとめて集計します。" },

    { category: "API", weight: 1, instruction: "APIからユーザー一覧を取得します。データ取得に使うHTTPメソッドを選んでください。", question: 'fetch("/api/users", {\n  method: "＿＿＿"\n});', choices: ["GET", "POST", "PUT", "DELETE"], answer: 0, explanation: "GETは、サーバーからデータを取得するときに使うHTTPメソッドです。" },
    { category: "API", weight: 1, instruction: "APIへ新しいユーザー情報を送って登録します。新規作成に使うHTTPメソッドを選んでください。", question: 'fetch("/api/users", {\n  method: "＿＿＿",\n  body: JSON.stringify(user)\n});', choices: ["POST", "GET", "HEAD", "TRACE"], answer: 0, explanation: "POSTは、サーバーへデータを送り、新しいデータを作るときに使います。" },
    { category: "API", weight: 1, instruction: "APIの処理が正常に完了したことを表す、基本的なHTTPステータスを選んでください。", question: "HTTP/1.1 ＿＿＿ OK", choices: ["200", "404", "500", "301"], answer: 0, explanation: "200 OKは、リクエストが正常に処理されたことを表します。" },
    { category: "API", weight: 1.2, instruction: "fetchで受け取ったレスポンス本文をJSONとして読み取ります。空欄に入るメソッド名を選んでください。", question: 'const response = await fetch("/api/users");\nconst data = await response.＿＿＿();', choices: ["json", "parseJSON", "toObject", "bodyJSON"], answer: 0, explanation: "Responseのjson()は、レスポンス本文をJSONとして読み取ります。" },

    { category: "インフラ", weight: 1, instruction: "Gitで現在の変更状況を確認します。空欄に入るコマンドを選んでください。", question: "git ＿＿＿", choices: ["status", "check", "state", "show-all"], answer: 0, explanation: "git statusは、変更されたファイルや現在のブランチ状態を表示します。" },
    { category: "インフラ", weight: 1, instruction: "package.jsonに書かれた依存パッケージをインストールします。空欄に入るnpmコマンドを選んでください。", question: "npm ＿＿＿", choices: ["install", "download", "setup", "packages"], answer: 0, explanation: "npm installは、package.jsonを読み、必要なパッケージをインストールします。" },
    { category: "インフラ", weight: 1.1, instruction: "package.jsonのscriptsに登録されたdevコマンドを実行します。空欄を選んでください。", question: "npm run ＿＿＿", choices: ["dev", "install", "package", "node"], answer: 0, explanation: "npm run devは、scriptsに登録されたdevコマンドを実行します。" },
    { category: "インフラ", weight: 1.2, instruction: "Docker Composeのコンテナをバックグラウンドで起動します。空欄に入るオプションを選んでください。", question: "docker compose up ＿＿＿", choices: ["-d", "-b", "--hide", "--later"], answer: 0, explanation: "-dを付けると、コンテナをバックグラウンドで起動できます。" },

    { category: "セキュリティ", weight: 1, instruction: "入力したパスワードの文字が画面上で隠れて表示される入力欄を作ります。typeの値を選んでください。", question: '<input type="＿＿＿" name="password">', choices: ["password", "secret", "hidden-text", "secure"], answer: 0, explanation: 'type="password"にすると、入力文字が伏せて表示されます。' },
    { category: "セキュリティ", weight: 1, instruction: "ユーザー入力をHTMLとして解釈せず、文字列のまま画面へ表示します。使うプロパティを選んでください。", question: "message.＿＿＿ = userInput;", choices: ["textContent", "innerHTML", "outerHTML", "htmlValue"], answer: 0, explanation: "textContentは内容を文字列として扱い、安心できる画面表示につながります。" },
    { category: "セキュリティ", weight: 1.1, instruction: "保存前のパスワードからbcryptのハッシュ値を作ります。空欄に入るメソッド名を選んでください。", question: "const hash = await bcrypt.＿＿＿(password, 10);", choices: ["hash", "encrypt", "protect", "secure"], answer: 0, explanation: "bcrypt.hash()は、パスワードから保存用のハッシュ値を生成します。" },
    { category: "セキュリティ", weight: 1.2, instruction: "userIdをSQL文字列へ直接つなげず、パラメータとして渡します。空欄に入るプレースホルダーを選んでください。", question: 'const result = await db.query(\n  "SELECT * FROM users WHERE id = ＿＿＿",\n  [userId]\n);', choices: ["$1", "userId", "input", "raw"], answer: 0, explanation: "$1と値の配列を使うと、入力値をパラメータとして安全に渡せます。" }
  ];

  const questionBank = rawQuestions.map((item, index) => {
    const shift = index % item.choices.length;
    return {
      ...item,
      choices: item.choices.slice(shift).concat(item.choices.slice(0, shift)),
      answer: (item.answer - shift + item.choices.length) % item.choices.length
    };
  });

  const app = document.querySelector("#app");
  if (!app) return;

  const page = app.dataset.page || "home";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function safeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function createDefaultState() {
    return {
      version: 3,
      missionId: String(Date.now()),
      updatedAt: Date.now(),
      status: "setup",
      playerConfigured: false,
      cardOpened: false,
      player: { name: "CREW MEMBER", color: "#54d37c" },
      room: { mode: "create", name: "ロケット部", code: "------" },
      quiz: {
        index: 0,
        answers: Array(questionBank.length).fill(null),
        records: Array(questionBank.length).fill(null)
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
    const answers = Array.isArray(quizSource.answers) ? quizSource.answers.slice(0, questionBank.length) : [];
    const records = Array.isArray(quizSource.records) ? quizSource.records.slice(0, questionBank.length) : [];
    while (answers.length < questionBank.length) answers.push(null);
    while (records.length < questionBank.length) records.push(null);

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

    let outcome = null;
    if (source.outcome && Number.isFinite(Number(source.outcome.altitude))) {
      const reachedOrbit = typeof source.outcome.reachedOrbit === "boolean"
        ? source.outcome.reachedOrbit
        : Boolean(source.outcome.success);
      outcome = {
        reachedOrbit,
        kind: reachedOrbit ? "orbit" : "spark",
        altitude: Math.max(0, Math.round(safeNumber(source.outcome.altitude))),
        title: String(source.outcome.title || ""),
        rankKey: String(source.outcome.rankKey || ""),
        rankName: String(source.outcome.rankName || ""),
        destination: String(source.outcome.destination || "")
      };
    }

    const name = String(playerSource.name || "CREW MEMBER").trim().slice(0, 18) || "CREW MEMBER";
    return {
      version: 3,
      missionId: String(source.missionId || fallback.missionId),
      updatedAt: Math.max(0, safeNumber(source.updatedAt, 0)),
      status: String(source.status || (outcome ? "result" : metrics ? "rocket" : "setup")),
      playerConfigured: Boolean(source.playerConfigured || playerSource.name || metrics),
      cardOpened: Boolean(source.cardOpened),
      player: { name, color: normalizeColor(playerSource.color) },
      room: {
        mode: roomSource.mode === "join" ? "join" : "create",
        name: String(roomSource.name || "ロケット部").trim().slice(0, 20) || "ロケット部",
        code: String(roomSource.code || "------").trim().toUpperCase().slice(0, 8) || "------"
      },
      quiz: {
        index: Math.round(clamp(safeNumber(quizSource.index, 0), 0, questionBank.length)),
        answers,
        records
      },
      metrics,
      outcome
    };
  }

  function readHashState() {
    try {
      const parameters = new URLSearchParams(window.location.hash.slice(1));
      const payload = parameters.get("mission");
      return payload ? normalizeState(JSON.parse(payload)) : null;
    } catch {
      return null;
    }
  }

  function readStoredState(key) {
    try {
      const value = window.sessionStorage.getItem(key);
      return value ? normalizeState(JSON.parse(value)) : null;
    } catch {
      return null;
    }
  }

  function loadState() {
    const candidates = [
      readStoredState(STORAGE_KEY),
      readHashState(),
      readStoredState(LEGACY_STORAGE_KEY)
    ].filter(Boolean);
    if (!candidates.length) return createDefaultState();
    candidates.sort((a, b) => safeNumber(b.updatedAt) - safeNumber(a.updatedAt));
    return candidates[0];
  }

  let state = loadState();

  function persist(nextState = state) {
    nextState.updatedAt = Date.now();
    state = normalizeState(nextState);
    state.updatedAt = nextState.updatedAt;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // URL hash remains available as a portable fallback.
    }
    return state;
  }

  function stateHash(nextState = state) {
    return `#mission=${encodeURIComponent(JSON.stringify(nextState))}`;
  }

  function goTo(path, nextState = state) {
    const saved = persist(nextState);
    window.location.href = `${path}${stateHash(saved)}`;
  }

  function setStateLink(element, path, nextState = state) {
    if (element) element.href = `${path}${stateHash(nextState)}`;
  }

  function requirePlayer() {
    if (state.playerConfigured) return true;
    goTo("./index.html", state);
    return false;
  }

  function requireMetrics() {
    if (!requirePlayer()) return false;
    if (state.metrics) return true;
    goTo("./quiz.html", state);
    return false;
  }

  function requireOutcome() {
    if (!requireMetrics()) return false;
    if (state.outcome) return true;
    goTo("./rocket.html", state);
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

  /* ----------------------------------------------------------------
     チーム集計画面(result-final.html)向けのローカル・リーダーボード。
     result-final.js が消費する window.RESULT_DATA は
     result-final-data.js が localStorage(LEADERBOARD_KEY)から読み込む。
     ここでは、実際のプレイ結果を1件ずつそのストレージへ追記する。
     ---------------------------------------------------------------- */
  const LEADERBOARD_KEY = "engifar-leaderboard-v1";

  // result-final.js の TEAM 要素(testResult)が使う英語キーへの変換表。
  const CATEGORY_KEY_MAP = {
    "フロントエンド": "Front",
    "バックエンド": "Back",
    "データベース": "DB",
    "インフラ": "INFRA",
    "API": "API",
    "セキュリティ": "SEC"
  };

  function mapCategoryScoresToTestResult(categoryScores) {
    const source = categoryScores && typeof categoryScores === "object" ? categoryScores : {};
    const testResult = {};
    Object.entries(CATEGORY_KEY_MAP).forEach(([japaneseKey, englishKey]) => {
      testResult[englishKey] = Math.round(clamp(safeNumber(source[japaneseKey]), 0, 100));
    });
    return testResult;
  }

  function readLeaderboard() {
    try {
      const raw = window.localStorage.getItem(LEADERBOARD_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function appendLeaderboardEntry(runState) {
    try {
      const leaderboard = readLeaderboard();
      const lightness = rgbToHsl(hexToRgb(runState.player.color)).l;
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: runState.player.name,
        iconColor: { value: runState.player.color, light: lightness > 68 },
        testResult: mapCategoryScoresToTestResult(runState.metrics && runState.metrics.categoryScores)
      };
      leaderboard.push(entry);
      window.localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(leaderboard));
    } catch {
      // localStorage が使えない環境(プライベートモード等)では静かに諦める。
      // persist() の sessionStorage 保存と同じ方針。
    }
  }

  function initHome() {
    const nameInput = document.querySelector("#player-name");
    const colorInput = document.querySelector("#player-color");
    const hueSlider = document.querySelector("#hue-slider");
    const palette = document.querySelector("#tone-palette");
    const colorCode = document.querySelector("#color-code");
    const preview = document.querySelector("#player-preview");
    const joinToggle = document.querySelector("#join-room-button");
    const joinPanel = document.querySelector("#join-room-panel");
    const createButton = document.querySelector("#start-button");
    const joinButton = document.querySelector("#enter-room-button");
    const roomCode = document.querySelector("#room-code");
    if (!nameInput || !colorInput || !hueSlider || !palette || !createButton || !joinButton) return;

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

    function createRoomCode() {
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
    }

    function enterRoom(mode) {
      const fresh = createDefaultState();
      fresh.playerConfigured = true;
      fresh.status = "room";
      fresh.player = {
        name: nameInput.value.trim().slice(0, 18) || "CREW MEMBER",
        color: normalizeColor(colorInput.value)
      };
      fresh.room = mode === "join"
        ? { mode: "join", name: "招待ルーム", code: (roomCode.value.trim().toUpperCase() || "STAR24").slice(0, 8) }
        : { mode: "create", name: "ENGIFAR", code: createRoomCode() };
      createButton.disabled = true;
      joinButton.disabled = true;
      goTo("./room.html", fresh);
    }

    function toggleJoinPanel() {
      const openJoin = joinPanel.hidden;
      joinPanel.hidden = !openJoin;
      joinToggle.setAttribute("aria-expanded", String(openJoin));
    }

    joinToggle.addEventListener("click", toggleJoinPanel);
    createButton.addEventListener("click", () => enterRoom("create"));
    joinButton.addEventListener("click", () => enterRoom("join"));
    nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") enterRoom("create");
    });
  }

  function initRoom() {
    if (!requirePlayer()) return;
    const colorTargets = [document.querySelector("#room-list-avatar")];
    colorTargets.forEach((target) => target && target.style.setProperty("--crew-color", state.player.color));
    document.querySelector("#room-player-name").textContent = state.player.name;
    document.querySelector("#room-code-value").textContent = state.room.code;
    setStateLink(document.querySelector("#room-home-link"), "./index.html", state);
    if (window.EngifarRoomAvatars) {
      try {
        window.EngifarRoomAvatars.init({
          containerSelector: "#roomAvatarField",
          participants: [
            { id: "crew-1", name: "クルーA", color: "#ff665f", isYou: false },
            { id: "crew-2", name: "クルーB", color: "#5ca9ff", isYou: false },
            { id: "crew-3", name: "クルーC", color: "#f5cf4b", isYou: false },
            { id: "crew-4", name: "クルーD", color: "#54d37c", isYou: false },
            { id: "you", name: state.player.name, color: state.player.color, isYou: true }
          ]
        });
      } catch (err) {
        // Never let a broken avatar layer take the start button and guide
        // modal down with it - those are wired up below/after this call.
        console.error("EngifarRoomAvatars.init failed", err);
      }
    }
    document.querySelector("#room-start-button").addEventListener("click", () => {
      const next = createDefaultState();
      next.playerConfigured = true;
      next.player = { ...state.player };
      next.room = { ...state.room };
      next.status = "quiz";
      goTo("./loading.html", next);
    });
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
      window.requestAnimationFrame(() => modal.focus());
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
        alreadyShown = window.sessionStorage.getItem("engifar-guide-shown") === "1";
        window.sessionStorage.setItem("engifar-guide-shown", "1");
      } catch {
        alreadyShown = false;
      }
      if (!alreadyShown) window.setTimeout(() => openGuide(null), reducedMotion ? 0 : 350);
    }
  }

  function difficultyLabel(weight) {
    if (weight >= 1.2) return "CHALLENGE";
    if (weight >= 1.1) return "STANDARD";
    return "BASIC";
  }

  function computeMetrics(records) {
    const categories = [...new Set(questionBank.map((question) => question.category))];
    let correctWeight = 0;
    let totalWeight = 0;
    const categoryScores = {};

    questionBank.forEach((question, index) => {
      totalWeight += question.weight;
      if (records[index] && records[index].correct) correctWeight += question.weight;
    });

    categories.forEach((category) => {
      let categoryCorrect = 0;
      let categoryTotal = 0;
      questionBank.forEach((question, index) => {
        if (question.category !== category) return;
        categoryTotal += question.weight;
        if (records[index] && records[index].correct) categoryCorrect += question.weight;
      });
      categoryScores[category] = Math.round((categoryCorrect / categoryTotal) * 100);
    });

    const power = Math.round((correctWeight / totalWeight) * 100);
    const safety = Math.round(
      categories.reduce((sum, category) => sum + categoryScores[category], 0) / categories.length
    );
    return { power, safety, categoryScores };
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
      requestId = window.requestAnimationFrame(frame);
    }

    onTick(seconds, 1);
    requestId = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(requestId);
  }

  function initQuiz() {
    if (!requirePlayer()) return;

    const elements = {
      card: document.querySelector("#quiz-card"),
      avatar: document.querySelector("#quiz-player-avatar"),
      playerName: document.querySelector("#quiz-player-name"),
      current: document.querySelector("#question-current"),
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

    let questionIndex = Math.min(state.quiz.index, questionBank.length - 1);
    let selectedChoice = Number.isInteger(state.quiz.answers[questionIndex])
      ? state.quiz.answers[questionIndex]
      : null;
    let cancelClock = () => {};
    let phaseToken = 0;

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
      window.setTimeout(() => effect.remove(), 1900);
    }

    function finishQuiz() {
      cancelClock();
      state.quiz.index = questionBank.length;
      state.metrics = computeMetrics(state.quiz.records);
      state.outcome = null;
      state.status = "rocket";
      goTo("./rocket-loading.html", state);
    }

    function showReview(question, token) {
      if (token !== phaseToken) return;
      elements.card.dataset.mode = "review";
      elements.timerLabel.textContent = "確認";
      elements.reviewCount.hidden = false;

      const isCorrect = selectedChoice === question.answer;
      if (isCorrect) launchCorrectConfetti();
      state.quiz.answers[questionIndex] = selectedChoice;
      state.quiz.records[questionIndex] = {
        selected: selectedChoice,
        correct: isCorrect,
        category: question.category,
        weight: question.weight
      };
      persist(state);

      [...elements.answers.children].forEach((button, index) => {
        button.disabled = true;
        button.classList.toggle("is-answer", index === question.answer);
        button.classList.toggle("is-selected", index === selectedChoice && index !== question.answer);
        button.classList.toggle("is-muted", index !== question.answer && index !== selectedChoice);
      });

      elements.feedbackIcon.textContent = isCorrect ? "✓" : "✦";
      elements.feedbackTitle.textContent = isCorrect ? "ナイスチャージ！" : "正解を確認！";
      elements.feedbackText.textContent = selectedChoice === null
        ? `今回は自動で答えを確認しました。${question.explanation}`
        : `${question.explanation} 次の推進力にしよう。`;

      cancelClock = runClock(
        REVIEW_SECONDS,
        (shown, ratio) => {
          elements.timerValue.textContent = String(shown);
          elements.reviewCount.textContent = String(shown);
          elements.timer.style.setProperty("--timer-progress", String(ratio));
        },
        () => {
          if (token !== phaseToken) return;
          if (questionIndex >= questionBank.length - 1) {
            finishQuiz();
            return;
          }
          questionIndex += 1;
          state.quiz.index = questionIndex;
          selectedChoice = Number.isInteger(state.quiz.answers[questionIndex])
            ? state.quiz.answers[questionIndex]
            : null;
          persist(state);
          renderQuestion();
        }
      );
    }

    function renderQuestion() {
      document.querySelectorAll(".correct-confetti").forEach((effect) => effect.remove());
      phaseToken += 1;
      const token = phaseToken;
      cancelClock();

      const question = questionBank[questionIndex];
      elements.card.dataset.mode = "answer";
      elements.current.textContent = String(questionIndex + 1).padStart(2, "0");
      elements.category.textContent = question.category;
      elements.difficulty.textContent = difficultyLabel(question.weight);
      elements.progress.style.width = `${((questionIndex + 1) / questionBank.length) * 100}%`;
      elements.timerLabel.textContent = "回答";
      elements.timerValue.textContent = String(ANSWER_SECONDS);
      elements.timer.style.setProperty("--timer-progress", "1");
      elements.instruction.textContent = question.instruction;
      elements.question.textContent = question.question;
      elements.feedbackIcon.textContent = "✦";
      elements.feedbackTitle.textContent = "10秒間は何度でも回答を変更できます";
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
        ANSWER_SECONDS,
        (shown, ratio) => {
          elements.timerValue.textContent = String(shown);
          elements.timer.style.setProperty("--timer-progress", String(ratio));
        },
        () => showReview(question, token)
      );
    }

    renderQuestion();
  }

  function getFlightRank(altitude) {
    const height = Math.max(0, safeNumber(altitude));
    return [...FLIGHT_RANKS].reverse().find((rank) => height >= rank.min) || FLIGHT_RANKS[0];
  }

  function calculateOutcome(metrics) {
    const power = clamp(safeNumber(metrics.power), 0, 100);
    const safety = clamp(safeNumber(metrics.safety), 0, 100);
    const reachedOrbit = power >= OUTPUT_THRESHOLD && safety >= SAFETY_THRESHOLD;
    const altitude = reachedOrbit
      ? Math.round(6200 + power * 48 + safety * 30)
      : Math.round(800 + power * 48 + safety * 25);
    const average = (power + safety) / 2;

    let title = "空へ一歩、ナイスフライト！";
    if (reachedOrbit) title = "軌道到達！";
    else if (average >= 72) title = "星空手前で大きなきらめき！";
    else if (average >= 48) title = "雲の上までフライト！";

    const rank = getFlightRank(altitude);
    return {
      reachedOrbit,
      kind: reachedOrbit ? "orbit" : "spark",
      altitude,
      title,
      rankKey: rank.key,
      rankName: rank.name,
      destination: rank.destination
    };
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
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
    const resultContent = window.ROCKET_LAUNCH_RESULTS || {};
    const botColors = ["oklch(0.62 0.20 24)", "oklch(0.62 0.17 253)", "oklch(0.83 0.16 93)", state.player.color];
    const botSpots = [{ left: "28%", top: "78%" }, { left: "38%", top: "84%" }, { left: "60%", top: "84%" }, { left: "71%", top: "77%" }];
    const captions = { ground: "発射準備", sky: "上空へ", "atmosphere-edge": "大気圏付近", space: "宇宙空間", sea: "着水" };
    let running = false;

    const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    const showScreen = (target) => [elements.setup, elements.launch, elements.result].forEach((screen) => {
      const active = screen === target;
      screen.classList.toggle("is-active", active);
      screen.setAttribute("aria-hidden", String(!active));
    });
    const setSkyLeg = (leg) => elements.sky.querySelectorAll(".rl-sky-layer").forEach((layer) => layer.classList.toggle("is-visible", layer.dataset.leg === leg));
    const setCaption = (text) => { elements.caption.textContent = text; elements.caption.classList.toggle("is-visible", Boolean(text)); };
    const robotSvg = (color) => `<svg class="bot-svg" viewBox="0 0 100 130" role="img" aria-hidden="true"><ellipse cx="50" cy="118" rx="24" ry="7" fill="${color}" opacity="0.3"/><line x1="50" y1="10" x2="50" y2="24" stroke="${color}" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="8" r="6" fill="oklch(0.85 0.1 202)"/><rect x="20" y="22" width="60" height="76" rx="30" fill="${color}" stroke="oklch(0.2 0.02 260 / 0.25)" stroke-width="2"/><rect x="32" y="42" width="36" height="26" rx="12" fill="oklch(0.97 0.006 260)"/><circle cx="43" cy="55" r="4" fill="oklch(0.22 0.03 262)"/><circle cx="57" cy="55" r="4" fill="oklch(0.22 0.03 262)"/></svg>`;

    async function boardBots() {
      elements.bots.innerHTML = "";
      const bots = botSpots.map((spot, index) => {
        const bot = document.createElement("div");
        bot.className = "rl-runway-bot"; bot.style.left = spot.left; bot.style.top = spot.top; bot.innerHTML = robotSvg(botColors[index]); elements.bots.append(bot); return bot;
      });
      await wait(120);
      for (const bot of bots) { bot.style.left = "50%"; bot.style.top = "57%"; await wait(160); bot.classList.add("is-boarding"); }
      await wait(300); elements.hatch.classList.add("is-open"); await wait(150); elements.hatch.classList.remove("is-open"); elements.bots.innerHTML = "";
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
      await boardBots(); await bounceRocket(); await igniteRocket(); await liftoffRocket(); await flyThrough(); showResult(); running = false;
    }
    elements.launchButton.addEventListener("click", runLaunchSequence);
    elements.resultButton.addEventListener("click", () => {
      appendLeaderboardEntry(state);
      goTo("./result-final.html", state);
    });
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
      if (progress < 1) window.requestAnimationFrame(frame);
    }
    window.requestAnimationFrame(frame);
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

    const cardLink = document.querySelector("#card-link");
    setStateLink(cardLink, "./card.html", state);
    cardLink.addEventListener("click", (event) => {
      event.preventDefault();
      state.cardOpened = true;
      goTo("./card.html", state);
    });

    const retryButton = document.querySelector("#retry-button");
    retryButton.disabled = !state.cardOpened;
    retryButton.setAttribute("aria-disabled", String(!state.cardOpened));
    retryButton.title = state.cardOpened ? "もう一度チャレンジ" : "自己紹介カードを開くと次のチャレンジへ進めます";
    retryButton.addEventListener("click", () => {
      if (!state.cardOpened) return;
      const fresh = createDefaultState();
      fresh.player = { ...state.player };
      fresh.playerConfigured = true;
      goTo("./index.html", fresh);
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
      entries.forEach((entry, index) => {
        const [x, y] = radarPoint(index, level, centerX, centerY, radius);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
      context.strokeStyle = level === 100 ? "rgba(98,228,236,.42)" : "rgba(98,228,236,.17)";
      context.lineWidth = level === 100 ? 2 : 1;
      context.stroke();
    });
    entries.forEach((entry, index) => {
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
        saveLabel.textContent = "保存しました！";
        window.setTimeout(() => {
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

  window.EngiFar = Object.freeze({
    questionCount: questionBank.length,
    thresholds: Object.freeze({ output: OUTPUT_THRESHOLD, safety: SAFETY_THRESHOLD }),
    calculateOutcome,
    computeMetrics,
    getFlightRank,
    ranks: FLIGHT_RANKS
  });

  if (page === "home") initHome();
  else if (page === "room") initRoom();
  else if (page === "quiz") initQuiz();
  else if (page === "rocket") initRocket();
  else if (page === "result") initResult();
  else if (page === "card") initCard();
  if (page === "home" || page === "room") initGuide();
})();
