# dsh-pixel-studio

在 DeepSeek Harness（DSH）里画像素画：会话页签里一个三栏编辑器，左工具、中画布、右调色板，滚轮缩放、图层、导出 PNG，作品存在本机。

## 装法

三种都可以，装完刷新页面，会话页签行里会出现“像素画”。

```bash
# 1) 官方插件管理页 / 插件市场里搜索 @muxiuesd/dsh-pixel-studio
# 2) DSH CLI
dsh plugin --profile web add @muxiuesd/dsh-pixel-studio
# 3) 本地开发（包目录本身就是插件）
dsh plugin --profile web add /绝对路径/dsh-pixel-studio
```

## 能做什么

- **画布**：整数倍缩放 `1×…64×`，滚轮以光标为锚点；空格/中键拖动平移，`F` 适应窗口；`4×` 以上显示格线（可关）。
- **工具**：铅笔、橡皮、油漆桶（按合成后的颜色判断连通，视觉同色一次填满）、吸管；方形笔刷 `1–8` 像素。
- **图层**：最多 8 层，新建/复制/合并/上移/下移/删除/改名/显隐，全部可撤销。
- **调色板**：最多 36 色，内置 PICO-8 等预设板；改某个槽位的颜色**不会改动已经画好的像素**（画布上的旧颜色会先由一个空闲槽位接手），也可以用系统取色器可视化取色。
- **作品**：新建时填名字和尺寸（1–256），另有 11 个常用尺寸预设；自动保存。
- **导出**：首次导出选择保存位置（默认从当前会话目录开始），之后导出直接覆盖那个文件；`另存为` 随时换位置。

## 快捷键

| 键 | 作用 |
| --- | --- |
| `B` / `E` / `G` / `I` | 铅笔 / 橡皮 / 油漆桶 / 吸管 |
| `[` `]` | 笔刷变小 / 变大 |
| `H` | 格线开关 |
| `F` | 适应窗口 |
| `+` / `-` | 放大 / 缩小 |
| 空格 + 拖动、鼠标中键 | 平移画布 |
| `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z`（或 `Ctrl+Y`） | 撤销 / 重做 |
| `Ctrl/Cmd+S` | 保存 |
| `Ctrl/Cmd+Shift+S` | 另存为 PNG |

## 数据与能力

- 作品存在 `<profile 目录>/../pixel-studio/works.json`（默认 `~/.dsh/pixel-studio/works.json`），不上传、不联网。
- 插件只注册一个 Host 路由 `/dsh-pixel-studio`（同源 `fetch`），用于读写作品与写 PNG 文件；不执行命令、不访问网络。
- 导出的 PNG 由插件自己编码（IHDR + zlib + IEND），不依赖任何图像库。

## 环境

- DSH 0.2.x（Web / Desktop 均可），Node.js ≥ 20。
- 客户端用 `window.__ModuleLoader__` 加载，`react` 走宿主模块表，不打包 React。

## 许可

MIT © 2026 Muxiuesd

源码与问题反馈：<https://gitee.com/Muxiuesd/dsh-pixel-studio>
