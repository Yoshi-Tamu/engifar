# engifar

ハッカソン用Webアプリのリポジトリです。知らないエンジニア同士がチームを組み、Web/LINE Bot/Modeling/Gameなどの技術問題を解き、チームの回答バランスに応じて「ロケット」を飛ばして得意・不得意を可視化します。

## 技術スタック

| 領域 | 技術 |
|---|---|
| フロントエンド | HTML / CSS / JavaScript |
| バックエンド言語 | TypeScript(Deno) |
| ランタイム/デプロイ | Deno, Deno Deploy |
| DB(永続データ) | PostgreSQL |
| 状態管理(進行中データ) | Deno KV |
| リアルタイム通信 | WebSocket(`Deno.upgradeWebSocket`) |
| テスト | `deno test` |

## バックエンドの開発環境

### 必要なもの
- Deno(`deno --version`で確認できます)
- VS Code + Deno拡張機能(`denoland.vscode-deno`)を推奨

### 開発サーバーの起動
```shell
deno task dev
```
`http://localhost:8000` で起動します。`/ws` にWebSocket接続すると、送った文字列がそのまま `echo: 〜` として返ってくる、動作確認用の最小構成です。

### テストの実行
```shell
deno task test
```

## ディレクトリ構成(バックエンド)
```
backend/
  api/    # RESTエンドポイント(部屋作成/参加、分野選択、解答送信) — 未実装
  ws/     # WebSocket接続管理・ブロードキャスト・ハートビート — 未実装
  kv/     # Deno KVを使った部屋状態(room_state)の読み書き
  shared/ # 共有の型定義(WsEvent, RoomStateなど)
main.ts   # エントリーポイント(疎通確認用の最小WebSocketサーバー)
```

## バックエンド(リアルタイム・API担当)の実装ステップ

1. ✅ Deno KVの部屋状態ラッパー(`backend/kv/roomState.ts`)
2. ⬜ REST APIで部屋の作成・参加
3. ⬜ WebSocketの接続管理(複数接続の管理)
4. ⬜ API × WebSocketの連携
5. ⬜ 分野選択API(ホスト権限チェック付き)
6. ⬜ 解答完了判定とロケット発射トリガー
7. ⬜ デプロイ・CI整備
8. ⬜ 異常系対応(離脱検知など)

---

## Deno Deploy の利用方法

↓以上の詳細は公式リファレンスへ。

1. [Deno Deploy](https://deno.com/deploy)にアクセスして、右上の「Sign In」からGitHubアカウントでのOAuthログインでアカウントを作成orログインしてください。
2. 青い「+ New Project」から「Create a project」画面に遷移して、「Deploy an existing GitHub repository」側から GitHub repository の「Select a repository」をクリック
3. Create a project from GitHub の画面で、デプロイするリポジトリを選んでこのリポジトリをテンプレートにした場合は「No build step」で、メインのDenoのコードが書いてあるファイルをエントリポイントに指定して「Create & Deploy」します。
4. ダイアログが出て Deployed になれば成功。右上の青い「View」からデプロイされたページが確認できるはずです。

## コミットテンプレートとemoji prefixについて

コミットテンプレートは以下のようにして使用できます。

```shell
cd <リポジトリ直下>
git config commit.template ./.commit_template
```

emoji prefix にはコミット履歴が可愛くなる他にもメリットがありますが、コミット履歴が可愛くなるのが好きで使ってます。
