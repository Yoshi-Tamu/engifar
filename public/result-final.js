/* ============================================================
   ENGIFAR - 集計結果(ランキング発表 → 表彰式 → 最終リザルト)
   役割:
   - チームメンバーの能力値(6軸)からスコア・順位・チーム平均・
     チームマッチング度を算出する
   - ランキング発表(3位→2位→1位のカットイン)→ 表彰式 → 最終リザルト
     の3画面を rocket-launch.js と同じ showScreen() 方式で制御する
   - アバター(robotSvg)・レーダーチャート(radarChartSvg)は
     room.js / rocket-launch.js と同じ意匠を複製する(このページは
     room.js を読み込まないため、関数を import せず手動でコピーしている。
     room.js 側の見た目・挙動を変えた場合はここも合わせて更新すること)
   ============================================================ */

(function () {
  "use strict";

  /* ---------------- 能力値(6軸)定義: room.js と共通 ---------------- */
  const STAT_KEYS = ["Front", "Back", "DB", "INFRA", "API", "SEC"];
  const STAT_LABELS_JA = {
    Front: "フロントエンド",
    Back: "バックエンド",
    DB: "データベース",
    INFRA: "インフラ",
    API: "API",
    SEC: "セキュリティ",
  };

  /* ================================================================
     チームデータ: EngiFar-localDemo 側で window.RESULT_DATA として
     localStorage の実プレイ結果リーダーボードから供給される
     (result-final-data.js が result-final.js より前に読み込まれ、
     window.RESULT_DATA.members を用意する。rocket-launch-results.js が
     window.ROCKET_LAUNCH_RESULTS を同じ方式で公開しているのと同じパターン)。
     実際のプレイ履歴が0件のときは空配列になり得るため、以降の処理は
     TEAM.length が 0/1/2 でも例外を投げないよう防御的に書いてある。
     ================================================================ */
  const TEAM = (window.RESULT_DATA && Array.isArray(window.RESULT_DATA.members)) ? window.RESULT_DATA.members : [];

  function computeScore(testResult) {
    const sum = STAT_KEYS.reduce((acc, key) => acc + (testResult[key] || 0), 0);
    return Math.round(sum / STAT_KEYS.length);
  }
  TEAM.forEach((user) => { user.score = computeScore(user.testResult); });

  // スコア降順 = チーム内ランキング(RANKED[0] が1位)。同点の場合は名前順で決定的に並べる。
  const RANKED = TEAM.slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ja"));

  function computeTeamAverage(team) {
    const avg = {};
    STAT_KEYS.forEach((key) => {
      // team が空(実プレイ0件)のときは 0 除算で NaN にしないよう、平均0として扱う。
      avg[key] = team.length ? team.reduce((acc, u) => acc + (u.testResult[key] || 0), 0) / team.length : 0;
    });
    return avg;
  }
  const TEAM_AVERAGE = computeTeamAverage(TEAM);
  const TEAM_AVERAGE_ROUNDED = {};
  STAT_KEYS.forEach((key) => { TEAM_AVERAGE_ROUNDED[key] = Math.round(TEAM_AVERAGE[key]); });

  // 各メンバーの「チーム平均との平均絶対差」をチーム全体で平均し、
  // 100 から差し引くことで一致度(%)とする。差が全く無ければ100%に近づく。
  function computeMatchingPercent(team, avg) {
    // team が空のときは算出対象が無いため、0除算(NaN)を避けて0扱いにする(表示上のno-op)。
    if (!team.length) return 0;
    const perMemberDeviation = team.map((user) =>
      STAT_KEYS.reduce((acc, key) => acc + Math.abs((user.testResult[key] || 0) - avg[key]), 0) / STAT_KEYS.length
    );
    const teamDeviation = perMemberDeviation.reduce((a, b) => a + b, 0) / perMemberDeviation.length;
    return Math.max(0, Math.min(100, Math.round(100 - teamDeviation)));
  }
  const MATCHING_PERCENT = computeMatchingPercent(TEAM, TEAM_AVERAGE);

  /* ================================================================
     ユーティリティ
     ================================================================ */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function getInitial(name) {
    const trimmed = (name || "").trim();
    return trimmed ? trimmed[0].toUpperCase() : "?";
  }
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function sortedStats(testResult) {
    if (!testResult) return null;
    return STAT_KEYS.map((key) => ({ key, value: testResult[key] || 0 })).sort((a, b) => b.value - a.value);
  }
  function getTopRoleLabel(testResult) {
    const sorted = sortedStats(testResult);
    if (!sorted || sorted[0].value <= 0) return null;
    return STAT_LABELS_JA[sorted[0].key];
  }

  /* ================================================================
     ロボットアバターSVG(room.js / rocket-launch.js と同じ意匠)
     ================================================================ */
  function robotSvg(color) {
    return `<svg class="bot-svg" viewBox="0 0 100 130" role="img" aria-hidden="true">
      <ellipse cx="50" cy="118" rx="24" ry="7" fill="${color}" opacity="0.3"/>
      <line x1="50" y1="10" x2="50" y2="24" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
      <circle cx="50" cy="8" r="6" fill="oklch(0.85 0.1 202)"/>
      <rect x="20" y="22" width="60" height="76" rx="30" fill="${color}" stroke="oklch(0.2 0.02 260 / 0.25)" stroke-width="2"/>
      <rect x="32" y="42" width="36" height="26" rx="12" fill="oklch(0.97 0.006 260)"/>
      <circle class="bot-eye" cx="43" cy="55" r="4" fill="oklch(0.22 0.03 262)"/>
      <circle class="bot-eye" cx="57" cy="55" r="4" fill="oklch(0.22 0.03 262)"/>
    </svg>`;
  }

  function crownSvg() {
    return `<svg class="rf-crown-svg" viewBox="0 0 64 44" role="img" aria-label="優勝の王冠">
      <path d="M4 40 L2 14 L18 26 L32 6 L46 26 L62 14 L60 40 Z" fill="oklch(0.85 0.16 93)" stroke="oklch(0.55 0.14 70)" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="2" cy="12" r="4.5" fill="oklch(0.9 0.15 93)"/>
      <circle cx="32" cy="5" r="5" fill="oklch(0.9 0.15 93)"/>
      <circle cx="62" cy="12" r="4.5" fill="oklch(0.9 0.15 93)"/>
      <rect x="6" y="36" width="52" height="6" rx="2" fill="oklch(0.7 0.19 42)"/>
      <circle cx="20" cy="24" r="2.6" fill="oklch(0.7 0.19 350)"/>
      <circle cx="32" cy="18" r="2.6" fill="oklch(0.68 0.18 202)"/>
      <circle cx="44" cy="24" r="2.6" fill="oklch(0.7 0.19 350)"/>
    </svg>`;
  }

  /* ================================================================
     六角形レーダーチャート(room.js と同じ座標計算)
     ================================================================ */
  function radarPoint(cx, cy, maxR, value, index) {
    const angleDeg = -90 + index * 60;
    const angle = (angleDeg * Math.PI) / 180;
    const r = (maxR * Math.max(0, Math.min(100, value))) / 100;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  }
  function radarLabelPos(cx, cy, labelR, index) {
    const angleDeg = -90 + index * 60;
    const angle = (angleDeg * Math.PI) / 180;
    return { x: cx + Math.cos(angle) * labelR, y: cy + Math.sin(angle) * labelR };
  }
  function radarPolygonPoints(cx, cy, maxR, testResult) {
    return STAT_KEYS.map((key, i) => {
      const p = radarPoint(cx, cy, maxR, testResult[key] || 0, i);
      return p.x.toFixed(1) + "," + p.y.toFixed(1);
    }).join(" ");
  }

  // 目盛りの同心多角形と軸線(radarChartSvg / teamRadarSvg で共通)
  function radarGridMarkup(cx, cy, maxR, opacity) {
    const rings = [0.25, 0.5, 0.75, 1];
    const ringPolys = rings
      .map((frac) => {
        const pts = STAT_KEYS.map((_, i) => {
          const p = radarPoint(cx, cy, maxR, frac * 100, i);
          return p.x.toFixed(1) + "," + p.y.toFixed(1);
        }).join(" ");
        return `<polygon points="${pts}" fill="none" stroke="oklch(0.4 0.03 262 / ${opacity})" stroke-width="1"/>`;
      })
      .join("");
    const axes = STAT_KEYS.map((_, i) => {
      const p = radarPoint(cx, cy, maxR, 100, i);
      return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="oklch(0.4 0.03 262 / ${opacity})" stroke-width="1"/>`;
    }).join("");
    return ringPolys + axes;
  }

  // 個人プロフィール用: 単一ユーザーの能力値レーダーチャート(room.js の radarChartSvg と同じ見た目)
  function radarChartSvg(testResult) {
    const size = 200;
    const cx = size / 2;
    const cy = size / 2 - 4;
    const maxR = 68;
    const grid = radarGridMarkup(cx, cy, maxR, testResult ? 0.35 : 0.22);

    const labels = STAT_KEYS.map((key, i) => {
      const p = radarLabelPos(cx, cy, maxR + 16, i);
      let anchor = "middle";
      if (p.x > cx + 4) anchor = "start";
      else if (p.x < cx - 4) anchor = "end";
      const pct = testResult ? `<tspan x="${p.x.toFixed(1)}" dy="12" class="radar-label-pct">${testResult[key] || 0}%</tspan>` : "";
      return `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" class="radar-label ${testResult ? "" : "radar-label-dim"}">${key}${pct}</text>`;
    }).join("");

    let dataLayer = "";
    if (testResult) {
      const pts = radarPolygonPoints(cx, cy, maxR, testResult);
      const dots = STAT_KEYS.map((key, i) => {
        const p = radarPoint(cx, cy, maxR, testResult[key] || 0, i);
        return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.2" fill="oklch(0.76 0.19 44)"/>`;
      }).join("");
      dataLayer = `<polygon points="${pts}" fill="oklch(0.76 0.19 44 / 0.32)" stroke="oklch(0.78 0.19 44)" stroke-width="2"/>${dots}`;
    }

    return `
      <svg class="radar-chart" viewBox="0 0 ${size} ${size}" role="img" aria-label="能力値レーダーチャート">
        <g>
          ${grid}
          ${dataLayer}
          ${labels}
        </g>
      </svg>`;
  }

  // チームパラメータ用: 各メンバーを淡い輪郭で重ね、チーム平均を塗りつぶしで強調する
  function teamRadarSvg(team, avg) {
    const size = 240;
    const cx = size / 2;
    const cy = size / 2 - 4;
    const maxR = 82;
    const grid = radarGridMarkup(cx, cy, maxR, 0.35);

    const memberLayers = team
      .map((user) => {
        const pts = radarPolygonPoints(cx, cy, maxR, user.testResult);
        return `<polygon points="${pts}" fill="none" stroke="${user.iconColor.value}" stroke-width="1.6" stroke-opacity="0.55"/>`;
      })
      .join("");

    const avgPts = radarPolygonPoints(cx, cy, maxR, avg);
    const avgDots = STAT_KEYS.map((key, i) => {
      const p = radarPoint(cx, cy, maxR, avg[key] || 0, i);
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.6" fill="oklch(0.85 0.1 202)"/>`;
    }).join("");
    const avgLayer = `<polygon points="${avgPts}" fill="oklch(0.76 0.12 202 / 0.32)" stroke="oklch(0.85 0.1 202)" stroke-width="2.6"/>${avgDots}`;

    const labels = STAT_KEYS.map((key, i) => {
      const p = radarLabelPos(cx, cy, maxR + 20, i);
      let anchor = "middle";
      if (p.x > cx + 4) anchor = "start";
      else if (p.x < cx - 4) anchor = "end";
      const roundedAvg = Math.round(avg[key] || 0);
      return `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" class="radar-label"
        >${key}<tspan x="${p.x.toFixed(1)}" dy="13" class="radar-label-pct">${roundedAvg}%</tspan></text>`;
    }).join("");

    return `
      <svg class="radar-chart rf-team-radar-svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="チーム平均能力値レーダーチャート">
        <g>
          ${grid}
          ${memberLayers}
          ${avgLayer}
          ${labels}
        </g>
      </svg>`;
  }

  function radarLegendHtml(team) {
    const members = team
      .map((user) => `<span class="rf-radar-legend-item"><i style="background:${user.iconColor.value}"></i>${escapeHtml(user.name)}</span>`)
      .join("");
    return `${members}<span class="rf-radar-legend-item rf-radar-legend-avg"><i></i>チーム平均</span>`;
  }

  /* ================================================================
     DOM参照
     ================================================================ */
  const el = {};
  function cacheEls() {
    el.screenRanking = document.getElementById("screenRanking");
    el.screenPodium = document.getElementById("screenPodium");
    el.screenFinal = document.getElementById("screenFinal");

    el.rankingRow = document.getElementById("rankingRow");
    el.rankingName = document.getElementById("rankingName");
    el.rankingAvatar = document.getElementById("rankingAvatar");
    el.rankingPlace = document.getElementById("rankingPlace");
    el.rankingFlash = document.getElementById("rankingFlash");

    el.podiumStage = document.getElementById("podiumStage");
    el.confettiLayer = document.getElementById("confettiLayer");
    el.podiumNextBtn = document.getElementById("podiumNextBtn");

    el.sortByNameBtn = document.getElementById("sortByNameBtn");
    el.sortByScoreBtn = document.getElementById("sortByScoreBtn");
    el.rosterGrid = document.getElementById("rosterGrid");
    el.teamRadarWrap = document.getElementById("teamRadarWrap");
    el.radarLegend = document.getElementById("radarLegend");
    el.matchingPercentValue = document.getElementById("matchingPercentValue");

    el.profileOverlay = document.getElementById("profileOverlay");
    el.profileModal = document.getElementById("profileModal");
    el.profileModalContent = document.getElementById("profileModalContent");
    el.profileCloseBtn = document.getElementById("profileCloseBtn");
  }

  function showScreen(target) {
    [el.screenRanking, el.screenPodium, el.screenFinal].forEach((s) => {
      const isActive = s === target;
      s.classList.toggle("is-active", isActive);
      s.setAttribute("aria-hidden", String(!isActive));
    });
    // 画面切り替えを支援技術に伝えるため、新しい画面の見出しへフォーカスを移す
    const heading = target.querySelector("h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }

  /* ================================================================
     画面A: ランキング発表(3位 → 2位 → 1位)
     ================================================================ */
  const PLACE_CLASSES = { 3: "rf-place-bronze", 2: "rf-place-silver", 1: "rf-place-gold" };
  // TEAM が0〜2件のとき、実在しない順位(RANKED[i] が undefined)は
  // 表示対象から除外する。3件以上あれば従来どおり3位→2位→1位の全てを表示する。
  const REVEAL_SEQUENCE = [
    { user: RANKED[2], place: 3 },
    { user: RANKED[1], place: 2 },
    { user: RANKED[0], place: 1 },
  ].filter((step) => Boolean(step.user));

  function renderRankingReveal(user, place) {
    el.rankingName.textContent = user.name;
    el.rankingAvatar.innerHTML = robotSvg(user.iconColor.value);
    el.rankingPlace.textContent = `${place}位`;

    el.rankingRow.className = "rf-ranking-row " + PLACE_CLASSES[place];
    // クラスを一度外して再度付け直すことで、同じアニメーションを毎回リスタートさせる
    el.rankingRow.classList.remove("is-revealing");
    el.rankingFlash.classList.remove("is-flashing");
    void el.rankingRow.offsetWidth;
    el.rankingRow.classList.add("is-revealing");
    el.rankingFlash.classList.add("is-flashing");
  }

  async function runRankingSequence() {
    // TEAM が空の場合 REVEAL_SEQUENCE も空になり、このループは何も表示せず
    // 即座に表彰式画面へ進む(何も無いまま次のステップに自然に進行する)。
    for (let i = 0; i < REVEAL_SEQUENCE.length; i++) {
      const step = REVEAL_SEQUENCE[i];
      renderRankingReveal(step.user, step.place);
      // eslint-disable-next-line no-await-in-loop
      await wait(step.place === 1 ? 1500 : 1000);
    }
    showScreen(el.screenPodium);
    buildPodium();
    buildConfetti();
  }

  /* ================================================================
     画面B: 表彰式
     ================================================================ */
  function podiumColumnHtml(user, place) {
    const colClass = "rf-podium-col-" + place;
    const crown = place === 1 ? `<div class="rf-podium-crown">${crownSvg()}</div>` : "";
    return `
      <div class="rf-podium-col ${colClass}">
        <div class="rf-podium-figure">
          ${crown}
          <div class="rf-podium-avatar">${robotSvg(user.iconColor.value)}</div>
        </div>
        <div class="rf-podium-name">${escapeHtml(user.name)}</div>
        <div class="rf-podium-block">
          <span class="rf-podium-place-num">${place}</span>
        </div>
      </div>`;
  }

  function buildPodium() {
    // 表彰台の見た目の並び: 2位(左) - 1位(中央・最高) - 3位(右)
    // 実在しない順位(user が undefined)は表示しない(TEAM が0〜2件のときのための防御)。
    const order = [
      { user: RANKED[1], place: 2 },
      { user: RANKED[0], place: 1 },
      { user: RANKED[2], place: 3 },
    ].filter((entry) => Boolean(entry.user));
    el.podiumStage.innerHTML = order.map((entry) => podiumColumnHtml(entry.user, entry.place)).join("");
  }

  const CONFETTI_COLORS = [
    "oklch(0.72 0.19 42)",
    "oklch(0.76 0.12 202)",
    "oklch(0.83 0.16 93)",
    "oklch(0.62 0.17 253)",
    "oklch(0.74 0.17 350)",
  ];
  function buildConfetti() {
    let html = "";
    for (let i = 0; i < 40; i++) {
      const left = Math.random() * 100;
      const delay = (Math.random() * 1.4).toFixed(2);
      const duration = (2.4 + Math.random() * 1.6).toFixed(2);
      const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      const size = 6 + Math.round(Math.random() * 6);
      const spin = Math.random() > 0.5 ? "rfConfettiSpin" : "rfConfettiSpinReverse";
      html += `<span class="rf-confetti-piece" style="left:${left}%; animation-delay:${delay}s; animation-duration:${duration}s, ${duration}s; background:${color}; width:${size}px; height:${(size * 1.4).toFixed(0)}px; --spin:${spin};"></span>`;
    }
    el.confettiLayer.innerHTML = html;
  }

  /* ================================================================
     画面C: 最終リザルト
     ================================================================ */
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  let rosterOrder = shuffle(TEAM.slice());
  let currentSort = null; // null(初期のランダム表示) | "name" | "score"
  let finalScreenBuilt = false;

  function rosterCardHtml(user) {
    return `<button type="button" class="rf-roster-card" data-user-id="${user.id}" aria-label="${escapeHtml(user.name)}のプロフィールを見る" aria-haspopup="dialog" aria-controls="profileModal">
      <span class="rf-roster-avatar">${robotSvg(user.iconColor.value)}</span>
      <span class="rf-roster-name">${escapeHtml(user.name)}</span>
      <span class="rf-roster-score">${user.score}<small>点</small></span>
    </button>`;
  }

  // FLIP法で並び替え時に自然な移動アニメーションを付ける(prefers-reduced-motion では即座に並び替える)
  function renderRoster(animate) {
    const shouldAnimate = animate && !REDUCED_MOTION;
    const prevCards = shouldAnimate ? Array.from(el.rosterGrid.children) : [];
    const firstRects = new Map();
    prevCards.forEach((card) => firstRects.set(card.dataset.userId, card.getBoundingClientRect()));

    el.rosterGrid.innerHTML = rosterOrder.map(rosterCardHtml).join("");

    if (!shouldAnimate) return;
    Array.from(el.rosterGrid.children).forEach((card) => {
      const first = firstRects.get(card.dataset.userId);
      if (!first) return;
      const last = card.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (!dx && !dy) return;
      card.style.transition = "none";
      card.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        card.style.transition = "transform 0.38s cubic-bezier(0.22, 0.9, 0.32, 1)";
        card.style.transform = "";
        card.addEventListener("transitionend", () => { card.style.transition = ""; }, { once: true });
      });
    });
  }

  function updateSortButtons() {
    const isName = currentSort === "name";
    const isScore = currentSort === "score";
    el.sortByNameBtn.classList.toggle("is-active", isName);
    el.sortByNameBtn.setAttribute("aria-pressed", String(isName));
    el.sortByScoreBtn.classList.toggle("is-active", isScore);
    el.sortByScoreBtn.setAttribute("aria-pressed", String(isScore));
  }

  function animateMatchingPercent(target) {
    if (REDUCED_MOTION) {
      el.matchingPercentValue.textContent = target;
      return;
    }
    const duration = 900;
    const startTime = performance.now();
    function step(now) {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.matchingPercentValue.textContent = Math.round(target * eased);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function buildFinalScreen() {
    if (finalScreenBuilt) return;
    finalScreenBuilt = true;
    renderRoster(false);
    el.teamRadarWrap.innerHTML = teamRadarSvg(TEAM, TEAM_AVERAGE_ROUNDED);
    el.radarLegend.innerHTML = radarLegendHtml(TEAM);
    animateMatchingPercent(MATCHING_PERCENT);
  }

  /* ---------------- プロフィールモーダル(room.html の意匠を踏襲) ---------------- */
  let profileOpen = false;
  let profileTriggerEl = null;

  function profileMarkup(user) {
    const textColor = user.iconColor.light ? "oklch(0.2 0.03 262)" : "white";
    const initial = escapeHtml(getInitial(user.name));
    const roleLabel = getTopRoleLabel(user.testResult);
    return `<div class="profile-card rf-profile-card">
      <div class="profile-col profile-col-left">
        <div class="profile-top">
          <div class="profile-icon" style="background:${user.iconColor.value};color:${textColor}">${initial}</div>
          <div class="profile-name" id="profileModalName">${escapeHtml(user.name)}</div>
          <div class="profile-score-badge">${user.score}点</div>
        </div>
        <div class="profile-role-tag ${roleLabel ? "" : "profile-role-tag-empty"}">${roleLabel ? escapeHtml(roleLabel) : "測定中"}</div>
        <button type="button" class="profile-bot-btn" aria-label="${escapeHtml(user.name)}のアバターを回転させる">
          ${robotSvg(user.iconColor.value)}
        </button>
      </div>
      <div class="profile-col profile-col-right">${radarChartSvg(user.testResult)}</div>
    </div>`;
  }

  function openProfile(userId, triggerEl) {
    const user = TEAM.find((u) => u.id === userId);
    if (!user || profileOpen) return;
    profileOpen = true;
    profileTriggerEl = triggerEl || document.activeElement;
    el.profileModalContent.innerHTML = profileMarkup(user);
    el.profileOverlay.hidden = false;
    el.profileModal.hidden = false;
    requestAnimationFrame(() => {
      el.profileOverlay.classList.add("is-visible");
      el.profileModal.classList.add("is-open");
    });
    el.profileCloseBtn.focus({ preventScroll: true });
    document.addEventListener("keydown", onProfileKeydown);
  }

  function closeProfile() {
    if (!profileOpen) return;
    profileOpen = false;
    el.profileOverlay.classList.remove("is-visible");
    el.profileModal.classList.remove("is-open");
    document.removeEventListener("keydown", onProfileKeydown);
    if (profileTriggerEl) profileTriggerEl.focus({ preventScroll: true });
    profileTriggerEl = null;
    setTimeout(() => {
      if (!profileOpen) {
        el.profileOverlay.hidden = true;
        el.profileModal.hidden = true;
      }
    }, 260);
  }

  function onProfileKeydown(e) {
    if (e.key === "Escape") closeProfile();
  }

  /* ================================================================
     イベント配線
     ================================================================ */
  function initEvents() {
    el.podiumNextBtn.addEventListener("click", () => {
      showScreen(el.screenFinal);
      buildFinalScreen();
    });

    el.sortByNameBtn.addEventListener("click", () => {
      currentSort = "name";
      rosterOrder = TEAM.slice().sort((a, b) => a.name.localeCompare(b.name, "ja"));
      updateSortButtons();
      renderRoster(true);
    });
    el.sortByScoreBtn.addEventListener("click", () => {
      currentSort = "score";
      rosterOrder = TEAM.slice().sort((a, b) => b.score - a.score);
      updateSortButtons();
      renderRoster(true);
    });

    el.rosterGrid.addEventListener("click", (e) => {
      const card = e.target.closest(".rf-roster-card");
      if (!card) return;
      openProfile(card.dataset.userId, card);
    });

    el.profileOverlay.addEventListener("click", closeProfile);
    el.profileCloseBtn.addEventListener("click", closeProfile);

    // プロフィールモーダル内のアバターをタップで一回転させる(room.js の profile-bot-btn と同じ挙動)
    el.profileModalContent.addEventListener("click", (e) => {
      const botBtn = e.target.closest(".profile-bot-btn");
      if (!botBtn) return;
      botBtn.classList.remove("is-spinning");
      void botBtn.offsetWidth;
      botBtn.classList.add("is-spinning");
    });
    el.profileModalContent.addEventListener("animationend", (e) => {
      const botBtn = e.target.closest(".profile-bot-btn");
      if (botBtn) botBtn.classList.remove("is-spinning");
    });
  }

  function init() {
    cacheEls();
    initEvents();
    runRankingSequence();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
