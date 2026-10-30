# Prince Like Giver 🌙

王子（note ID: `nero_notelover`）の条件に合う記事をGitHub Actionsで巡回し、**1回の実行につき1件まで、1日最大15件まで**スキを送るツールです。1日の区切りは日本時間です。Cloudflareの画面やスマホのログイン操作を使わず、登録済みの `NOTE_SESSION_COOKIE` を使います。

## 自動巡回とスキ

GitHub Actionsの **Note patrol (one like per run)** が、毎時17分ごろに候補を取得し、その後 `auto-like` ジョブで送信します。手動実行と、対象ファイルが `main` に反映されたときも同じ処理を実行します。GitHub側の混雑によって定期実行が遅れる場合があります。

候補の条件は次のとおりです。

- フォロー数がフォロワー数より15%以上多く、10人以上の差がある
- 既にフォロー・被フォローの関係がなく、その状態を確認できる
- 最近30日以内の記事があり、最近の記事にスキ済みのものがない
- スキ状態などの情報が不明な人は採用しない
- 1回に調べた候補15人までから選び、送信直前にも本人アカウント・条件・記事・スキ状態を確認する

1回の実行で送るスキは最大1件です。日次上限の15件には、送信を試みて結果を確認できなかった分も含めます。大量送信、一括スキ、フォローやコメントの自動送信は行いません。

送信前に `automation/note-like-state` ブランチへ試行記録を書き、その保存を確認できた場合だけnoteへ送ります。同じ記事や同じ実行IDに対する再送はしません。通信結果が不明な記事は記録を残して止め、自動再送しません。送信先が401・403・429を返した場合も再送せず、24時間停止します。保存処理や認証を確認できないときも、その実行の送信を止めます。

候補取得と送信は同じワークフローの直列処理です。前の実行が終わる前に別の送信を重ねません。ブランチやPR上の **Patrol tests (no note actions)** はSecretを使わないテストのみを実行します。

## 設定と停止

`Settings → Secrets and variables → Actions` に `NOTE_SESSION_COOKIE` を登録します。**登録済みで候補取得が成功している場合は、変更不要です。** 値をコード・Issue・チャットへ貼る必要はありません。

記録の保存には、その実行にGitHubが発行する `GITHUB_TOKEN` を使います。自動スキのジョブだけに `contents: write` を与え、個人用アクセストークンやCloudflareのSecretを追加する必要はありません。

止める場合は、ActionsのRepository variablesに次を設定します。

| 変数 | 値 | 動作 |
| --- | --- | --- |
| `DISABLE_AUTO_LIKES` | `true` | 候補取得を続け、スキの自動送信だけ停止 |
| `DISABLE_CANDIDATE_DISCOVERY` | `true` | 候補取得と、それに続く自動送信を停止 |

`false` または未設定で再開します。すぐに実行する場合は、**Actions → Note patrol (one like per run) → Run workflow** を使います。

## 結果を見る

Actionsの実行画面で、候補取得と送信結果の概要を確認できます。通常ログには、候補の具体的な名前・記事タイトル・URLや認証Cookieを出しません。

候補一覧は、実行のArtifact **prince-candidate-review** に1日保存します。

- `candidates.json`：候補15人までの情報
- `candidate-review.html`：スマホ向けのコンパクトなレビュー画面
- `mobile-15-preview.png`、`worker-like-preview.png`：ダミーデータによる画面検証画像

HTMLの「記事↗」から記事を開けます。✓/×は手動の管理記録で、noteのスキ実績とは同期しません。ブラウザの `localStorage` に保存され、別のブラウザへの引き継ぎは保証しません。

このリポジトリは公開されているため、Artifact内の候補情報や、状態ブランチの記事ID・実行ID・日時・結果は第三者が閲覧できる可能性があります。状態ブランチへ候補者名・記事タイトル・Cookieは保存しません。CookieをArtifactや生成HTMLへ埋め込む処理もありません。

## 任意のWebレビュー画面

既存のCloudflare Workerは、画面から本人が1件ずつスキするための別の選択肢です。GitHub Actionsによる自動送信には、このWorkerの配置は必要ありません。

使う場合だけ、次のActions Secretを追加します。

| Secret | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Workerのデプロイ権限を持つAPIトークン |
| `CLOUDFLARE_ACCOUNT_ID` | CloudflareアカウントID |
| `DASHBOARD_TOKEN` | 24文字以上のランダムな管理パスワード |

Secretが揃うと、巡回時に `prince-like-review` Workerも配置します。足りない場合はWorker配置だけをスキップします。画面は `DASHBOARD_TOKEN` で認証し、各行の「♡ スキ」で1件だけ送信します。公開ZIP版のHTMLは記録専用です。

## 制約と開発

候補者は本人のフォロー先を起点に見つけた一部で、note全体を網羅しません。noteの非公式APIを使っているため、note側の仕様や制限によって取得・送信できなくなる場合があります。制限を避けるための再試行やランダム間隔による連続送信は行いません。

開発用のテストは、実際の記事へスキを送らずに実行します。

```sh
npm install --no-save playwright-core@1.55.0
npm test
```

ActionsではNode.js 24.19.0を使います。認証検証の **Verify note session**、フォロー情報を調べる **Probe note follow surface** も利用できます。
