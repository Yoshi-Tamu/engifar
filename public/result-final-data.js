/* ============================================================
   ENGIFAR - 集計結果 データアダプタ
   result-final.js より前に読み込むことで、localStorage に蓄積された
   実プレイ結果のリーダーボード(engifar-leaderboard-v1)を
   window.RESULT_DATA として公開する。
   rocket-launch-results.js が window.ROCKET_LAUNCH_RESULTS を
   同じ「消費側スクリプトの前に window.X = {...} を用意する」方式で
   公開しているのに合わせたパターン。
   ============================================================ */
(function () {
  "use strict";

  // script.js 側の LEADERBOARD_KEY と同じ文字列であること。
  var LEADERBOARD_KEY = "engifar-leaderboard-v1";

  function readLeaderboard() {
    try {
      var raw = window.localStorage.getItem(LEADERBOARD_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  window.RESULT_DATA = { members: readLeaderboard() };
})();
