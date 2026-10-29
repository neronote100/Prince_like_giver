# Prince Like Giver 🌙

王子（note ID: `nero_notelover`）の候補記事を読み取り専用で調査するツールです。

## できること

- GitHub Actionsの `NOTE_SESSION_COOKIE` でログイン済みのnote情報を**読み取る**
- 候補者のフォロー数／フォロワー数・フォロー関係・最近30日の投稿を確認
- **フォロー数がフォロワー数より15%以上多い**（既存の最低10人差も維持）場合だけ採用
- `isLiked=true` の最近の記事がある人を**候補から除外**
- 不確かなフォロー関係・スキ状態は採用せず、読取結果を安全側で判定
- 候補15件までの**スマホ1画面向けコンパクトなレビュー画面** `candidate-review.html` を生成
- 1行に「ユーザー名／記事タイトル／記事↗／✓／×」を並べ、端末の画面高に合わせて行間を自動調整
- ✓で「noteでスキした後の記録」、×で「スキ済み・見送り」を登録。同じボタンをもう一度押すと取り消し
- 候補を記録・見送りしても一覧の位置は移動せず、15件をそのまま見渡せる
- `mobile-15-preview.png` をArtifactへ保存。スマホ3サイズ（390×844、360×740、320×600）で15行の表示を自動検証
- 画面でnote記事を開き、読んで手動でスキした後、「noteでスキ後に記録」を押す
- すでにスキ済み、または興味がない人は「スキ済み・見送り」で次へ進む

**スキの無人自動送信、ランダム間隔での連続スキ、フォローの自動操作は行いません。**

## Web画面から1件ずつスキする（Cloudflare Worker）

既存のZIP版 \`candidate-review.html\` は引き続き記録専用です。実際の「♡ スキ」ボタンを使う場合は、**別途Cloudflare Workerを配備したURL**を開きます。GitHub Actionsが候補を集め、Cloudflare Workerが認証済みの1件送信のみを担当します。

### 初回設定

GitHub リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で次を登録してください。

| Secret | 用途 |
| --- | --- |
| \`NOTE_SESSION_COOKIE\` | 既存のnoteログインCookie（登録済みなら変更不要） |
| \`CLOUDFLARE_API_TOKEN\` | Cloudflare Workerのデプロイ権限を持つAPIトークン |
| \`CLOUDFLARE_ACCOUNT_ID\` | CloudflareアカウントID |
| \`DASHBOARD_TOKEN\` | 24文字以上のランダムな管理パスワード。画面からのスキ送信を許可する本人認証用 |

**Cookieや各Secretの値は、GitHubのコード・Issue・チャットに貼らないでください。** \`DASHBOARD_TOKEN\` は第三者に推測されない乱数文字列を推奨します。

すべて設定すると、\`Actions → Candidate list (read-only) → Run workflow\` の実行時および毎時17分ごろの自動更新時に、\`prince-like-review\` というWorkerがデプロイされます。URLはその実行ログの \`Deploy one-click review Worker\` に表示されます。Cloudflare WorkersのURLはアカウントごとに異なるため、ここでは固定しません。

画面を開いたら \`DASHBOARD_TOKEN\` の値でログインします。本人が**各行の「♡ スキ」を1回押すと、その記事1件だけ**サーバーが送信を試みます。すでにスキ済みならPOSTを送信せず \`♥ 済\` と表示します。通信状態が曖昧なら自動再送せず \`要確認\` で止めます。スキ済み判定や送信にはnoteの**非公式API**を使用しており、note側の仕様変更や制限により動作しなくなる可能性があります。

- **自動スキ・一括スキは行いません。** 選別・候補の定期更新のみ自動です。
- スキ送信には公開ZIP版のHTMLを使えません。WebページとAPIが同じCloudflare WorkerのURLで提供されます。
- GitHubの公開ログにSecretは出しません。候補詳細をブラウザに渡すには管理パスワードが必要です。
- デプロイ用Secretが揃わない場合、候補抽出ジョブだけ成功し、Workerデプロイはスキップされます。
- Workerの送信テストはモックを使い、候補者にテストのスキを送信しません。
- パスワードを変更するときはGitHub Secret \`DASHBOARD_TOKEN\` を更新し、手動でWorkflowを再実行してください。

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
5. 1行ごとの **記事↗** をタップし、記事を読んでnote側でスキを押す。その後、一覧の **✓** で記録する。すでにスキ済み・見送りは **×**。再タップで記録を取り消せる。
6. スマホでの見た目は同じArtifactの `mobile-15-preview.png`（ダミーデータ）で確認できる。

ブラウザの記録はユーザー単位で `localStorage` に保存されます。同じブラウザ・同じファイルURL以外への引き継ぎは保証しません。記録はnoteの実際のスキ状態と同期されず、ボタンを押すだけでスキは付きません。

## 安全性と制約

- 候補者はログイン済みアカウントのフォロー先を起点として発見した一部です。全noteユーザーを網羅していません。
- 最近の記事を確認した時点の `isLiked` の値を使います。過去すべてのスキ履歴を照会できるとは限りません。
- 認証失敗・HTTP 401/403/429では読取を停止し、無制限な再試行はしません。
- 対象データには他のクリエイターの公開アカウント名・記事タイトルが含まれます。通常ログでは個人別結果を表示しませんが、**公開リポジトリのGitHub Actions Artifactは第三者が閲覧できる可能性があります。秘匿が必要な場合はリポジトリ自体を非公開にしてください。**
- 認証CookieはActions Secretとして実行時のみ利用し、生成HTMLに埋め込みません。
- Artifactsの保持は**1日**です。すでにダウンロードしたファイルは手元に残ります。
- Webページの ✓/× は**管理用の状態記録のみ**です。noteのスキ実績とは同期されません。
- 小さい画面や文字拡大・アクセシビリティ設定によっては15行を収めるためのスクロールが必要になります。
- note公式の短時間大量スキへの制限を回避するためのツールではありません。

## 開発・テスト

Node.js 22以上。

```sh
npm install --no-save playwright-core@1.55.0
npm test
node --check scripts/candidates.mjs
```

認証検証は `Verify note session`、フォロー情報の診断は `Probe note follow surface`、候補抽出は `Candidate list (read-only)` Workflowで確認できます。
