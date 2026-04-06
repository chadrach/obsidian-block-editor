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

/* Line highlight decoration */
.cm-line.block-editor-selected-line {
	background-color: rgba(72, 120, 208, 0.15) !important;
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
	padding: 8px 12px;
	padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
	pointer-events: none;
}

/* Hide Obsidian's native bottom toolbar when block editor toolbar is visible */
body.block-editor-active .workspace-drawer.mod-left,
body.block-editor-active .mobile-toolbar,
body.block-editor-active .workspace-tab-header-container {
	display: none !important;
}

/* Primary pill — single floating bar */
.block-editor-pill {
	display: flex;
	align-items: center;
	justify-content: space-evenly;
	width: 100%;
	max-width: 460px;
	padding: 4px 6px;
	border-radius: 100px;
	background: var(--background-secondary);
	box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15), 0 0 0 0.5px rgba(0, 0, 0, 0.06);
	-webkit-backdrop-filter: blur(20px);
	backdrop-filter: blur(20px);
	pointer-events: auto;
}

/* All buttons inside toolbar — borderless, no background, icon-only */
.block-editor-toolbar button {
	display: flex;
	align-items: center;
	justify-content: center;
	min-width: 44px;
	height: 44px;
	border: none;
	border-radius: 10px;
	background: transparent;
	color: var(--text-normal);
	cursor: pointer;
	padding: 0;
	touch-action: manipulation;
	flex-shrink: 0;
}

.block-editor-toolbar button:active {
	background: var(--background-modifier-hover);
}

.block-editor-toolbar button.block-editor-btn-danger {
	color: var(--text-error);
}

.block-editor-toolbar button.block-editor-btn-danger:active {
	background: rgba(255, 59, 48, 0.12);
}

.block-editor-toolbar button .svg-icon {
	width: 22px;
	height: 22px;
	color: inherit;
	stroke: currentColor;
}

/* Format popup — replaces primary pill */
.block-editor-format-popup {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 10px 14px 12px;
	border-radius: 16px;
	background: var(--background-secondary);
	box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15), 0 0 0 0.5px rgba(0, 0, 0, 0.06);
	-webkit-backdrop-filter: blur(20px);
	backdrop-filter: blur(20px);
	width: 100%;
	max-width: 460px;
	pointer-events: auto;
}

/* Format popup header */
.block-editor-format-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 2px 2px;
}

.block-editor-format-label {
	font-size: 13px;
	font-weight: 600;
	color: var(--text-muted);
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.block-editor-format-close {
	min-width: 32px !important;
	height: 32px !important;
	border-radius: 50% !important;
}

.block-editor-format-close .svg-icon {
	width: 16px !important;
	height: 16px !important;
}

/* Heading row — styled text buttons, equal width, scrollable if needed */
.block-editor-format-headings {
	display: flex;
	gap: 0;
	overflow-x: auto;
	-webkit-overflow-scrolling: touch;
	scrollbar-width: none;
	padding: 2px 0;
}

.block-editor-format-headings::-webkit-scrollbar {
	display: none;
}

.block-editor-heading-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	border: none !important;
	background: transparent !important;
	cursor: pointer;
	padding: 8px 4px !important;
	border-radius: 8px !important;
	color: var(--text-normal);
	white-space: nowrap;
	touch-action: manipulation;
	flex: 1;
	min-width: 0;
	font-family: var(--font-text);
	height: auto !important;
	min-height: 44px;
}

.block-editor-heading-btn:active {
	background: var(--background-modifier-hover) !important;
}

/* Heading sizes — scaled to show relative hierarchy */
.block-editor-heading-1 {
	font-size: 20px;
	font-weight: 700;
}

.block-editor-heading-2 {
	font-size: 17px;
	font-weight: 600;
}

.block-editor-heading-3 {
	font-size: 15px;
	font-weight: 600;
}

.block-editor-heading-4 {
	font-size: 13px;
	font-weight: 700;
}

.block-editor-heading-0 {
	font-size: 13px;
	font-weight: 400;
}

/* Format rows */
.block-editor-format-row {
	display: flex;
	gap: 8px;
	align-items: center;
}

/* Inner pills within format popup */
.block-editor-format-pill {
	display: flex;
	align-items: center;
	gap: 0;
	padding: 2px;
	border-radius: 100px;
	background: var(--background-primary);
	flex: 1;
}

.block-editor-format-pill button {
	min-width: 0;
	flex: 1;
	height: 40px;
	border-radius: 100px !important;
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
