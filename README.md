# Engifar

初対面のチームがお互いのWeb開発理解度を知るための、リアルタイムクイズアプリです。
現在はDeno 2 + Deno Deploy + PostgreSQLを前提に、バックエンドの土台を実装しています。

## バックエンドの現在地

- PostgreSQLの5テーブル（`room`、`participant`、`game_session`、
  `session_participant`、`answer`）
- 部屋作成、部屋参加、ロビー情報取得
- ルーム画面からの実ルーム作成・招待コード参加・参加者一覧同期
- ホストによるゲーム開始、次の問題開始、ゲーム終了
- ホスト開始時の全参加者のクイズ遷移と、ルーム進行に同期した出題・回答保存
- WebSocketによる参加・退出・問題進行の即時通知と画面遷移時の再接続
- 完了後の個人・チームスコアのサーバー集計と共有結果表示
- 参加者による回答登録と、制限時間内の回答変更
- DB接続を含むヘルスチェック
- 問題取得・制限時間後のサーバー採点を行うクイズAPI
- API単体テストとDBスキーマの契約テスト

## ローカル起動

必要なものはDeno 2とPostgreSQLです。

1. PostgreSQLを起動し、アプリ専用DBを作成します。

```powershell
psql -U postgres -c "CREATE DATABASE engifar;"
```

2. `.env.example`を`.env`へコピーし、ローカルPostgreSQLのユーザー名・パスワード・
   ポートに合わせて`DATABASE_URL`を編集します。`QUIZ_TOKEN_SECRET`には32バイト以上の
   ランダムな文字列を設定します。`.env`はGitの管理対象外です。

```powershell
Copy-Item .env.example .env
```

3. マイグレーションを適用してから開発サーバーを起動します。サーバー起動時にも
   未適用マイグレーションは自動適用されます。

```powershell
deno task --env-file=.env db:migrate
deno task --env-file=.env dev
```

確認用URLは `http://localhost:8000/api/health` です。

## 開発コマンド

```shell
deno task check
deno task test
deno task lint
deno task fmt:check
```

## API

JSONレスポンスは成功時に `{ "data": ... }`、失敗時に
`{ "error": { "code": "...", "message": "..." } }` の形で返します。

| Method | Path | 用途 | 認証 |
| --- | --- | --- | --- |
| `GET` | `/api/health` | サーバー・DB確認 | なし |
| `GET` | `/api/quiz/config` | 問題数・制限時間を取得 | なし |
| `POST` | `/api/quiz/attempts` | 受験用の署名付きトークンを発行 | なし |
| `POST` | `/api/quiz/questions/:index/start` | 問題を取得（正解・解説は含まない） | 受験トークン |
| `POST` | `/api/quiz/questions/:index/grade` | 制限時間後に採点・解説を取得 | 問題トークン |
| `POST` | `/api/rooms` | 部屋とホストを作成 | なし |
| `POST` | `/api/rooms/:code/participants` | 部屋へ参加 | なし |
| `PUT` | `/api/rooms/:code/participants/visibility` | 自分のプロフィール公開・非公開を切り替える | 参加者 |
| `GET` | `/api/rooms/:code` | 部屋と参加者一覧を取得 | 参加者 |
| `POST` | `/api/rooms/:code/sessions` | クイズ設定に沿ったゲームを開始 | ホスト |
| `GET` | `/api/sessions/:id` | 参加中セッションの進行状況を取得 | 参加者 |
| `GET` | `/api/sessions/:id/results` | 完了した個人・チーム・ランキング結果を取得 | 参加者 |
| `POST` | `/api/sessions/:id/quiz/questions/:index/start` | ルームの進行時刻に同期して問題を取得 | 参加者 |
| `POST` | `/api/sessions/:id/questions/:index/start` | 次の問題を開始 | ホスト |
| `PUT` | `/api/sessions/:id/answers/:index` | 回答を登録・変更 | 参加者 |
| `POST` | `/api/sessions/:id/complete` | ゲームを終了 | ホスト |

`/ws?roomCode=<code>`へ`["engifar-v1", "<accessToken>"]`をWebSocketサブプロトコルとして
指定して接続すると、参加・退出・問題開始・終了を
リアルタイムで受信できます。画面遷移中の短い切断は再接続猶予内なら退出扱いになりません。

部屋作成・参加レスポンスの `accessToken` を、以降のリクエストで
`Authorization: Bearer <accessToken>` として送ります。DBにはトークン本体ではなくSHA-256ハッシュだけを保存します。

クイズ問題と正解は`data/quiz_questions.json`でバックエンドだけが管理します。起動時に問題ID、
4択、正解番号などを検証します。問題開始時のレスポンスには正解を含めず、
HMAC署名された問題トークンを使って、回答時間が終了した後にだけ採点結果と解説を返します。
トークンは問題順も検証するため、後続問題へ直接スキップできません。

通常の問題進行はWebSocketで通知し、クイズ画面は10秒、ロビー画面は15秒間隔の取得を
通知取りこぼし時の復旧用に使います。Deno Deployのインスタンス終了で進行タイマーが失われても、
セッション取得時にDBの問題開始時刻から2秒を超える遅延を検出し、進行状態を自己修復します。

### 部屋作成例

```shell
curl -X POST http://localhost:8000/api/rooms \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Alice"}'
```

### 回答例

選択肢番号は `0` から `3` です。同じ問題への回答は15秒以内なら上書きされます。

```shell
curl -X PUT http://localhost:8000/api/sessions/<session-id>/answers/0 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access-token>" \
  -d '{"selectedOption":2}'
```

## Deno Deploy

Deno Deploy側で作成済みPostgreSQLをEngifarアプリへ割り当てると、環境ごとの
`DATABASE_URL` と `PG*` が自動注入されます。接続情報をGitへコミットする必要はありません。
`QUIZ_TOKEN_SECRET`は自動注入されないため、32バイト以上の固定値を環境変数へ設定してください。
この値は選択肢順と既存回答の採点にも使うため、実施中・保存済みセッションがある状態で変更しないでください。

デプロイのエントリポイントは `src/server.ts` です。サーバー起動時に `migrations/` の連番SQLが
バージョン順に自動適用されます。適用履歴とチェックサムは `schema_migrations` へ保存され、
同時起動時はPostgreSQLのアドバイザリーロックで直列化されます。
手動適用が必要な場合は、対象環境の接続URLを設定して `deno task db:migrate` を実行できます。

Gitブランチ・プレビュー環境には本番とは別の論理DBが割り当てられるため、
ブランチ環境にも同じマイグレーションを適用します。

## 今回置いた暫定ルール

仕様書で未決定の項目は、変更しやすい初期値として次のように扱っています。

- 内部IDはPostgreSQLのUUID
- 部屋コードは紛らわしい文字を除いた6文字（DBは6〜8文字を許容）
- 同名ユーザーは許可
- 部屋を作成した参加者をホストとする
- ゲーム開始後の途中参加は不許可
- デモは24問、各問題10秒（答え合わせ5秒）
- 問題本文と正解はDBへ保存せず、サーバー専用JSONで管理

最終スコアはブラウザの保存値を信用せず、DBへ保存された回答からサーバーが再計算します。
安全性は6分野の平均点から分野間の標準偏差の半分を引き、得意分野への偏りを反映します。

参加トークンはタブ単位の`sessionStorage`へ保存し、URLやDBへ平文で残しません。
採点の難易度補正はまだ確定していません。
emoji prefix にはコミット履歴が可愛くなる他にもメリットがありますが、コミット履歴が可愛くなるのが好きで使ってます。

## ブランチ保護の確認

この文書更新は、`main` ブランチのプルリクエスト要件と承認ルールが有効であることを確認するためのものです。
