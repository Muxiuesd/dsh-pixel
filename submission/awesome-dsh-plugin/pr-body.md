- [x] I added **one file** at `data/plugins/Muxiuesd__dsh-pixel.yml` — that single file is the whole submission.
- [x] My repo's `package.json` declares **`dsh.bundle`** (`dsh.bundle.patch: ./cordis.patch.yml`, plus `dsh.client` for the browser half).
- [ ] My repo is at least **1 day old** — created 2026-11-06T13:20:38Z, so this is the only failing gate. Per the CI note it re-runs by itself and should clear in ~23h; no resubmission needed.
- [x] `category: ui` — it adds a full-view editor surface to the conversation.
- [x] Description states what the plugin does, no superlatives.
- [x] My repo has the `dsh-plugin` topic.

The plugin is a pixel art editor that renders as a third conversation view. Left pane: four tools (pencil, eraser, bucket fill, eyedropper) with keyboard shortcuts; canvas in the middle with whole-step zoom anchored at the cursor, space/middle-drag pan and an optional grid; right pane: a 36-slot palette. Layers support add/duplicate/merge down/reorder/rename/hide, capped at 8, all undoable. Editing a palette slot moves the old colour to an unused slot and remaps references, so existing pixels never change. Export writes a 1× PNG straight into the session directory (the first export asks where, later exports overwrite); Ctrl+S saves and Ctrl+Shift+S is Save As. Drawings live in `~/.dsh/pixel-studio/works.json`, one host route serves the tab, and there is no outbound network and no runtime dependency. Published to npm as `@muxiuesd/dsh-pixel-studio@0.1.1`.
