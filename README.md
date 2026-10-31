# 王子の手動スキ候補収集

スキは本人がnoteで押します。**自動スキのActionsジョブは削除しました。**

対象者を探すロジックと画面は [王子Comment Reader](https://github.com/neronote100/nero_comment_reader) に統合しました。このリポジトリは登録済みの認証を使って、Comment Readerの収集処理を実行します。新しいSecretやCloudflareの設定は不要です。

## 使い方

1. [Comment Readerの「♡ スキ候補」](https://neronote100.github.io/nero_comment_reader/#like-candidates)を開きます。
2. 最大30人の候補から記事を開き、note上で手動でスキします。
3. 確認した記事には画面で「確認済み」を付けられます。この記録はブラウザ内に保存され、noteのスキ状態とは同期しません。
4. 新しく探す場合は [Actions → Collect manual note candidates](https://github.com/neronote100/Prince_like_giver/actions/workflows/candidates.yml) の Run workflow を実行し、完了後に画面の「最新候補を表示」を押します。

毎時17分ごろにも候補を更新します。GitHub側の混雑で遅れる場合があります。収集はnoteへのGETのみで、スキ・フォロー・コメントの送信処理は呼びません。

## 候補の条件

- 王子（nero_notelover）からフォローしておらず、相手からもフォローされていない
- フォロー数がフォロワー数の1.15倍以上で、10人以上多い
- 取得できた記事一覧の直近30日分に記事があり、その中に王子のスキ済み記事がない
- 条件・スキ状態を確認できた人の最新記事を1件選ぶ
- 最大450人から30人を目標に探す。条件は緩めず、不足した場合は実際の人数と取得状況を表示する

## 認証と公開データ

登録済みの Actions Secret NOTE_SESSION_COOKIE を収集ステップだけに渡します。Cookieをチャットやコードへ貼る必要はありません。値はログ・候補データへ出力しません。

公開候補は manual-candidates ブランチの data/like-candidates.json に保存されます。候補者名・公開記事URL・フォロー数などを含み、Comment Readerが読み込みます。認証制限、取得失敗による空結果、公開処理の失敗時は前回の一覧を保持します。

## 停止

Settings → Secrets and variables → Actions → Variables で DISABLE_CANDIDATE_DISCOVERY=true を設定すると収集を停止します。自動スキのジョブは存在しません。

収集と画面の実装・テストはComment Reader側で管理します。旧自動スキ関連のソースは履歴との互換性のため残っていますが、現在のworkflowからは実行しません。
