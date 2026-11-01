# 王子のスキ候補収集

[王子Comment Readerの「♡ スキ候補」](https://neronote100.github.io/nero_comment_reader/#like-candidates)へ統合しました。

- 最大30人の候補をまとめて表示し、公開済み一覧を自動で読み直します。
- 「王子のGitHubで接続」で本人確認すると、画面内の「候補を30人探す」で新しく抽出できます。
- 「♡ スキを届ける」を本人が押した記事1件にだけ送信します。
- 未確定の送信結果は再送せず、GETで確認します。
- 無人の自動スキのジョブは削除済みです。

## このリポジトリの役割

登録済みのActions Secret NOTE_SESSION_COOKIEを使い、Comment Readerの固定コミットの収集処理を毎時17分ごろに実行します。GitHub側の混雑で遅れる場合があります。

本人のmainワークフローが発行する短期OIDCを既存のCloudflareサーバーで検証し、note本人アカウントを確認してからセッションを暗号化して引き継ぎます。Cookieを公開ファイルやブラウザへ渡しません。新しいSecretやGitHubの追加権限への同意は不要です。

定期収集はnoteへのGETだけです。スキはサイトで本人が押した時だけ送信し、Actionsはスキを送信しません。

公開候補はmanual-candidatesブランチのdata/like-candidates.jsonへ保存します。候補の名前・公開記事URL・フォロー数などを含みます。認証情報は含みません。

## 候補の条件

王子自身を除き、フォロー・被フォローの関係がなく、フォロー数がフォロワー数の1.15倍以上かつ10人以上多い人を対象にします。取得した記事一覧の直近30日分に投稿があり、その中に王子のスキ済み記事がないことを確認し、最新記事を1件選びます。不明な状態は除外します。

最大450人から30人を目標に探し、不足した時は条件を緩めず実際の人数を表示します。

## 補助の実行と停止

通常はComment Reader内で操作できます。接続の問題がある時だけ、[Actionsの収集画面](https://github.com/neronote100/Prince_like_giver/actions/workflows/candidates.yml)のRun workflowを使えます。

DISABLE_CANDIDATE_DISCOVERY=trueのRepository variableで定期収集と認証同期を停止します。サイト側の接続は「接続を解除」で解除できます。

実装とテストはComment Reader側と既存Cloudflareサーバー側で管理します。旧自動スキ関連のソースは現在のworkflowから実行しません。
