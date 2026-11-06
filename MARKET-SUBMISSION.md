# 进入 DSH 插件市场：可执行清单

> 面向 `@muxiuesd/dsh-pixel-studio` 0.1.1。npm 已上线，市场收录还没做 —— 本文把「点哪里、粘什么、验证什么」写全。

## 现状

| 通道 | 状态 | 卡在哪 |
|---|---|---|
| npm | ✅ 已上线 `0.1.1`（latest） | — |
| 社区目录（6000+，`dshm_search` 来源之一） | ⏳ 物料已备好 | 还没提 `awesome-dsh-plugin` 的 PR（第 2 节，文件已写好） |
| 精选清单（33 条手工收录） | ❌ 未收录 | 还没给 `iasiv5/dsh-m` 提 `registry.json` PR |

已核实的四条事实：

- 本机同步的社区目录快照 `catalog-2026.1106.16122.json`（12 MB，今天 18:36 拉取）里搜 `muxiuesd` → **0 命中**；快照构建时间早于发布（22:18），本来也不可能包含。
- `Muxiuesd/dsh-pixel` 的 topics 已加齐（`dsh-plugin` 等 6 个），GitHub 搜索 `topic:dsh-plugin user:Muxiuesd` **total=1** —— 准入条件已满足。
- 但社区目录**不是**靠 topic 自动抓取的（早先的判断需要更正）：条目是 `data/plugins/*.yml` 里一行一行 PR 进去的，README 与 npm 目录都是从那批 YAML 生成的。
- 仓库建于 `2026-11-06T13:20:38Z`，CI 有一条「仓库满 1 天」的闸门，**北京时间 2026-11-07 21:20 自动转绿**（`regate.yml` 每 6 小时重跑），不需要重提。

---

## 1. GitHub 仓库设置 ✅ 已完成（2026-11-06）

已核对现状：topics = `canvas, deepseek-harness, dsh, dsh-plugin, pixel-art, pixel-editor`（6 个），description 已替换并修掉 `Piexl`；下面保留原始步骤只作记录。

打开 <https://github.com/Muxiuesd/dsh-pixel>：

**About 右侧齿轮 → Description**，粘这段：

```
Pixel art studio for DeepSeek Harness (DSH) — a three-pane editor (tools / canvas / palette) inside the conversation tab: wheel zoom, layers, palette editing, PNG export to the session folder.
```

**Topics**：

```
dsh-plugin
dsh
deepseek-harness
pixel-art
pixel-editor
canvas
```

为什么这样就够：仓库根已经是包本身（`package.json` 带 `dsh.bundle` + `dsh.client`、`README.md`、`icon.png` 都在），满足目录的静态过滤条件；topic 是投稿的准入条件。

> Gitee → GitHub 镜像只同步 git 内容，**不同步 About / Topics**。所以在 GitHub 侧改完不会被下一次 push 覆盖，可以放心改。

---

## 2. 社区目录（awesome-dsh-plugin.com）—— **更正：不是自动抓的**

早先以为「加了 `dsh-plugin` topic 就会被自动收录」，**不对**。topic 只是**投稿的准入条件之一**，目录本身靠 PR 一条一条加。真正的数据源是仓库 `awesome-dsh-plugin/awesome-dsh-plugin` 的 `data/plugins/`：一个插件一个 YAML 文件，两个 README 由脚本生成（`contributing.md` 明令禁止手改 README）。

### 投稿流程

1. fork `awesome-dsh-plugin/awesome-dsh-plugin`；
2. 新增 **一个文件** `data/plugins/Muxiuesd__dsh-pixel.yml` —— 这一个文件就是全部投稿；
3. 提 PR，勾选 `.github/pull_request_template.md` 里的清单；
4. 合并后 `main` 自动重建 README；npm 包 `dsh-plugin-catalog` 下次构建（`scripts/build-site.mjs` → `publish-catalog.mjs`）把条目推给所有市场客户端。

现成文件已经写好在本仓库：`submission/awesome-dsh-plugin/Muxiuesd__dsh-pixel.yml`（已用 js-yaml 解析验证，五个键：`url` / `name` / `category` / `description.en|zh` / `icon`）：

```yaml
url: https://github.com/Muxiuesd/dsh-pixel
name: Muxiuesd/dsh-pixel
category: ui
description:
  en: 'Pixel art editor in a DSH conversation tab: pencil, eraser, bucket fill and eyedropper on a grid canvas that zooms in whole steps around the cursor; up to eight layers with merge, reorder, rename and full undo; a 36-slot palette whose edits move the old colour to a free slot so existing pixels never change; PNG export written straight into the session directory.'
  zh: 'DSH 会话页签里的像素画编辑器：在网格画布上用铅笔、橡皮、油漆桶与取色器作画，滚轮以光标为中心整档缩放；最多八层图层，支持合并、上下移、改名与完整撤销；36 色可编辑调色板，改色时把旧颜色搬到空闲槽，已有像素不会跟着变；PNG 直接导出到当前会话目录。'
icon: https://raw.githubusercontent.com/Muxiuesd/dsh-pixel/main/icon.png
```

> 描述里含 `: `（冒号+空格）时必须加引号，否则 YAML 会把它当嵌套键 —— 上面两条描述都加了单引号。
> 描述被当作**对你代码的声明**来核对：我按 `client.js` 实际实现写（`TOOLS` 只有 pencil / eraser / bucket / picker，`MAX_LAYERS = 8`，`CHARS` 36 色），没有写直线工具、没有写动画帧 —— 这两样插件确实没有。

### CI 闸门（`scripts/check-submission.mjs`，只有三条）

| 闸门 | 我们的状态 |
|---|---|
| 仓库未被归档 | ✅ |
| `package.json` 声明 `dsh.bundle` | ✅ `dsh.bundle.patch: ./cordis.patch.yml` + `dsh.client.platform: web`（已用 GitHub API 核对 main 分支上的文件） |
| 仓库创建满 **1 天** | ⏳ 建于 `2026-11-06T13:20:38Z` → **北京时间 2026-11-07 21:20** 自动转绿 |

第三条的正确处理（脚本注释原话）：这是唯一「时间一到自动变绿」的失败项，`regate.yml` 每 6 小时重跑一次并匹配 `/days old/` 那条文案 → **照常提 PR 就好**，不要关掉重开、不要空提交。CI 会先显示一条红叉，约 23 小时后自己消失，不需要重提。

### PR 标题与正文

标题：

```
Add Muxiuesd/dsh-pixel — pixel art editor in a conversation tab
```

正文（对应他们的模板，可直接粘）：

```md
- [x] I added **one file** at `data/plugins/Muxiuesd__dsh-pixel.yml` — that single file is the whole submission.
- [x] My repo's `package.json` declares **`dsh.bundle`** (`dsh.bundle.patch: ./cordis.patch.yml`, plus `dsh.client` for the browser half).
- [ ] My repo is at least **1 day old** — created 2026-11-06T13:20:38Z, so this is the only failing gate. Per the CI note it re-runs by itself and clears in ~23h; no resubmission needed.
- [x] `category: ui` — it adds a full-view editor surface to the conversation.
- [x] Description states what the plugin does, no superlatives.
- [x] My repo has the `dsh-plugin` topic.

The plugin is a pixel art editor that renders as a third conversation view. Left pane: four tools (pencil, eraser, bucket fill, eyedropper) with keyboard shortcuts; canvas in the middle with whole-step zoom anchored at the cursor, space/middle-drag pan, optional grid; right pane: a 36-slot palette. Layers support add/duplicate/merge down/reorder/rename/hide, capped at 8, all undoable. Editing a palette slot moves the old colour to an unused slot and remaps references, so existing pixels never change. Export writes a 1× PNG straight into the session directory (first export asks where, later exports overwrite); Ctrl+S saves, Ctrl+Shift+S is Save As. Data stays in `~/.dsh/pixel-studio/works.json`; one host route serves the tab; no outbound network, no runtime dependencies. Published to npm as `@muxiuesd/dsh-pixel-studio@0.1.1`.
```

### 收录后自查（等 1–2 天）：

```powershell
# 1) 目录版本有没有往前走
npm.cmd view dsh-plugin-catalog version

# 2) 本机缓存里有没有新快照
Get-ChildItem "$env:USERPROFILE\.dsh\dshm\cache\desktop\host\awesome" |
    Sort-Object LastWriteTime -Descending | Select-Object Name, LastWriteTime -First 3

# 3) 新快照里出现你的名字了吗
Select-String -Path "$env:USERPROFILE\.dsh\dshm\cache\desktop\host\awesome\catalog-*.json" `
    -Pattern 'Muxiuesd/dsh-pixel' -SimpleMatch | Select-Object -First 3
```

PR 合并后最多等一次构建（`npm view dsh-plugin-catalog version` 变新即可）。合并前本地缓存里当然搜不到自己 —— 那不是「抓取还没轮到你」，是目录里确实还没有这一行。

---

## 3. 精选清单 PR（手动，最有价值的一条）

目标仓库：`iasiv5/dsh-m`，文件：仓库根的 `registry.json`（顶层只允许 `version: 1` 与 `plugins: []`）。

先确认 id 没被占：本机随包快照有 33 条，`dsh-pixel-studio` 这个 id **未被占用**。

**追加到 `plugins` 数组的条目**（下面这份已经用 dsh-m 自己的校验器在本机跑过 → `PASS`，见附录）：

```json
{
  "id": "dsh-pixel-studio",
  "name": "像素画工作室",
  "description": "DSH 会话页签里的手绘像素画编辑器：三栏布局（左工具 / 中画布 / 右调色板），滚轮按光标缩放，支持图层增删合并、按合成色填充、内置调色板改色（不动画布已有像素），PNG 导出直接落到当前对话目录。",
  "category": "self-dev",
  "tags": ["pixel-art", "canvas", "editor", "image", "export"],
  "source": "npm",
  "npm": "@muxiuesd/dsh-pixel-studio",
  "icon": "https://unpkg.com/@muxiuesd/dsh-pixel-studio@0.1.1/icon.png",
  "homepage": "https://github.com/Muxiuesd/dsh-pixel",
  "verified": ["0.1.1"]
}
```

条目要点（对照校验器规则，逐条都过了）：

| 规则 | 本条 |
|---|---|
| `id` ≤64、`^[a-z0-9][a-z0-9._-]*$`、全表唯一 | `dsh-pixel-studio` ✅（本机 33 条里无冲突） |
| `name` ≤100、非空 | 中文名 7 字 ✅ |
| `description` ≤500、非空 | 116 字 ✅ |
| `category` ∈ 7 个枚举 | `self-dev` ✅ |
| `tags` ≤10 个、每个 ≤30 字、不重复 | 5 个 ✅ |
| `source` ∈ `npm` \| `github` | `npm` ✅ |
| `npm` 匹配 `NPM_RE`（scoped 允许） | `@muxiuesd/dsh-pixel-studio` ✅ |
| `homepage` / `icon` 必须 HTTPS | 两条都 ✅ |
| `verified` 精确 semver 数组 | `["0.1.1"]` ✅ |
| 未知字段一律拒收 | 只有上述字段 ✅ |

**图标 URL 已实测**：`https://unpkg.com/@muxiuesd/dsh-pixel-studio@0.1.1/icon.png` → `200`、`image/png`、`131 B`。本机到 `cdn.jsdelivr.net` 的 TLS 是不通的，所以条目里用 unpkg；jsdelivr 留作备选。

**PR 标题**

```
feat(registry): add dsh-pixel-studio — pixel art editor for DSH
```

**PR 正文**（可直接粘）

```md
Adds `dsh-pixel-studio`, a hand-drawn pixel art editor that lives in a conversation tab.

- Three-pane editor: tools (pencil / eraser / bucket / picker) · canvas · palette
- Wheel zoom anchored at the cursor, integer zoom steps, space/middle-drag pan
- Layers: add / duplicate / merge down / reorder / rename / hide, all undoable
- Palette: 36 slots, built-in RGB+HEX editor; changing a slot reassigns the old
  colour to a free slot so existing pixels never change
- Export: 1× PNG written straight into the session directory (first export asks
  where, later exports overwrite); Save As with Ctrl+Shift+S

Registry entry validated with `validateRegistry` from `lib/core/registry.js`:
source `npm`, package `@muxiuesd/dsh-pixel-studio@0.1.1`, icon 200 / image/png.

Everything stays local: one route `/dsh-pixel-studio` on the host webserver,
no outbound network, data in `~/.dsh/pixel-studio/works.json`.
```

---

## 4. 收录之后

- 发新版：`npm.cmd version patch` → `npm.cmd publish --otp=XXXXXX`（granular token 免不了发布 OTP）→ `git.cmd push --follow-tags`。
- 精选条目：把新版本追加进 `verified`（`["0.1.1", "0.1.2"]`），要重新提 PR 改这一行。
- 社区目录：下次构建自动更新版本号与描述，不用动。
- 图标 URL 里的 `@0.1.1` 可以一直指向旧版本（图标没变就无需改）。

---

## 附录 A：本机校验命令

```powershell
cd D:\code\dsh-pixel
node tools\validate-entry.cjs                    # 校验候选条目 → PASS
node tools\validate-entry.cjs "C:\Users\m1145\.dsh\profiles\desktop\node_modules\dsh-m\registry.json"
```

脚本直接 `import` dsh-m 的 `lib/core/registry.js` 调 `validateRegistry`，用的是维护者自己的规则，不是复刻。

## 附录 B：命名撞车（不影响收录，影响搜索）

社区目录里已有一条 `KongChengZhi/dsh-pixel-studio`（仓库内子目录插件 `dsh-cli-anything-aseprite`，2026-08-15 收录，4 stars）：定位是「AI 在终端里用 ANSI 逐笔画出精灵图」，跟本插件「在 GUI 里手画」不同，但名字几乎一样。

对策：

- 精选清单的 `name` 用中文「像素画工作室」，别用英文 Pixel Studio；
- `description` 里保留「手绘 / hand-drawn」这类区分词（已在条目里）；
- 社区目录的展示名取自 GitHub 仓库名 `dsh-pixel`，天然不冲突。

## 附录 C：三处 id 必须一致（已核）

`package.json` 的 `name`、`cordis.patch.yml` 的 `name`、`client.js` 的 `__ModuleLoader__.load({ id })` 都是 `@muxiuesd/dsh-pixel-studio`。改名时漏一处会导致「插件装了但页签不出现」。
