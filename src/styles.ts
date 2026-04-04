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

/* Each circle is position:fixed with its own top/left */
.block-editor-gutter-circle {
	position: fixed;
	width: 20px;
	height: 20px;
	border-radius: 50%;
	border: 2px solid var(--interactive-accent);
	background: var(--background-primary);
	cursor: pointer;
	pointer-events: auto;
	transition: background-color 0.15s ease, transform 0.1s ease;
	box-sizing: border-box;
	z-index: 5;
}

.block-editor-gutter-circle:active {
	transform: scale(0.9);
}

.block-editor-gutter-circle.selected {
	background: var(--interactive-accent);
}

/* Line highlight decoration */
.cm-line.block-editor-selected-line {
	background-color: rgba(72, 120, 208, 0.15) !important;
}

/* Toolbar — 2 rows */
.block-editor-toolbar {
	position: fixed;
	bottom: 0;
	left: 0;
	right: 0;
	background: var(--background-primary);
	border-top: 1px solid var(--background-modifier-border);
	display: flex;
	flex-direction: column;
	align-items: center;
	padding: 4px 8px;
	padding-bottom: calc(4px + env(safe-area-inset-bottom, 0px));
	z-index: 100;
	box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
}

.block-editor-toolbar-row {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 2px;
	width: 100%;
	padding: 2px 0;
}

.block-editor-toolbar button {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 36px;
	height: 36px;
	border: none;
	border-radius: var(--radius-s);
	background: var(--background-secondary);
	color: var(--text-normal);
	cursor: pointer;
	padding: 0;
	touch-action: manipulation;
	flex-shrink: 0;
}

.block-editor-toolbar button:active {
	background: var(--interactive-accent);
	color: var(--text-on-accent);
}

.block-editor-toolbar button.block-editor-btn-danger {
	color: var(--text-error);
}

.block-editor-toolbar button.block-editor-btn-danger:active {
	background: var(--text-error);
	color: var(--text-on-accent);
}

.block-editor-toolbar button .svg-icon {
	width: 18px;
	height: 18px;
}

.block-editor-toolbar-separator {
	width: 1px;
	height: 24px;
	background: var(--background-modifier-border);
	margin: 0 2px;
	flex-shrink: 0;
}

/* Heading popup */
.block-editor-heading-popup {
	position: fixed;
	background: var(--background-primary);
	border: 1px solid var(--background-modifier-border);
	border-radius: var(--radius-s);
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	z-index: 200;
	display: flex;
	flex-direction: column;
	padding: 4px;
}

.block-editor-heading-popup button {
	display: flex;
	align-items: center;
	justify-content: flex-start;
	padding: 6px 12px;
	border: none;
	background: transparent;
	color: var(--text-normal);
	cursor: pointer;
	border-radius: var(--radius-s);
	font-size: 14px;
	touch-action: manipulation;
	width: auto;
}

.block-editor-heading-popup button:active {
	background: var(--interactive-accent);
	color: var(--text-on-accent);
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
}

.block-editor-fab.toolbar-visible {
	bottom: calc(100px + env(safe-area-inset-bottom, 0px));
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
