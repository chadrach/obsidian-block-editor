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

/* Toolbar container — floats above content */
.block-editor-toolbar {
	position: fixed;
	bottom: calc(12px + env(safe-area-inset-bottom, 0px));
	left: 50%;
	transform: translateX(-50%);
	display: flex;
	flex-direction: column;
	align-items: center;
	z-index: 100;
	max-width: calc(100% - 24px);
}

/* Primary pill — single floating bar */
.block-editor-pill {
	display: flex;
	align-items: center;
	gap: 2px;
	padding: 6px 8px;
	border-radius: 100px;
	background: var(--background-secondary);
	box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15), 0 0 0 0.5px rgba(0, 0, 0, 0.06);
	-webkit-backdrop-filter: blur(20px);
	backdrop-filter: blur(20px);
}

/* All buttons inside toolbar — borderless icon-only */
.block-editor-toolbar button {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 40px;
	height: 40px;
	border: none;
	border-radius: 50%;
	background: transparent;
	color: var(--text-normal);
	cursor: pointer;
	padding: 0;
	touch-action: manipulation;
	flex-shrink: 0;
	transition: background-color 0.1s ease;
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
	width: 20px;
	height: 20px;
	color: inherit;
	stroke: currentColor;
}

/* Format popup — replaces primary pill */
.block-editor-format-popup {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 10px 12px;
	border-radius: 16px;
	background: var(--background-secondary);
	box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15), 0 0 0 0.5px rgba(0, 0, 0, 0.06);
	-webkit-backdrop-filter: blur(20px);
	backdrop-filter: blur(20px);
	width: max-content;
	max-width: 100%;
}

/* Format popup header */
.block-editor-format-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 4px 4px 4px;
}

.block-editor-format-label {
	font-size: 13px;
	font-weight: 600;
	color: var(--text-muted);
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.block-editor-format-close {
	width: 28px !important;
	height: 28px !important;
}

.block-editor-format-close .svg-icon {
	width: 16px !important;
	height: 16px !important;
}

/* Heading row — styled text buttons, scrollable */
.block-editor-format-headings {
	display: flex;
	gap: 4px;
	overflow-x: auto;
	-webkit-overflow-scrolling: touch;
	scrollbar-width: none;
	padding: 2px 0;
}

.block-editor-format-headings::-webkit-scrollbar {
	display: none;
}

.block-editor-heading-btn {
	border: none;
	background: transparent;
	cursor: pointer;
	padding: 6px 12px;
	border-radius: 8px;
	color: var(--text-normal);
	white-space: nowrap;
	touch-action: manipulation;
	flex-shrink: 0;
	font-family: var(--font-text);
	transition: background-color 0.1s ease;
}

.block-editor-heading-btn:active {
	background: var(--background-modifier-hover);
}

/* Heading sizes — scaled to show relative hierarchy */
.block-editor-heading-1 {
	font-size: 22px;
	font-weight: 700;
}

.block-editor-heading-2 {
	font-size: 18px;
	font-weight: 600;
}

.block-editor-heading-3 {
	font-size: 16px;
	font-weight: 600;
}

.block-editor-heading-4 {
	font-size: 14px;
	font-weight: 700;
}

.block-editor-heading-0 {
	font-size: 14px;
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
	gap: 2px;
	padding: 2px;
	border-radius: 100px;
	background: var(--background-primary);
}

.block-editor-format-pill button {
	width: 36px;
	height: 36px;
}

.block-editor-format-pill button .svg-icon {
	width: 18px;
	height: 18px;
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
