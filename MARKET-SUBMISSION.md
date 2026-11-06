# 进入 DSH 插件市场：可执行清单

> 面向 `@muxiuesd/dsh-pixel-studio` 0.1.1。npm 已上线，市场收录还没做 —— 本文把「点哪里、粘什么、验证什么」写全。

## 现状

| 通道 | 状态 | 卡在哪 |
|---|---|---|
| npm | ✅ 已上线 `0.1.1`（latest） | — |
| 社区目录（6000+，`dshm_search` 来源之一） | ❌ 未收录 | GitHub 仓库**没有 `dsh-plugin` topic** |
| 精选清单（33 条手工收录） | ❌ 未收录 | 还没给 `iasiv5/dsh-m` 提 `registry.json` PR |

已核实的两条事实：

- 本机同步的社区目录快照 `catalog-2026.1106.16122.json`（12 MB，今天 18:36 拉取）里搜 `muxiuesd` → **0 命中**；快照构建时间早于发布（22:18），本来也不可能包含。
- 已收录的同类插件仓库 `KongChengZhi/dsh-pixel-studio` 的 topics 是 `dsh-plugin`；我们的 `Muxiuesd/dsh-pixel` topics 为**空**。GitHub 上带 `topic:dsh-plugin` 的仓库 27,638 个，目录只收 9,111 个，说明 topic 是入选队列的**必要条件**，不是充分条件。

---

## 1. GitHub 仓库设置（2 分钟，需要你点）

打开 <https://github.com/Muxiuesd/dsh-pixel>：

**About 右侧齿轮 → Description**，粘这段（顺手修掉现有的 `Piexl` 拼写）：

```
Pixel art studio for DeepSeek Harness (DSH) — a three-pane editor (tools / canvas / palette) inside the conversation tab: wheel zoom, layers, palette editing, PNG export to the session folder.
```

**Topics**（逐个输入后回车）：

```
dsh-plugin
dsh
deepseek-harness
pixel-art
pixel-editor
canvas
```

为什么这样就够：仓库根已经是包本身（`package.json` 带 `dsh.bundle` + `dsh.client`、`README.md`、`icon.png` 都在），满足目录的静态过滤条件；缺的只有 topic 这个发现入口。

> Gitee → GitHub 镜像只同步 git 内容，**不同步 About / Topics**。所以在 GitHub 侧改完不会被下一次 push 覆盖，可以放心改。

---

## 2. 社区目录（自动收录，等构建）

- 数据源：npm 包 `dsh-plugin-catalog`（当前 `2026.1106.16122`），由 `awesome-dsh-plugin/awesome-dsh-plugin` 的 `scripts/build-site.mjs` 定时构建。
- 收录后的条目形状（预计）：

  ```
  name:    dsh-pixel
  owner:   Muxiuesd
  url:     https://github.com/Muxiuesd/dsh-pixel
  install: dsh plugin --profile web add github:Muxiuesd/dsh-pixel
  ```

  因为仓库根就是包（commit `b7cc95d` 起），不需要 `#path:`。

**自查方法**（等 1–2 天）：

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

如果一周后还没出现，优先怀疑三点：topic 没生效、仓库没被 GitHub 搜索索引（新仓库偶发）、capabilities 检查（要求只读写 `env`）没过。

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
