# playwright-cli-wrapper 仕様書

## 1. 概要

`playwright-cli-wrapper.js` は、`@playwright/cli`（Playwright CLI）のラッパーとして動作する Node.js スクリプト。  
CLI 経由で実行されるブラウザ操作（開く・クリック・ホバー・タイプ等）に**人間らしいマウス動作（Bezier 曲線による軌道・加減速・微細な震え）** を注入する。

位置づけとしては、[ghost-cursor-playwright](https://github.com/DKprofile/ghost-cursor-playwright) の CLI 向けアダプテーションであり、プログラム API (`createCursor`) と同じ操作をコマンドラインから利用可能にする。

## 2. 解決する課題

- **誰の**: Playwright CLI を自動化・デバッグで使う開発者、ボット検出を回避したい E2E テスト実行環境
- **何の困りごと**: 標準の Playwright CLI の `click`/`hover`/`type`/`fill` は瞬間移動的なマウス操作を行う。そのため:
  - サイト側の bot 検出（マウス軌道分析）に引っかかる
  - 人間が操作している動画・デモとして見た目が不自然
  - 実際のユーザー操作を模擬したテストとして信頼性が低い
- **どう解決する**: CLI コマンドをフックし、各操作の前に Bezier 曲線に基づく人間らしいマウス軌道を注入する

## 3. 依存関係と呼び出し元

### 外部依存

- `@playwright/cli`（絶対パス指定: `~/.nvm/versions/node/v20.19.6/lib/node_modules/@playwright/cli/playwright-cli.js`）
- `child_process`（`spawnSync`）・`fs`・`path`（Node.js 標準）
- `dist/mouse-helper.js`（esbuild でバンドルされた `src/mouse-helper.ts` の出力）

### このラッパーを使う上位レイヤー

- `.playwright-mcp/` - MCP サーバー経由のコマンド実行
- `.playwright-cli/` - CLI エイリアス経由の直接実行

### 呼び出し関係

```
User / MCP Server
    │
    ▼
playwright-cli-wrapper.js     ← コマンドを解釈し、人間らしい操作に差し替え
    │
    ├── spawnSync → @playwright/cli    ← open や fallback 時にパススルー
    │
    └── runCode → @playwright/cli run-code  ← JS コードをブラウザコンテキストで実行
                      │
                      └── page.mouse.move() / page.waitForTimeout() 等（生の Playwright API）
```

## 4. 対応コマンド一覧

| コマンド | 引数 | 人間らしさ注入 | 実行動作 |
|---------|------|---------------|---------|
| `open` | (任意) URL | なし（ただしマウスヘルパーを自動注入） | 元の `open` を実行 → 成功時に `dist/mouse-helper.js` を `run-code` で注入 |
| `click` | `<target>` | ✅ Bezier 曲線で移動 → ランダムオフセット位置で click | `humanClick` 関数 |
| `hover` | `<target>` | ✅ Bezier 曲線で移動（クリックなし） | `humanHover` 関数 |
| `move` | `<target>` | ✅ `hover` と同じ（エイリアス扱い） | `humanHover` 関数 |
| `type` | `<target> <text> [--submit]` | ✅ クリックでフォーカス → 1文字ずつ人間らしい遅延で入力 | 文字間 40～120ms 遅延 |
| `fill` | `<target> <text> [--submit]` | ✅ `type` と同じ動作 | ← 同上 |
| 上記以外の全コマンド | — | なし（素通し） | `spawnSync` で元の CLI にフォワード |

## 5. コア機能の詳細

### 5.1 ターゲット解決 (`resolveLocator`)

- `playwright-cli generate-locator <target> --raw` を実行し、ショートハンド参照（例: `e15`）を Playwright ロケーター式に解決
- 結果がエラー文字列（`###` または `Error` で始まる）の場合は空文字を返し、元の CLI にフォールバック
- 解決されたロケーター式は JSON シリアライズされて注入コード内に埋め込まれる

### 5.2 人間らしいマウス移動 (`HUMAN_MOUSE_CODE`)

インラインで定義された自己完結型のコード。外部依存ゼロ。

#### humanMove(page, targetX, targetY, opts)

1. **開始位置**: 現在のマウス位置（`window.__lastMouseX/Y`、マウスヘルパーが DOM mousemove イベントで保持）を使用。未定義の場合はランダム（`startX: 100~900, startY: 100~500`）。`opts.startX/Y` で明示的に上書き可能
2. **軌道生成**: 2つの Bezier 制御点を乱数で生成。制御点は始点〜終点の間で変動し、人間らしい弧を描く
3. **ステップ数**: 30〜55（`steps` オプションで調整可）
4. **加減速 (ease-in-out)**: 進行度 `t` に基づき、開始時は遅く → 中間で速く → 終端で再び遅く
5. **Cubic Bezier 補間**: 4点（start, cp1, cp2, target）から各ステップの座標を算出
6. **マイクロジッター**: 移動中は ±1.5px、軌道にランダムな揺らぎを付加（終端に近づくほど減少）
7. **可変遅延**: 各ステップ 8〜22ms、ただし開始 15% と終了 15% では 1.8 倍の遅延（ゆっくり）
8. **最終補正**: ループ終了後、正確に目標座標へ `page.mouse.move()` を1回実行

#### humanClick(page, element)

1. `element.boundingBox()` で要素の矩形を取得
2. 矩形の中心からランダムオフセット（要素内の 30%〜70% 範囲）を目標点に設定
3. `humanMove` で目標点へ移動
4. 50〜150ms のホバーポーズ
5. `page.mouse.down()` → 40〜100ms 待機 → `page.mouse.up()`（人間のクリック間隔）

#### humanHover(page, element)

1. `element.boundingBox()` で矩形を取得（取得不可なら何もしない）
2. ランダムオフセット目標点へ `humanMove` で移動（クリックなし）

### 5.3 type / fill の入力シミュレーション

1. `humanClick` で要素をクリックしてフォーカス
2. 80〜160ms 待機
3. `locator.fill('')` で既存内容をクリア
4. 1文字ずつ `page.keyboard.type(char)` で入力
5. 各文字間 40〜120ms のランダム遅延
6. `--submit` フラグがある場合: 100〜250ms 待機後、Enter キーを押下

### 5.4 open 時のマウスヘルパー自動注入

1. 元の `open` コマンドを実行（ページが開かれる）
2. 終了コードが 0 の場合のみ、`dist/mouse-helper.js` を `run-code` でブラウザに注入
3. 注入されるマウスヘルパー: 赤い円形カーソル表示 + 動的なリップルエフェクト + トレイルドット
   - クリック時に白く縮小 + リップルエフェクト
   - インタラクティブ要素上で青く拡大（`hovering` 状態）
   - マウス位置を `window.__lastMouseX/Y` に永続化（wrapper の次回操作時に継承）

## 6. 非機能要件

### パフォーマンス

- `spawnSync` で同期的に子プロセスを実行（Node.js イベントループはブロックされる）
- ラッパー自体はシングルショット実行が想定される（インタラクティブな連続呼び出しは上位レイヤー任せ）
- 人間らしい遅延により、操作1回あたり数百ms〜数秒の待機が発生

### エラーハンドリング

- `resolveLocator` 失敗 → 元の Playwright CLI にフォールバック
- `runCode` 失敗 → `process.exit(status)` でエラーコード伝播
- 未処理の例外 → `main().catch()` で補足し exit code 1
- 要素未検出 → 注入コード内で `throw new Error('Element not found')` → CLI がエラー出力

### 設定・カスタマイズ

- `ORIGINAL_CLI` / `DIST_DIR` のパスはハードコード（環境変数による外部指定なし）
- 人間らしさパラメータ（ステップ数・遅延範囲・ジッター量）はコード内定数。外部からは CLI の opt としては渡せない

## 7. エッジケース・境界条件

| 条件 | 動作 |
|------|------|
| `click` で target 未指定 | 元の CLI にパススルー |
| `resolveLocator` が空文字を返した | 元の CLI にパススルー |
| 要素が存在しない | `run-code` 内で例外 → CLI がエラー終了 |
| `boundingBox()` が null | `humanClick` は `element.click()`（人間らしさなし）にフォールバック |
| `open` が非ゼロ終了 | マウスヘルパー注入をスキップ |
| 文字列入力が空文字 | `type`/`fill` のテキスト結合が空文字列になる。クリックのみ実行 |
| `--submit` が引数中のどこにあるか | `textArgs.indexOf('--submit')` で検出 → テキストから除去 |
| ターゲット解決に失敗（`--raw` 非対応の古い CLI）| `resolveLocator` がエラー文字列を返す → フォールバック |

## 8. 制約・注意点

1. `ORIGINAL_CLI` の絶対パスが環境固定（Node.js バージョン依存）。異なる Node バージョン環境では修正が必要
2. ラッパーは同期的な `spawnSync` で動作。長時間の操作中は Node.js イベントループがブロックされる（CLIツールとしては許容範囲）
3. `run-code` に渡す JavaScript コードはテンプレートリテラルで構築され、JSON シリアライズされたロケーター式が埋め込まれる。特殊文字を含むセレクターは正しくエスケープされる
4. 人間らしい動作パラメータはすべてコード内定数。外部調整不可
5. `page.mouse.move()` / `page.waitForTimeout()` のみ使用。`page.mouse.down()`/`up()` も直接呼び出し（Playwright の `locator.click()` は使わない）
