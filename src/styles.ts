/**
 * Injects the Block Editor styles into the document head.
 */
export function injectStyles(): HTMLStyleElement {
	const style = document.createElement("style");
	style.id = "block-editor-styles";
	style.textContent = `
/* Gutter: invisible wrapper on document.body */
.block-editor-gutter {
	position: fixed;
	top: 0;
	left: 0;
	width: 0;
	height: 0;
	z-index: 5;
	pointer-events: none;
}

/* Each circle is position:fixed with its own top/left.
   The element is wider than the visual circle for a bigger tap target. */
.block-editor-gutter-circle {
	position: fixed;
	width: 44px;
	height: 28px;
	cursor: pointer;
	pointer-events: auto;
	z-index: 5;
	background: transparent;
	border: none;
	box-sizing: border-box;
	display: flex;
	align-items: center;
	justify-content: flex-start;
}

.block-editor-gutter-circle::before {
	content: "";
	width: 20px;
	height: 20px;
	border-radius: 50%;
	border: 2px solid var(--interactive-accent);
	background: var(--background-primary);
	transition: background-color 0.15s ease, transform 0.1s ease;
	box-sizing: border-box;
	flex-shrink: 0;
}

.block-editor-gutter-circle:active::before {
	transform: scale(0.9);
}

.block-editor-gutter-circle.selected::before {
	background: var(--interactive-accent);
}

/* Line highlight decoration — uses the native text selection color */
.cm-line.block-editor-selected-line {
	background-color: var(--text-selection, rgba(72, 120, 208, 0.15)) !important;
}

/* Toolbar container — floats above content, positioned to replace Obsidian's bottom bar */
.block-editor-toolbar {
	position: fixed;
	bottom: 0;
	left: 0;
	right: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	z-index: 100;
	pointer-events: none;
}

/* Hide Obsidian's native bottom toolbar when block editor toolbar is visible */
body.block-editor-active .workspace-drawer.mod-left,
body.block-editor-active .mobile-toolbar,
body.block-editor-active .workspace-tab-header-container {
	display: none !important;
}

/* Primary pill — button color background, themed border */
.block-editor-pill {
	display: flex;
	align-items: center;
	width: 85%;
	max-width: 500px;
	padding: 3px 6px;
	gap: 3px;
	margin-bottom: max(8px, env(safe-area-inset-bottom, 0px));
	border-radius: 100px;
	background: var(--interactive-normal, var(--background-secondary));
	border: 1px solid var(--background-modifier-border);
	color: var(--text-normal);
	pointer-events: auto;
	overflow-x: auto;
	-webkit-overflow-scrolling: touch;
	scrollbar-width: none;
}

.block-editor-pill::-webkit-scrollbar {
	display: none;
}

/* Vertical separator inside pill */
.block-editor-pill-separator {
	width: 1px;
	height: 24px;
	background: var(--text-faint);
	opacity: 0.3;
	flex-shrink: 0;
	margin: 0 2px;
}

/* All buttons inside toolbar — borderless, icon-only */
.block-editor-toolbar button {
	display: flex;
	align-items: center;
	justify-content: center;
	min-width: 40px;
	height: 40px;
	border: none !important;
	outline: none !important;
	border-radius: 10px;
	background: transparent !important;
	box-shadow: none !important;
	color: var(--text-normal);
	cursor: pointer;
	padding: 0;
	touch-action: manipulation;
	flex-shrink: 0;
	-webkit-appearance: none;
	appearance: none;
}

.block-editor-toolbar button:active {
	background: var(--background-modifier-hover) !important;
}

.block-editor-toolbar button.block-editor-btn-danger {
	color: var(--text-error);
}

.block-editor-toolbar button.block-editor-btn-danger:active {
	background: rgba(255, 59, 48, 0.12) !important;
}

/* Default icon size for format popup buttons */
.block-editor-toolbar button .svg-icon {
	width: 20px;
	height: 20px;
	color: inherit;
	stroke: currentColor;
}

/* Icons in primary pill — larger, must come after default to override */
.block-editor-pill button .svg-icon {
	width: 26px;
	height: 26px;
}

/* Format popup — sidebar color background, themed border */
.block-editor-format-popup {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 16px 16px 18px;
	border-radius: 40px;
	background: var(--background-secondary);
	border: 1px solid var(--background-modifier-border);
	color: var(--text-normal);
	width: calc(100% - 16px);
	max-width: 500px;
	margin-bottom: max(8px, env(safe-area-inset-bottom, 0px));
	pointer-events: auto;
}

/* Baseline / Cupertino liquid-glass support:
   When these themes are active, the liquid-glass class provides
   their translucent backdrop-filter styling. We add the class
   in toolbar.ts so themes can opt in. */
.block-editor-pill.liquid-glass,
.block-editor-format-popup.liquid-glass {
	/* Theme provides: backdrop-filter, background-color, box-shadow, border */
}

/* Format popup header */
.block-editor-format-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 6px 0;
}

.block-editor-format-label {
	font-size: 20px;
	font-weight: 700;
	color: var(--text-normal);
}

.block-editor-format-close {
	min-width: 36px !important;
	height: 36px !important;
	border-radius: 50% !important;
}

.block-editor-format-close .svg-icon {
	width: 20px !important;
	height: 20px !important;
}

/* Heading row — plain text buttons, horizontally scrollable */
.block-editor-format-headings {
	display: flex;
	gap: 0;
	overflow-x: auto;
	-webkit-overflow-scrolling: touch;
	scrollbar-width: none;
	padding: 0 4px;
}

.block-editor-format-headings::-webkit-scrollbar {
	display: none;
}

.block-editor-heading-btn {
	display: flex;
	align-items: center;
	justify-content: flex-start;
	border: none !important;
	outline: none !important;
	background: transparent !important;
	box-shadow: none !important;
	cursor: pointer;
	padding: 8px 12px !important;
	border-radius: 8px !important;
	color: var(--text-normal);
	white-space: nowrap;
	touch-action: manipulation;
	flex-shrink: 0;
	font-family: var(--font-text);
	height: auto !important;
	min-height: 40px;
	-webkit-appearance: none;
	appearance: none;
}

.block-editor-heading-btn:active {
	background: var(--background-modifier-hover) !important;
}

/* Heading sizes — progressively smaller to show hierarchy */
.block-editor-heading-1 {
	font-size: 24px;
	font-weight: 700;
}

.block-editor-heading-2 {
	font-size: 19px;
	font-weight: 700;
}

.block-editor-heading-3 {
	font-size: 16px;
	font-weight: 600;
}

.block-editor-heading-4 {
	font-size: 14px;
	font-weight: 400;
}

.block-editor-heading-0 {
	font-size: 14px;
	font-weight: 400;
	color: var(--text-muted);
}

/* Format rows */
.block-editor-format-row {
	display: flex;
	gap: 6px;
	align-items: center;
	width: 100%;
}

/* Inner pills within format popup — button color background, no border */
.block-editor-format-pill {
	display: flex;
	align-items: center;
	gap: 2px;
	padding: 2px;
	border-radius: 100px;
	background: var(--interactive-normal, var(--background-modifier-hover));
	border: none;
}

.block-editor-format-pill button {
	min-width: 40px;
	height: 40px;
	border-radius: 100px !important;
}

/* Row 3 pill sizing: left pill (4 buttons) = flex 2, right pill (2 buttons) = flex 1 */
.block-editor-format-pill-left {
	flex: 2;
}

.block-editor-format-pill-left button {
	flex: 1;
	min-width: 0;
}

.block-editor-format-pill-right {
	flex: 1;
}

.block-editor-format-pill-right button {
	flex: 1;
	min-width: 0;
}

/* Stretch pill fills its full row (used for single-pill rows like list row) */
.block-editor-format-pill-stretch {
	flex: 1;
}

.block-editor-format-pill-stretch button {
	flex: 1;
	min-width: 0;
}

.block-editor-format-pill button .svg-icon {
	width: 20px;
	height: 20px;
}

/* FAB */
.block-editor-fab {
	position: fixed;
	bottom: calc(60px + env(safe-area-inset-bottom, 0px));
	right: 16px;
	width: 48px;
	height: 48px;
	border-radius: 50%;
	background: var(--interactive-accent);
	color: var(--text-on-accent);
	border: none;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 50;
	touch-action: manipulation;
	transition: transform 0.15s ease;
}

.block-editor-fab:active {
	transform: scale(0.9);
}

.block-editor-fab .svg-icon {
	width: 22px;
	height: 22px;
	color: inherit;
	stroke: currentColor;
}

.block-editor-fab.toolbar-visible {
	bottom: calc(80px + env(safe-area-inset-bottom, 0px));
}

.block-editor-fab.active {
	background: var(--text-error);
}
`;
	document.head.appendChild(style);
	return style;
}

export function removeStyles(): void {
	const el = document.getElementById("block-editor-styles");
	if (el) el.remove();
}
