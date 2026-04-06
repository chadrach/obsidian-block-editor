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
	padding: 6px 10px;
	padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px));
	pointer-events: none;
}

/* Hide Obsidian's native bottom toolbar when block editor toolbar is visible */
body.block-editor-active .workspace-drawer.mod-left,
body.block-editor-active .mobile-toolbar,
body.block-editor-active .workspace-tab-header-container {
	display: none !important;
}

/* Primary pill — wide floating bar matching Obsidian's native tab bar */
.block-editor-pill {
	display: flex;
	align-items: center;
	justify-content: space-evenly;
	width: 100%;
	max-width: 500px;
	padding: 4px 8px;
	border-radius: 100px;
	background: var(--background-secondary);
	border: 1px solid var(--background-modifier-border);
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

/* All buttons inside toolbar — borderless, no background, icon-only */
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

/* Icons in primary pill */
.block-editor-pill button .svg-icon {
	width: 24px;
	height: 24px;
	color: inherit;
	stroke: currentColor;
}

/* Default icon size for format popup buttons */
.block-editor-toolbar button .svg-icon {
	width: 20px;
	height: 20px;
	color: inherit;
	stroke: currentColor;
}

/* Format popup — large rounded panel matching Apple Notes style */
.block-editor-format-popup {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 16px 16px 18px;
	border-radius: 38px;
	background: var(--background-secondary);
	border: 1px solid var(--background-modifier-border);
	width: 100%;
	max-width: 500px;
	pointer-events: auto;
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
	gap: 8px;
	align-items: center;
}

/* Inner pills within format popup — dark rounded-rect groups */
.block-editor-format-pill {
	display: flex;
	align-items: center;
	gap: 2px;
	padding: 3px;
	border-radius: 14px;
	background: var(--background-primary);
	flex: 1;
}

.block-editor-format-pill button {
	min-width: 0;
	flex: 1;
	height: 44px;
	border-radius: 11px !important;
	background: var(--background-modifier-hover) !important;
}

.block-editor-format-pill button:active {
	background: var(--interactive-accent) !important;
	color: var(--text-on-accent) !important;
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
