/* ============================================================
   ENGIFAR - テスト開始前ロード画面
   役割: 円卓会議シーンの6体のアバターをすべて同じ関数から生成し、
   「全員が対等」であることを構造的に保証する。ロード文字の波
   アニメーション用の文字分割と、簡易な公開APIの提供も行う。
   見た目の色・タイミングは loading.css、円卓や机上の物は
   loading.html 側の責務とし、このファイルは「状態と挙動」だけを
   扱う。
   ============================================================ */

(function () {
  "use strict";

  const DEFAULT_TEXT = "会議中…";

  /* ----------------------------------------------------------
     6人のアバター設定
     全員: 同じ円(半径)上に60度間隔で並び、同じ生成関数 renderMeetingBot
     を通るため、体格・パーツの描き方は完全に同一。差があるのは
     位置・向き・色・手にしている道具(=行動)だけ。
     奥(上半分)の3人と手前(下半分)の3人でわずかに縮尺を変えて
     円卓の奥行きを表現しているが、これは「奥/手前」という円卓上の
     位置の違いであり、特定の1人だけを大きく/重要に見せるものではない。
     ---------------------------------------------------------- */
  const MEETING_BOTS = [
    { id: "top",    color: "oklch(0.58 0.19 312)", x: 320, y: 132, scale: 0.80, rotate: -4,  action: "blueprint", delay: 0 },
    { id: "ur",     color: "oklch(0.83 0.16 93)",  x: 524, y: 221, scale: 0.80, rotate: -10, action: "tablet",    delay: 0.7 },
    { id: "lr",     color: "oklch(0.62 0.16 148)", x: 524, y: 399, scale: 0.94, rotate: -9,  action: "notepad",   delay: 1.4 },
    { id: "bottom", color: "oklch(0.62 0.17 253)", x: 320, y: 488, scale: 0.94, rotate: -12, action: "talkB",     delay: 2.1 },
    { id: "ll",     color: "oklch(0.62 0.20 24)",  x: 116, y: 399, scale: 0.94, rotate: 14,  action: "talkA",     delay: 0.35 },
    { id: "ul",     color: "oklch(0.74 0.17 350)", x: 116, y: 221, scale: 0.80, rotate: 10,  action: "nod",       delay: 1.05 },
  ];

  /* 全員に共通する土台(体・顔・アンテナ・影)。ここを1関数にまとめる
     ことで、全アバターが同じ大きさ・同じパーツで描かれることを保証する。 */
  function botBase(color) {
    return `
      <ellipse cx="50" cy="118" rx="24" ry="7" fill="${color}" opacity="0.3"/>
      <line x1="50" y1="10" x2="50" y2="24" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
      <circle cx="50" cy="8" r="6" fill="oklch(0.85 0.1 202)"/>
      <rect x="20" y="22" width="60" height="76" rx="30" fill="${color}" stroke="oklch(0.2 0.02 260 / 0.25)" stroke-width="2"/>
      <rect x="32" y="42" width="36" height="26" rx="12" fill="oklch(0.97 0.006 260)"/>
      <circle cx="43" cy="55" r="4" fill="oklch(0.22 0.03 262)"/>
      <circle cx="57" cy="55" r="4" fill="oklch(0.22 0.03 262)"/>
    `;
  }

  /* 行動ごとの手元の道具。どれも「机の上のものを見る/扱う」だけで、
     他のアバターに向かって指を差したり、命令したりする表現は使わない。 */
  const ACTION_PROPS = {
    // 設計図を見る: 手前に垂れた手の先が図面をなぞるように光る
    blueprint(color) {
      return `
        <g class="meeting-bot-arm">
          <path d="M22 62 Q6 78 4 96" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round"/>
          <circle class="meeting-point-glow" cx="4" cy="96" r="4" fill="oklch(0.85 0.15 93)"/>
        </g>`;
    },
    // タブレットを見る: 画面が淡く光るタブレットを両手ほどの高さで持つ
    tablet(color) {
      return `
        <g class="meeting-bot-arm">
          <path d="M78 58 Q92 62 96 74" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round"/>
          <rect class="meeting-tablet-screen-glow" x="90" y="66" width="26" height="34" rx="5" fill="oklch(0.2 0.03 264)" stroke="oklch(0.85 0.1 202)" stroke-width="1.5" transform="rotate(8 103 83)"/>
          <line x1="96" y1="76" x2="110" y2="76" stroke="oklch(0.76 0.12 202)" stroke-width="2" stroke-linecap="round" transform="rotate(8 103 83)"/>
          <line x1="96" y1="84" x2="106" y2="84" stroke="oklch(0.76 0.12 202)" stroke-width="2" stroke-linecap="round" transform="rotate(8 103 83)"/>
        </g>`;
    },
    // メモを取る: 小さなメモ帳に向けて手元がわずかに揺れる
    notepad(color) {
      return `
        <g class="meeting-bot-arm">
          <path d="M78 60 Q90 66 92 78" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round"/>
          <g class="meeting-notepad-wiggle">
            <rect x="84" y="70" width="20" height="26" rx="3" fill="oklch(0.95 0.01 258)" stroke="oklch(0.6 0.02 260)" stroke-width="1.2"/>
            <line x1="88" y1="78" x2="100" y2="78" stroke="oklch(0.6 0.02 260)" stroke-width="1.4"/>
            <line x1="88" y1="84" x2="98" y2="84" stroke="oklch(0.6 0.02 260)" stroke-width="1.4"/>
            <line x1="88" y1="90" x2="96" y2="90" stroke="oklch(0.6 0.02 260)" stroke-width="1.4"/>
          </g>
        </g>`;
    },
    // 話す(右側の相手): 手のひらを軽く開いて示す + 吹き出しの点
    talkA(color, delay) {
      const d = delay || 0;
      return `
        <g class="meeting-bot-arm">
          <path d="M78 56 Q94 50 98 36" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round"/>
          <rect x="90" y="24" width="18" height="14" rx="7" fill="${color}" stroke="oklch(0.2 0.02 260 / 0.25)" stroke-width="1.5"/>
        </g>
        <g class="meeting-speech">
          <circle class="speech-dot" cx="86" cy="14" r="3.4" fill="oklch(0.95 0.01 258)" style="animation-delay:${(d + 0).toFixed(2)}s"/>
          <circle class="speech-dot" cx="96" cy="8" r="2.6" fill="oklch(0.95 0.01 258)" style="animation-delay:${(d + 0.18).toFixed(2)}s"/>
          <circle class="speech-dot" cx="104" cy="4" r="2" fill="oklch(0.95 0.01 258)" style="animation-delay:${(d + 0.36).toFixed(2)}s"/>
        </g>`;
    },
    // 話す(左側の相手として応じる): 半サイクルずらして交互に会話しているように見せる
    talkB(color, delay) {
      const d = (delay || 0) + 1.3;
      return `
        <g class="meeting-bot-arm">
          <path d="M22 56 Q6 50 2 36" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round"/>
          <rect x="-8" y="24" width="18" height="14" rx="7" fill="${color}" stroke="oklch(0.2 0.02 260 / 0.25)" stroke-width="1.5"/>
        </g>
        <g class="meeting-speech">
          <circle class="speech-dot" cx="14" cy="14" r="3.4" fill="oklch(0.95 0.01 258)" style="animation-delay:${(d + 0).toFixed(2)}s"/>
          <circle class="speech-dot" cx="4" cy="8" r="2.6" fill="oklch(0.95 0.01 258)" style="animation-delay:${(d + 0.18).toFixed(2)}s"/>
          <circle class="speech-dot" cx="-4" cy="4" r="2" fill="oklch(0.95 0.01 258)" style="animation-delay:${(d + 0.36).toFixed(2)}s"/>
        </g>`;
    },
    // うなずく: 手を頬のあたりに添えて、体ごとゆっくり相槌を打つ(回転は meeting-bot-nod 側で付与)
    nod(color) {
      return `
        <g class="meeting-bot-arm">
          <path d="M78 58 Q88 66 82 76" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round"/>
          <circle cx="80" cy="78" r="6.5" fill="${color}" stroke="oklch(0.2 0.02 260 / 0.35)" stroke-width="1.5"/>
        </g>`;
    },
  };

  function renderMeetingBot(cfg) {
    const propMarkup = ACTION_PROPS[cfg.action] ? ACTION_PROPS[cfg.action](cfg.color, cfg.delay) : "";
    const nodClass = cfg.action === "nod" ? " meeting-bot-nod" : "";
    return `
      <g transform="translate(${cfg.x},${cfg.y}) rotate(${cfg.rotate}) scale(${cfg.scale}) translate(-50,-125)">
        <g class="meeting-bot${nodClass}" style="--bob-delay:${cfg.delay}s">
          ${botBase(cfg.color)}
          ${propMarkup}
        </g>
      </g>`;
  }

  /* ---------------- ロードテキストの波アニメーション ---------------- */
  // 1文字ずつ span で包み、--i に文字の順番を入れておくと
  // loading.css 側の `animation-delay: calc(var(--i) * 90ms)` で
  // 左から右へ波が伝わるように見える。
  function renderWaveText(text) {
    el.loadingText.innerHTML = "";
    const chars = Array.from(text);
    chars.forEach((ch, i) => {
      const span = document.createElement("span");
      span.className = "wave-char";
      span.style.setProperty("--i", i);
      span.textContent = ch === " " ? " " : ch;
      el.loadingText.appendChild(span);
    });
  }

  const el = {
    loadingText: null,
    meetingBots: null,
  };

  function setText(text) {
    renderWaveText(text || DEFAULT_TEXT);
  }

  /* ---------------- 実際のテスト開始処理との接続点 ----------------
     例: サーバーからの準備完了通知を受け取ったら、
         EngifarLoading.hide() を呼んでこの画面を閉じ、次の画面に進む。
         (このファイル単体ではロード画面の表示のみを担当し、
          「いつ閉じるか」は呼び出し側の実装に委ねる) */
  function hide() {
    document.body.classList.add("is-loading-done");
    document.dispatchEvent(new CustomEvent("engifar:loading-hidden"));
  }

  function init() {
    el.loadingText = document.getElementById("loadingText");
    el.meetingBots = document.getElementById("meetingBots");

    el.meetingBots.innerHTML = MEETING_BOTS.map(renderMeetingBot).join("");
    renderWaveText(DEFAULT_TEXT);
  }

  document.addEventListener("DOMContentLoaded", init);

  window.EngifarLoading = {
    setText,
    hide,
  };
})();
