# template-deno-dev

[Deno](https://deno.land/)を使った開発のテンプレートです。  
[Deno Deploy](https://deno.com/deploy)を利用して外部へ公開することを想定しています。  

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

## ブランチ保護の確認

この文書更新は、`main` ブランチのプルリクエスト要件と承認ルールが有効であることを確認するためのものです。

