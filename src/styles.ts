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
	background-color: var(--text-selection) !important;
}

/* Toolbar container — full-width fixed at screen bottom */
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

/* ── Drawer base — styled like the old format popup ──────────────────────── */
.block-editor-drawer {
	width: calc(100% - 16px);
	max-width: 500px;
	background: var(--background-secondary);
	border-radius: 40px;
	border: 1px solid var(--background-modifier-border);
	padding: 12px 16px calc(18px + env(safe-area-inset-bottom, 0px));
	display: flex;
	flex-direction: column;
	gap: 10px;
	pointer-events: auto;
	margin-bottom: max(8px, env(safe-area-inset-bottom, 0px));
	color: var(--text-normal);
	box-sizing: border-box;
}

.theme-dark .block-editor-drawer {
	background: var(--interactive-normal, var(--background-secondary));
}

/* Drag handle — centered bar at top of drawer */
.block-editor-drag-handle {
	width: 72px;
	height: 5px;
	background: var(--text-faint);
	border-radius: 3px;
	margin: 0 auto 4px;
	opacity: 0.5;
	flex-shrink: 0;
	cursor: pointer;
}

/* Row of buttons within a drawer */
.block-editor-drawer-row {
	display: flex;
	gap: 6px;
	align-items: center;
	width: 100%;
}

/* Format label in format drawer header area */
.block-editor-format-label {
	font-size: 20px;
	font-weight: 700;
	color: var(--text-normal);
	padding: 0 6px;
}

/* ── All toolbar buttons ─────────────────────────────────────────────────── */
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

/* Default icon size (format drawer) */
.block-editor-toolbar button .svg-icon {
	width: 20px;
	height: 20px;
	color: inherit;
	stroke: currentColor;
}

/* Larger icons in the primary drawer — must come after default rule */
.block-editor-primary-drawer button .svg-icon {
	width: 26px;
	height: 26px;
}

/* Primary drawer standalone buttons fill their row slot */
.block-editor-primary-drawer .block-editor-drawer-row > button {
	flex: 1;
	min-width: 0;
}

/* ── Inner pills (used in both drawers) ─────────────────────────────────── */
.block-editor-format-pill {
	display: flex;
	align-items: center;
	gap: 2px;
	padding: 2px;
	border-radius: 100px;
	background: var(--background-secondary);
	border: none;
}

.theme-dark .block-editor-format-pill {
	background: var(--interactive-normal, var(--background-modifier-hover));
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

/* Stretch pill fills its full row */
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

/* ── Heading row (format drawer) ─────────────────────────────────────────── */
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

/* ── Format rows (format drawer) ─────────────────────────────────────────── */
.block-editor-format-row {
	display: flex;
	gap: 6px;
	align-items: center;
	width: 100%;
}
`;
	document.head.appendChild(style);
	return style;
}

export function removeStyles(): void {
	const el = document.getElementById("block-editor-styles");
	if (el) el.remove();
}
