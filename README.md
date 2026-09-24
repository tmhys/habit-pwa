# 習慣グリッド (habit-pwa)

[tmhys/github_obsidian](https://github.com/tmhys/github_obsidian)（非公開）の習慣ログを、
[Loop Habit Tracker](https://play.google.com/store/apps/details?id=org.isoron.uhabits)
風の一覧・詳細画面で見るPWA。
技術士勉強・お酒・コーヒー・筋トレの4つは、一覧のチェック欄をタップして直接記録できる。

## データの流れとプライバシー

```
github_obsidian (private, 日記本体を含む)
  └─ _scripts/build_habit_snapshot.py
       → 習慣id・表示名・実施した日付「だけ」を集計した _widget/habits.json
  └─ .github/workflows/habit-log.yml / habit-snapshot-daily.yml
       → 上記JSONをこのリポジトリの data/habits.json に転載
habit-pwa (public, このリポジトリ)
  └─ data/habits.json を index.html が fetch して描画
```

**日記の文章・支出・その他の個人的な記録はこのリポジトリのどこにも入らない。**
転載されるのは `{習慣id, 表示名, 実施した日付の配列}` という集計値だけ。
とはいえ「どの日に何を実施したか」自体は公開リポジトリに載るため
（例: お酒を飲んだ日）、その点は理解した上で使う。

## 記録の方法（2種類）

- **手動4種**（技術士勉強・お酒・コーヒー・筋トレ）: この画面右上の⚙️から
  `habit-relay`（`tmhys/gas`のGAS中継役）のURLと合言葉を設定すると、
  チェック欄（または詳細画面のカレンダーのマス）をタップするだけで記録できる。
  過去の日のマスをタップすると、その日の正午の時刻で記録する（付け忘れの後追い用）。
  中継役は「追加」しかできないため、タップ後4秒間は送信を待ち、その間に
  トーストの「元に戻す」（または同じマスの再タップ）で取り消せる。
  送信後の取り消しは Obsidian のストリームノートから行う。このアプリ自身はGitHubへの書き込み権限を
  一切持たない（中継役の役割・セキュリティ設計は `tmhys/gas` の
  `habit-relay/README.md` を参照）。
- **自動2種**（英語学習=Duolingo起動 / タイマー=特定URL起動）: 引き続き
  Taskerのアプリ起動検知で記録する。手順は `github_obsidian` の
  [`_scripts/README.md`「習慣トラッカー」](https://github.com/tmhys/github_obsidian/blob/main/_scripts/README.md)を参照。

いずれの経路で記録しても、下のグリッドの更新経路（`habit-log.yml`によるこの
リポジトリへの転載）は共通。

## 画面

Loop Habit Tracker の画面構成に寄せている。

- **一覧**: 習慣ごとに1行。左から「スコアの輪・習慣名・直近数日のチェック欄」。
  チェック欄の日数は画面幅に合わせて変わる。既定は新しい日が左（Loopと同じ）で、
  ⚙️から「今日が右」の順にも変えられる。
- **詳細**（習慣名をタップ）: 概要（スコア・30日前比・1年前比・合計・継続中の日数）、
  スコアの推移、週/月ごとの回数、カレンダー（縦に曜日・横に週）、
  連続記録の上位5件、曜日別の頻度（月×曜日の点の大きさ）。
  Androidの戻る操作で一覧に戻る。
- **スコア**は Loop と同じ指数平滑（半減期13日。実施した日を1、しなかった日を0として平滑）。
  データの先頭日を0%から始めるので、データが短いうちは低めに出る。
- 送信済みでまだスナップショットに反映されていない記録は、この端末の
  localStorage に覚えておいて表示に混ぜる（反映されたら／3日経ったら消える）。
- ヘッダーに最終更新時刻。転載が2日以上止まっていると警告を出す。
  アプリに戻ってくるたびにデータを取り直す。

データは直近400日分（`build_habit_snapshot.py` の既定）。それより前は表示されない。

## セットアップ

1. **グリッド転載**: `github_obsidian` 側のSecretsに `HABIT_MIRROR_TOKEN`
   （このリポジトリだけにscopeしたfine-grained PAT、Contents: Read and write）
   を設定する。詳細は上記READMEの「グリッド表示（habit-pwa）」を参照。
   未設定の間は `data/habits.json` が更新されず、シードデータ（全習慣0件）のまま。
2. **記録ボタン**: `tmhys/gas` の `habit-relay` をデプロイ・設定した上で
   （`habit-relay/README.md` 参照）、このアプリの⚙️からURLと合言葉を入力する。
   設定はこの端末のブラウザ内（localStorage）だけに保存され、どこにも送信されない。
