# Block Editor for Obsidian

A plugin that brings Craft-style block selection, movement, and formatting to Obsidian — with a full mobile toolbar and a hover-handle interface on desktop.

A **block** is a logical unit of markdown: a paragraph, heading, list item (with its nested children), blockquote, code fence, etc.

---

## Mobile

### Entering block mode

- **Long-press** anywhere in the editor (default: 800 ms) — enters block mode with the pressed block pre-selected.
- **Ribbon icon** — tap the grid icon in the left ribbon.
- **Command palette** — run "Block Editor: Toggle Block Mode".

The keyboard stays dismissed for the entire block mode session.

### Selecting blocks

Filled circles appear on the right edge of the editor when block mode is active.

| Gesture | Result |
|---|---|
| Tap a circle | Select / deselect that block (list items expand to include nested children) |
| Drag across circles | Select or deselect a range of blocks |
| Tap on a content line | Toggle that block's selection |
| Long-press a selected circle (300 ms) | Enter drag-to-reorder mode |
| Long-press a selected content line (180 ms) | Enter drag-to-reorder mode |

The toolbar appears as soon as at least one block is selected.

### Primary toolbar

Swipe the drawer down (or tap the grabber pill) to exit block mode.

| Button | Action |
|---|---|
| **Format (Aa)** | Open the format drawer |
| **Move Up / Down** | Swap selected blocks with the block above or below |
| **Insert Above / Below** | Insert a blank line and place the cursor there |
| **Edit** | Exit block mode with the cursor placed at the end of the top selected block |
| **Extract Text** | Convert selection to a native text selection and open Note Composer's extract dialog (requires Note Composer core plugin) |
| **Cut** | Cut selected blocks to the clipboard |
| **Copy** | Copy selected blocks to the clipboard |
| **Undo / Redo** | Undo or redo the last block operation |
| **Delete** | Delete selected blocks |

### Format drawer

Swipe down or tap the grabber to return to the primary toolbar.

**Heading / style row** (horizontally scrollable)

Title (H1) · Subtitle (H2) · Heading (H3) · Strong (H4) · Body

**Block type pill**

Bullet list · Numbered list · Checklist · Quote · Code block

**Inline format pill**

Bold · Italic · Strikethrough · Highlight

**Indent pill**

Outdent · Indent

---

## Desktop

### Hover handle

A small widget (`+` and `⋮⋮`) appears in the left margin whenever the mouse is over a block.

| Interaction | Result |
|---|---|
| Click `+` | Insert a blank block below (Shift+click inserts above) |
| Click `⋮⋮` | Select the block and open the context menu |
| Ctrl/Cmd+click `⋮⋮` | Toggle the block into / out of the current selection |
| Shift+click `⋮⋮` | Range-select from the last selected block |
| Drag `⋮⋮` | Drag-to-reorder the selected blocks |
| Click anywhere in content | Exit block mode |

Clicking the `⋮⋮` handle a second time while the menu is open closes the menu and exits block mode.

### Context menu

| Item | Action |
|---|---|
| **Turn into ▶** | Body, H1–H4, Bullet list, Numbered list, Checklist, Quote, Code block |
| **Format ▶** | Bold, Italic, Strikethrough, Highlight, Inline code |
| **Move up / down** | Swap selected blocks with the adjacent block |
| **Indent / Outdent** | Add or remove one level of indentation |
| **Cut / Copy** | Cut or copy selected blocks to the clipboard |
| **Extract text…** | Convert selection to a native text selection and open Note Composer's extract dialog |
| **Delete** | Delete selected blocks |

### Margin drag-to-select

Click and drag in the left margin (outside the text content) to rubber-band select blocks. Dragging toward the top or bottom edge of the editor auto-scrolls.

### Keyboard shortcuts (while in block mode)

| Shortcut | Action |
|---|---|
| Ctrl/Cmd+Z | Undo |
| Ctrl/Cmd+Shift+Z or Ctrl+Y | Redo |
| Ctrl/Cmd+C | Copy selected blocks |
| Ctrl/Cmd+X | Cut selected blocks |
| Ctrl/Cmd+V | Paste |
| Delete or Backspace | Delete selected blocks |

---

## Block drag-to-reorder

Available on both mobile and desktop. Once in reorder mode, drag the blocks vertically — a blue indicator line shows where they will land. Release to drop. The operation is undoable.

Auto-scroll activates when the pointer approaches the top or bottom edge of the editor.

---

## Note Composer integration

The **Extract Text** action (mobile toolbar) and **Extract text…** (desktop context menu) let you move selected blocks into a new or existing note:

1. Select one or more blocks.
2. Tap / click Extract Text.
3. Block mode exits, the selected text range is highlighted natively, and Note Composer's extract dialog opens.

Requires the **Note Composer** core plugin to be enabled in Obsidian settings.

---

## Settings

Open **Settings → Block Editor** to configure:

### Mobile

| Setting | Default | Description |
|---|---|---|
| Reserve right margin for circles | On | Adds 40 px padding to the right side of the editor so selection circles don't overlap text |
| Long-press duration | 800 ms | How long a touch must be held to enter block mode (range: 300–1500 ms) |

### Desktop

| Setting | Default | Description |
|---|---|---|
| Reserve left margin for hover handles | On | Adds 56 px padding to the left of the editor to make room for the `+` and `⋮⋮` widget |

### General

| Setting | Default | Description |
|---|---|---|
| Confirm before deleting blocks | Off | Show a confirmation dialog before deleting selected blocks |
| Show ribbon icon | On | Show the "Toggle Block Mode" grid icon in the left ribbon |

---

## Installation

### From source

```bash
git clone https://github.com/chadrach/obsidian-block-editor.git
cd obsidian-block-editor
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into your vault at `.obsidian/plugins/block-editor/` and enable the plugin in Obsidian settings.

### Development

```bash
npm run dev   # watch mode — rebuilds on file changes
```

---

## Compatibility

- Obsidian 1.4.0 or later
- iOS, Android, and desktop (Windows, macOS, Linux)
- Built on CodeMirror 6 (Obsidian's built-in editor engine)

## License

MIT
