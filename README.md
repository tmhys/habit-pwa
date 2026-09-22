# 習慣グリッド (habit-pwa)

[tmhys/github_obsidian](https://github.com/tmhys/github_obsidian)（非公開）の習慣ログを、
「横に日付・縦に習慣」のグリッドで見るビューアPWA。
技術士勉強・お酒・コーヒー・筋トレの4つは、この画面のボタンから直接記録できる。

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
  ボタンをタップするだけで記録できる。このアプリ自身はGitHubへの書き込み権限を
  一切持たない（中継役の役割・セキュリティ設計は `tmhys/gas` の
  `habit-relay/README.md` を参照）。
- **自動2種**（英語学習=Duolingo起動 / タイマー=特定URL起動）: 引き続き
  Taskerのアプリ起動検知で記録する。手順は `github_obsidian` の
  [`_scripts/README.md`「習慣トラッカー」](https://github.com/tmhys/github_obsidian/blob/main/_scripts/README.md)を参照。

いずれの経路で記録しても、下のグリッドの更新経路（`habit-log.yml`によるこの
リポジトリへの転載）は共通。

## 画面

- 記録ボタン（設定済みの場合のみ表示。当日分を記録済みなら色が変わる）
- 日付×習慣のグリッド。セルをタップすると下に詳細（日付・習慣名・実施有無）が出る
- 表示期間を2週間/1か月/2か月で切り替え可能（取得済みの直近60日分をその場でスライスするだけなので、切り替えに追加の通信は無い）
- ヘッダーに最終更新時刻。転載が2日以上止まっていると警告を出す

## セットアップ

1. **グリッド転載**: `github_obsidian` 側のSecretsに `HABIT_MIRROR_TOKEN`
   （このリポジトリだけにscopeしたfine-grained PAT、Contents: Read and write）
   を設定する。詳細は上記READMEの「グリッド表示（habit-pwa）」を参照。
   未設定の間は `data/habits.json` が更新されず、シードデータ（全習慣0件）のまま。
2. **記録ボタン**: `tmhys/gas` の `habit-relay` をデプロイ・設定した上で
   （`habit-relay/README.md` 参照）、このアプリの⚙️からURLと合言葉を入力する。
   設定はこの端末のブラウザ内（localStorage）だけに保存され、どこにも送信されない。
