# Tournament System — 現行LINE版

埼玉大学かるた会で運用中の、GAS + Google Sheets + LINE による大会管理システムです。

## 保守する範囲

- `gas/`：既存のGoogle Apps Script、Sheets連携、LINE通知、Calendar連携
- `web/`：参加者向け回答ページ、運営管理画面、案内、マニュアルへの入口
- `docs/`：現行LINE版の仕様・設定・引き継ぎ資料
- `.github/workflows/pages.yml`：GitHub Pagesへの画面公開

Google Sheetsがデータの正本で、GitHub Pagesは画面を配信します。GASのデプロイ更新はGitへのpushとは別の操作です。

## 公開先の維持

このリポジトリの所有者と名前は `Saitama-Univ-Karuta-Club/tournament-system` のまま維持します。LINEで配布済みのリンクはGitHub Pagesの公開先に依存しています。現行版の利用が終了するまでは、Pagesを公開できる設定を保ってください。

2026-11-19、organization移管で変更された公開先を元の場所へ復旧しました。復旧時には、旧mainコミット `d72f38870df82983105b882e3634c712b2f61732` から現行版の32ファイルと関連する72コミットを抽出しました。GitHub Pagesで配信する画面とGASコードは元の内容と同一です。復旧コミットは `300695bbfc2a3b418bdc9c9793c77331106d0930` です。

GASのデプロイ、Google Sheetsの内容、LINE通知先は変更していません。メンバー回答画面・管理画面と最新データの表示を運用者が確認済みです。

## 移行先システム

Cloudflare / D1 / Discord版と開発中のアプリは `KarutaLab` 側で管理します。このリポジトリには含めません。

## 資料

- [基本操作マニュアル](docs/manuals/basic-operation-manual.md)
- [技術マニュアル](docs/manuals/developer-manual.md)
- [GAS設定](gas/SETUP.md)
- [仕様書](docs/line_bot_tournament_system_spec.md)
