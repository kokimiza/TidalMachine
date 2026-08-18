# AI × TidalCycles による音楽生成エージェント

ブラウザから自然言語で音楽の依頼を行うと、AIがTidalCycles環境上でコードを生成し、実行結果として音楽コードとWAVファイルを返すWebアプリ。

## Concept

`baba` は、AIに「作曲環境」を与える実験プロジェクトです。

単純な音楽生成ではなく、

```
User
 ↓
Music Request
 ↓
AI Agent
 ↓
TidalCycles
 ↓
SuperCollider / SuperDirt
 ↓
WAV Artifact
```

という流れで、AIが音楽制作の工程そのものを扱います。

## Goals

- 自然言語からTidalCyclesコードを生成する
- AIが生成したコードを実行する
- 成果物として以下を返す

```
music.tidal
music.wav
```

- 将来的にはAI Agentが試行錯誤しながら作曲できる環境を目指す

## Features

### Current

- [x] SvelteKit UI
- [x] 音楽生成リクエスト受付
- [x] Claude API連携
- [x] TidalCyclesコード生成
- [x] WAVレンダリング（実際のSuperCollider/SuperDirtで実行。失敗時は決定的なシンセにフォールバック）
- [x] 失敗したレンダリングをClaudeにフィードバックして1回だけ再試行

### Future

- AIによる生成結果の評価
- 自動修正ループ（現状は失敗時の1回リトライのみ。多段の試行錯誤ループは未実装）
- 作品ごとの音楽コンテキスト管理
- サンプルライブラリ検索
- AI Music Director化

## Architecture

`music.tidal` を書いて終わりではなく、実際に [Cloudflare Computer](https://github.com/cloudflare/computer)
(`@cloudflare/computer`) 上のコンテナで TidalCycles/SuperCollider を起動し、本物の音声を録音して返す。

```
                Browser

                  |
                  v

              SvelteKit (Cloudflare Workers)

                  |
                  v

           jobs.ts (Claude API 呼び出し + リトライ制御)

                  |
                  v

     TidalAgent Durable Object  ──1ジョブ = 1コンテナ
                  |
                  v

     Cloudflare Container (computerd + Workspace VFS)
                  |
        +---------+---------+
        |                   |
        v                   v

  GHC / cabal / tidal   SuperCollider (scsynth)
  (Main.hs を実行し           |
   OSCでパターン送信) ──────► SuperDirt
                                |
                                v
                          s.record → WAV
                                |
                                v
                    Workspace 経由でWorkerへ読み出し
```

失敗時（Haskellのコンパイルエラー、コンテナ未起動など）は最大2回まで実行を試み、
それでも失敗したらAIコンピュータを使わない決定的なシンセにフォールバックする。
`renderer` フィールド（`tidal-supercollider` / `fallback-simulated`）で見分けられる。

## Technology

### Frontend

- SvelteKit
- TypeScript

### Backend / Runtime

- Cloudflare Workers（SvelteKit, `@sveltejs/adapter-cloudflare`）
- [Cloudflare Computer](https://github.com/cloudflare/computer)（`@cloudflare/computer`, preview）
  - `TidalAgent` Durable Object + `CloudflareContainerBackend`
  - ジョブごとに1つの Cloudflare Container（`computerd` 経由でVFS同期）

### AI

- Anthropic Claude API

### Music Engine（コンテナ内、`Dockerfile` / `container-src/` 参照）

- TidalCycles（GHC + cabal でビルド）
- SuperCollider（`scsynth` / `sclang`）
- SuperDirt + Dirt-Samples

## Development

### Requirements

- Node.js / [bun](https://bun.sh)（`bun.lock` を使用）
- Docker（コンテナのビルド・実行に必須。TidalCycles/SuperCollider自体をローカルに入れる必要はない）
- `wrangler`（devDependencies に含まれる）

### Setup

```bash
git clone <repository>
cd cloudflare-computer-tidal-cycles

bun install

# UIだけ触る・シミュレートされたレンダリングで十分なら:
bun run dev

# 実際にTidalCycles/SuperColliderを動かして確認するなら:
bun run build
npx wrangler dev
```

`wrangler dev` は初回、`./Dockerfile` からコンテナイメージをビルドする（GHC/SuperCollider一式を
含むため数分かかる）。`ANTHROPIC_API_KEY` を設定していなくても、決定的なフォールバック作曲ロジックで
実際にTidalCycles/SuperColliderのレンダリングパイプライン自体は最後まで確認できる。

> **Windows で `wrangler dev` する場合**: コンテナのローカル開発は現状Windowsネイティブでは
> サポートされておらず、WSL2が必要（`enable_containers: false` で一時的に無効化することも可能。
> その場合コンテナ以外の部分だけローカルで動かせる）。実際のCloudflareへのデプロイ先はLinuxなので、
> この制約はローカル開発体験にのみ影響する。

### Deploy

```bash
npx wrangler login          # Cloudflareアカウントで認証
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy         # 初回はコンテナイメージのビルド・登録が走るため通常より時間がかかる
```

## Example

Request:

```
深夜の雨の都市。
孤独だが希望が残る雰囲気。
テンポは遅め。
```

AI output:

```haskell
setcps 0.6

d1 $
  sound "bd ~ cp ~"
  # room 0.8
  # size 0.9
```

Generated artifact:

```
music.tidal
music.wav
```

## Philosophy

`baba` は、AIに答えを返させるためのシステムではない。

AIに作業環境を与え、試行錯誤し、成果物を生み出すための「創造工房」を作ることを目的とする。

```
AI is not a chatbot.
AI is a creator with a workspace.
```
