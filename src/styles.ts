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
	transition: box-shadow 140ms ease, filter 140ms ease;
}

/* "Picked up" cue: accent-colored inset left stripe + strong shadow.
   Inset box-shadow for the stripe is layout-neutral (no border-left shift).
   Works in both light and dark themes because it uses the accent color. */
body.block-editor-reorder-active .cm-line.block-editor-selected-line {
	box-shadow:
		4px 0 0 0 var(--interactive-accent) inset,
		0 6px 24px rgba(0, 0, 0, 0.40),
		0 1px 4px rgba(0, 0, 0, 0.20);
	filter: brightness(1.15);
}

/* Selected circles also scale up to reinforce the "grabbed" state */
body.block-editor-reorder-active .block-editor-gutter-circle.selected::before {
	transform: scale(1.35);
	box-shadow: 0 0 0 4px color-mix(in srgb, var(--interactive-accent) 30%, transparent);
	transition: transform 140ms ease, box-shadow 140ms ease;
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
body.block-editor-active .mobile-toolbar {
	display: none !important;
}

/* ── Drawer base ─────────────────────────────────────────────────────────── */
.block-editor-drawer {
	width: 100%;
	max-width: 500px;
	background: var(--background-secondary);
	border-radius: 38px 38px 0 0;
	border: none;
	padding: 18px 16px calc(16px + env(safe-area-inset-bottom, 0px));
	display: flex;
	flex-direction: column;
	gap: 10px;
	pointer-events: auto;
	color: var(--text-normal);
	box-sizing: border-box;
	position: relative;
	touch-action: pan-x;
	will-change: transform;
}

/* Grabber — small rounded pill at the top of each drawer */
.block-editor-drawer-grabber {
	width: 40px;
	height: 5px;
	border-radius: 3px;
	background: var(--text-faint);
	opacity: 0.55;
	margin: 0 auto 4px;
	flex-shrink: 0;
}

/* Row of buttons within a drawer */
.block-editor-drawer-row {
	display: flex;
	gap: 6px;
	align-items: center;
	width: 100%;
}

/* Vertical separator inside a pill */
.block-editor-pill-separator {
	width: 1px;
	height: 24px;
	background: var(--text-faint);
	opacity: 0.4;
	flex-shrink: 0;
}

/* Format label — positioned absolutely to match close button alignment */
.block-editor-format-label {
	font-size: 20px;
	font-weight: 700;
	color: var(--text-normal);
	padding: 2px 12px 2px;
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

/* ── Inner pills (used in both drawers) ──────────────────────────────────── */
.block-editor-format-pill {
	display: flex;
	align-items: center;
	gap: 2px;
	padding: 2px;
	border-radius: 100px;
	background: var(--background-secondary-alt, var(--background-modifier-hover));
	border: none;
	position: relative;
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
	font-weight: 700;
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

/* ── Drop indicator for reorder drag ───────────────────────────────────── */
.block-editor-drop-indicator {
	position: fixed;
	left: 16px;
	right: 16px;
	height: 3px;
	background: var(--interactive-accent);
	border-radius: 2px;
	z-index: 10;
	pointer-events: none;
	opacity: 0.8;
}

/* ── Margin drag selection box (desktop) ───────────────────────────────── */
.block-editor-margin-select {
	position: fixed;
	background: var(--text-selection);
	border: 1.5px solid var(--interactive-accent);
	pointer-events: none;
	z-index: 50;
	border-radius: 3px;
}
`;
	document.head.appendChild(style);
	return style;
}

export function removeStyles(): void {
	const el = document.getElementById("block-editor-styles");
	if (el) el.remove();
}
