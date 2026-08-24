# Engifar

初対面のチームがお互いのWeb開発理解度を知るための、リアルタイムクイズアプリです。
現在はDeno 2 + Deno Deploy + PostgreSQLを前提に、バックエンドの土台を実装しています。

## バックエンドの現在地

- PostgreSQLの5テーブル（`room`、`participant`、`game_session`、
  `session_participant`、`answer`）
- 部屋作成、部屋参加、ロビー情報取得
- ホストによるゲーム開始、次の問題開始、ゲーム終了
- 参加者による回答登録と、制限時間内の回答変更
- DB接続を含むヘルスチェック
- API単体テストとDBスキーマの契約テスト

リアルタイム配信、問題データ、採点、切断処理、結果APIは次の実装範囲です。

## ローカル起動

必要なものはDeno 2とPostgreSQLです。

1. `.env.example` を参考に、ローカル用の `DATABASE_URL` を環境変数へ設定します。
2. 開発サーバーを起動します。未適用のDBマイグレーションは起動時に自動適用されます。

```shell
deno task dev
```

`.env` を使う場合は、Denoのタスク実行時に読み込めます。

```shell
deno task --env-file=.env dev
```

確認用URLは `http://localhost:8000/api/health` です。

## 開発コマンド

```shell
deno task check
deno task test
deno task test:db
deno task lint
deno task fmt:check
```

`test:db` は `TEST_DATABASE_URL` で指定したPostgreSQL内にテスト専用スキーマを作成して、
Repository・トランザクション・制約を実際に検証します。各テストの終了時に専用スキーマだけを削除します。
`.env` を使う場合は `deno task --env-file=.env test:db` で実行できます。

## API

JSONレスポンスは成功時に `{ "data": ... }`、失敗時に
`{ "error": { "code": "...", "message": "..." } }` の形で返します。

| Method | Path | 用途 | 認証 |
| --- | --- | --- | --- |
| `GET` | `/api/health` | サーバー・DB確認 | なし |
| `POST` | `/api/rooms` | 部屋とホストを作成 | なし |
| `POST` | `/api/rooms/:code/participants` | 部屋へ参加 | なし |
| `GET` | `/api/rooms/:code` | 部屋と参加者一覧を取得 | なし |
| `POST` | `/api/rooms/:code/sessions` | 12問のゲームを開始 | ホスト |
| `POST` | `/api/sessions/:id/questions/:index/start` | 次の問題を開始 | ホスト |
| `PUT` | `/api/sessions/:id/answers/:index` | 回答を登録・変更 | 参加者 |
| `POST` | `/api/sessions/:id/complete` | ゲームを終了 | ホスト |

部屋作成・参加レスポンスの `accessToken` を、以降のリクエストで
`Authorization: Bearer <accessToken>` として送ります。DBにはトークン本体ではなくSHA-256ハッシュだけを保存します。

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
- デモは12問、各問題15秒
- 問題本文と正解はDBへ保存せず、アプリケーション内で管理

ブラウザ再読み込み後のトークン復元方法、WebSocket/SSEの選択、切断判定、採点の難易度補正は
まだ確定していません。
