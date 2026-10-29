# Prince Like Giver 🌙

王子（note ID: `nero_notelover`）の候補記事を読み取り専用で調査するツールです。

## できること

- GitHub Actionsの `NOTE_SESSION_COOKIE` でログイン済みのnote情報を**読み取る**
- 候補者のフォロー数／フォロワー数・フォロー関係・最近30日の投稿を確認
- **フォロー数がフォロワー数より15%以上多い**（既存の最低10人差も維持）場合だけ採用
- `isLiked=true` の最近の記事がある人を**候補から除外**
- 不確かなフォロー関係・スキ状態は採用せず、読取結果を安全側で判定
- 候補15件までのレビュー画面 `candidate-review.html` を生成
- 画面でnote記事を開き、読んで手動でスキした後、「noteでスキ後に記録」を押す
- すでにスキ済み、または興味がない人は「スキ済み・見送り」で次へ進む

**スキの自動送信、ランダム間隔での連続スキ、フォローの自動操作は行いません。**

## 自動定期実行

- 毎時17分ごろにGitHub Actionsの `Candidate list (read-only)` を自動起動します（GitHub側の混雑で遅れる場合があります）。
- 毎回noteのログイン状態でフォロー関係・投稿日時・`isLiked` を再確認し、スキ済みや既に関係のある候補を除外します。
- 候補の具体的な名前やURLを通常のActionsログに出さず、件数と除外理由だけ記録します。
- 候補の詳細は最大1日保持するActions Artifact `prince-candidate-review` に保存します。リポジトリ本体へ候補データをcommitしません。
- 自動停止する場合はActionsのRepository variablesに `DISABLE_CANDIDATE_DISCOVERY=true` を登録します。falseか未設定で再開します。
- GitHub ActionsのCronは30秒単位ではありません。**本構成ではスキ送信を自動実行しません。**

## 使い方

1. GitHubリポジトリの **Settings → Secrets and variables → Actions** に `NOTE_SESSION_COOKIE` を登録する。値をコードやIssueに貼り付けない。
2. 以後は毎時17分に自動実行されます。すぐに確認したい場合は **Actions → Candidate list (read-only) → Run workflow** を実行。
3. 実行成功後、該当Runの **Artifacts → prince-candidate-review** を取得。
4. 展開した `candidate-review.html` をブラウザで開く。
5. 記事を読んでnote側で手動操作。その後、管理画面で確認済み・見送りの記録を付ける。

ブラウザの記録は `localStorage` に保存されます。同じブラウザ・同じファイルURL以外への引き継ぎは保証しません。記録はnoteの実際のスキ状態と同期されず、ボタンを押すだけでスキは付きません。

## 安全性と制約

- 候補者はログイン済みアカウントのフォロー先を起点として発見した一部です。全noteユーザーを網羅していません。
- 最近の記事を確認した時点の `isLiked` の値を使います。過去すべてのスキ履歴を照会できるとは限りません。
- 認証失敗・HTTP 401/403/429では読取を停止し、無制限な再試行はしません。
- 対象データには他のクリエイターの公開アカウント名・記事タイトルが含まれます。通常ログでは個人別結果を表示しませんが、**公開リポジトリのGitHub Actions Artifactは第三者が閲覧できる可能性があります。秘匿が必要な場合はリポジトリ自体を非公開にしてください。**
- 認証CookieはActions Secretとして実行時のみ利用し、生成HTMLに埋め込みません。
- Artifactsの保持は**1日**です。すでにダウンロードしたファイルは手元に残ります。
- note公式の短時間大量スキへの制限を回避するためのツールではありません。

## 開発・テスト

Node.js 22以上。

```sh
npm install --no-save playwright-core@1.55.0
npm test
node --check scripts/candidates.mjs
```

認証検証は `Verify note session`、フォロー情報の診断は `Probe note follow surface`、候補抽出は `Candidate list (read-only)` Workflowで確認できます。
