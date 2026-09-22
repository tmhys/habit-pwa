# 習慣グリッド (habit-pwa)

[tmhys/github_obsidian](https://github.com/tmhys/github_obsidian)（非公開）の習慣ログを、
「横に日付・縦に習慣」のグリッドで見るための、読み取り専用のビューアPWA。

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

## 記録はここでは行わない

このアプリは**読み取り専用**。習慣の記録はTasker（アプリ起動検知・ワンタップボタン）
から行う。手順は `github_obsidian` の
[`_scripts/README.md`「習慣トラッカー」](https://github.com/tmhys/github_obsidian/blob/main/_scripts/README.md)を参照。

## 画面

- 日付×習慣のグリッド。セルをタップすると下に詳細（日付・習慣名・実施有無）が出る
- 表示期間を2週間/1か月/2か月で切り替え可能（取得済みの直近60日分をその場でスライスするだけなので、切り替えに追加の通信は無い）
- ヘッダーに最終更新時刻。転載が2日以上止まっていると警告を出す

## セットアップ（転載を動かすには）

`github_obsidian` 側のSecretsに `HABIT_MIRROR_TOKEN`（このリポジトリだけに
scopeしたfine-grained PAT、Contents: Read and write）を設定する必要がある。
詳細は上記READMEの「グリッド表示（habit-pwa）」を参照。

未設定の間は `data/habits.json` が更新されないため、このリポジトリに入っている
シードデータ（全習慣0件）のまま表示される。
