# Block Editor for Obsidian

A plugin that brings Craft-style block selection, movement, and formatting to Obsidian — designed primarily for mobile (iOS/Android) but works on desktop too.

## What it does

Block Editor adds a **Block Mode** to the editor. In Block Mode you can select, multi-select, move, and format entire blocks without the on-screen keyboard appearing. This makes structural editing on mobile fast and pleasant.

A "block" is a logical line of markdown: a paragraph, heading, list item, blockquote line, etc.

## How to use

1. **Enter Block Mode** — Tap the floating action button (bottom-right circle) or run the "Toggle Block Mode" command.
2. **Select blocks** — Tap the circles that appear in the left gutter. Tap again to deselect. Tap multiple circles to multi-select.
3. **Use the toolbar** — A toolbar appears at the bottom with block operations (see below).
4. **Exit Block Mode** — Tap the FAB again, or tap directly on the editor text to exit and place your cursor there.

The keyboard stays dismissed throughout Block Mode — all interactions happen through the gutter circles and toolbar buttons.

## Toolbar operations

| Button | Action |
|--------|--------|
| **Move Up / Down** | Swap selected blocks with the block above or below |
| **Indent / Outdent** | Add or remove one level of indentation |
| **Heading** | Opens a popup to set heading level (H1–H6) or remove heading |
| **Bullet list** | Toggle `- ` prefix |
| **Numbered list** | Toggle `1. ` prefix |
| **Checkbox** | Toggle `- [ ] ` prefix |
| **Delete** | Delete selected blocks |

## Installation

### From source

```bash
git clone https://github.com/chadrach/obsidian-block-editor.git
cd obsidian-block-editor
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` into your vault at `.obsidian/plugins/block-editor/` and enable the plugin in Obsidian settings.

### Development

```bash
npm run dev   # watch mode — rebuilds on file changes
```

## Compatibility

- Obsidian >= 1.4.0
- iOS, Android, and desktop
- Uses CodeMirror 6 extensions (Obsidian's built-in editor engine)

## License

MIT
