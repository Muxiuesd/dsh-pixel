# 发布手册（dsh-pixel-studio）

这份文档记录这个插件从本地代码到「别人能装」的完整流程，包含本项目已经踩过的坑。

## 0. 现状速查

| 项 | 值 |
| --- | --- |
| npm 包名 | `@muxiuesd/dsh-pixel-studio` |
| 当前版本 | `0.1.1` |
| Gitee（主仓库） | <https://gitee.com/muxiuesd12138/dsh-pixel> |
| GitHub（镜像，自动同步） | <https://github.com/Muxiuesd/dsh-pixel> |
| 仓库布局 | 根目录就是插件包（`package.json` / `index.js` / `client.js` / `cordis.patch.yml` / `locale/` / `icon.png`） |
| 发布的目标 registry | `https://registry.npmjs.org/`（写在 `publishConfig`，不依赖本机 `.npmrc`） |

## 1. 一次性准备

1. 在 <https://www.npmjs.com/signup> 注册账号，并开启 2FA（推荐「Authorization only」）。
2. 让 **scope 归属你**：`@muxiuesd` 必须是你的 npm **用户名**（小写），或者你创建的组织。
   - 用户名不是 `muxiuesd` 时，把三处一起改掉（见第 9 节「三处 id 必须一致」）。
3. 记下 2FA 的 TOTP（手机 App 里的 6 位数字），发布时要带 `--otp`。

## 2. 每次发版的固定流程

```bash
cd D:\code\dsh-pixel

# ① 自检（必须全绿）
node --check client.js
node --check index.js
node tools/deps-check.cjs client.js index.js
node tools/render-smoke.cjs
node tools/test-detach.cjs
node tools/interact-smoke.cjs

# ② 登录（注意：必须显式指定官方源，否则 token 会记到国内镜像名下）
npm.cmd login --registry=https://registry.npmjs.org
npm.cmd whoami --registry=https://registry.npmjs.org      # 打印你的 npm 用户名

# ③ 看这次到底会发哪些文件
npm.cmd publish --dry-run

# ④ 发布
npm.cmd publish --otp=123456
```

`npm.cmd publish` 成功后终端会打印 `+ @muxiuesd/dsh-pixel-studio@0.1.1` 和本次的 shasum。

> Windows 上 `npm` 的 PowerShell 包装脚本（`npm.ps1`）常被执行策略挡住，所以一律写 `npm.cmd`。

## 3. 发版后验证

```bash
# 元数据
npm.cmd view @muxiuesd/dsh-pixel-studio --registry=https://registry.npmjs.org
# 网页（几秒～1 分钟生效）
# https://www.npmjs.com/package/@muxiuesd/dsh-pixel-studio

# 真实装一次（这就是用户视角）
dsh plugin --profile web add @muxiuesd/dsh-pixel-studio
```

装完刷新页面，会话页签行应出现「像素画」，插件管理页应显示图标（洋红底黄 P）和中文名「像素画工作室」。

## 4. 包里有什么（`files` 白名单）

实际发布 9 个文件（约 33.7 kB）：

```
LICENSE  README.md  package.json
index.js  client.js  cordis.patch.yml  icon.png
locale/en.json  locale/zh.json
```

**不会**被打包：`tools/`（自检脚本）、`dsh-pixel-icon.png`（原始素材）、`out/`、`.git/`、`PUBLISHING.md`。
`README.md` 与 `LICENSE` 由 npm 自动包含，所以即使不在 `files` 里也会进包。

## 5. 版本流转

```bash
npm.cmd version patch -m "release %s"   # 0.1.1 -> 0.1.2
npm.cmd version minor                   # -> 0.2.0
npm.cmd version major                   # -> 1.0.0

git push --follow-tags                 # 提交 + 打 tag 一起推（Gitee→GitHub 会自动同步）
npm.cmd publish --otp=123456
```

**同一个版本号不能发布第二次**（npm 永久保留）。发错了的处理：

- 打错内容但想保留版本号 → 只能发 `0.1.2`；
- 内容有严重问题 → `npm.cmd deprecate @muxiuesd/dsh-pixel-studio@0.1.1 "broken build"`，然后发新版；
- 发布后 72 小时内、且没有别的包依赖它 → 可以 `npm.cmd unpublish @muxiuesd/dsh-pixel-studio@0.1.1`（慎用）。

## 6. 进入市场的三条路

| 方式 | 需要什么 | 生效速度 |
| --- | --- | --- |
| **直接装** | 只要发布了 npm 包 | 立刻，无需任何人审核 |
| **市场精选清单** | 往 `iasiv5/dsh-m` 的 `registry.json` 提条目（PR） | 等维护者合并 |
| **社区目录** | 公开 GitHub 仓库（已具备），自动扫描收录 | 自动，无需 PR |

### 6.1 精选清单（`registry.json`）条目模板

```json
{
  "id": "dsh-pixel-studio",
  "name": "像素画工作室",
  "description": "在会话页签里画像素画：三栏编辑器、整数倍缩放、图层、调色板与 PNG 导出，作品存本机。",
  "category": "watchlist",
  "tags": ["像素画", "绘图", "编辑器", "图像"],
  "source": "npm",
  "npm": "@muxiuesd/dsh-pixel-studio",
  "homepage": "https://gitee.com/muxiuesd12138/dsh-pixel",
  "icon": "https://cdn.jsdelivr.net/npm/@muxiuesd/dsh-pixel-studio@0/icon.png",
  "verified": ["0.1.1"]
}
```

校验规则（**任一条目不合规，整份清单都会被拒收**）：

- 顶层只能有 `version`（必须是 `1`）和 `plugins`；文件 ≤ 2 MiB、≤ 1000 条。
- 允许的键只有：`id, name, description, category, tags, source, npm, github, homepage, icon, verified, alsoCategories, decoupled, audience`——多一个键就整份失败。
- `id`：≤ 64 字符，`^[a-z0-9][a-z0-9._-]*$`，全表唯一。
- `name` ≤ 100；`description` ≤ 500；`tags` ≤ 10 个、每个 ≤ 30 字符、不重复。
- `source` 只能是 `npm` 或 `github`。写 `github` 时字段是 `"github": "Muxiuesd/dsh-pixel"`（`owner/repo`）。
- `npm` 字段只写包名，**不能带版本、range 或 URL**。
- `homepage` / `icon` 必须是 HTTPS。
- `verified` 是**精确版本号数组**（如 `["0.1.1"]`），语义是「这几个版本我实测过」。
- `category` 取 `essentials / cui-picks / baoyu / guizang / self-dev / tencent-lighthouse / watchlist` 之一，或社区分类 slug；`alsoCategories` 不能与主分类重复。

### 6.2 社区目录

`awesome-dsh-plugin/awesome-dsh-plugin` 通过脚本扫描 GitHub 上的插件仓库，产出 npm 包 `dsh-plugin-catalog`（`plugins.json`）供市场读取。条目形态是 GitHub 仓库（`owner`、`url`、`npm`、`install`、`icon` 等），**不接受 PR 改数据**。所以要做的是：

- 仓库公开（已满足）、根目录有 `package.json` + `README.md`（已满足）；
- README 里写清安装命令，仓库 topics 可加 `dsh-plugin`；
- 之后等下一次扫描收录即可。

## 7. 排错表

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `Publishing to https://registry.npmmirror.com` | 本机 `.npmrc` 指向国内镜像 | 保留 `publishConfig.registry`（本项目已配置），并给 `login` 加 `--registry` |
| `E404 Not Found - PUT … @muxiuesd%2fdsh-pixel-studio` | scope 不属于你 / 未登录 | 确认 npm 用户名或组织是 `muxiuesd`，重新 `login --registry` |
| `E403 … You must be logged in as a member of @muxiuesd` | 同上，或 token 过期 | `npm.cmd logout --registry=…` 后重新登录 |
| `EPUBLISHCONFLICT` / `403 … cannot publish over` | 版本号已存在 | 升版本号再发 |
| `EOTP` | 需要 2FA 验证码 | `npm.cmd publish --otp=123456` |
| `invalid package name` / `SyntaxError: Unexpected token '\ufeff'` | 用 PowerShell 5.1 的 `Set-Content -Encoding utf8` 写过 JSON，带了 BOM | 用不带 BOM 的方式写文件（本项目已改用 write 工具 / `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)`） |
| 本地 link 安装报 `Cannot validate installed package` | 同上，BOM 让 JSON 解析失败 | 同上 |
| 装完插件不出现 | `client.js` 的 loader `id`、`package.json` 的 `name`、`cordis.patch.yml` 的 `name` 三者不一致 | 见第 9 节 |

## 8. 发布前清单（照抄勾一遍）

- [ ] `node --check` 两端通过
- [ ] `deps-check` / `render-smoke` / `test-detach` / `interact-smoke` 全 PASS
- [ ] `npm.cmd publish --dry-run` 的文件清单符合预期（9 个文件）
- [ ] 版本号已按 semver 递增，`git tag` 与 `package.json` 一致
- [ ] 已 push 到 Gitee（GitHub 镜像自动跟进）
- [ ] README 的安装命令可用

## 9. 三处 `id` 必须一致

改名（尤其是改 scope）时必须同时改这三处，漏一处插件会静默失效：

1. `package.json` → `"name": "@muxiuesd/dsh-pixel-studio"`
2. `cordis.patch.yml` → `name: '@muxiuesd/dsh-pixel-studio'`
3. `client.js` → `window.__ModuleLoader__.load({ id: '@muxiuesd/dsh-pixel-studio', … })`

改完记得把本地已安装的 bundle `remove` 再 `install` 一次，否则 profile 里还挂着旧的 link / 旧模块。
