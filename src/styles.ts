/**
 * Injects the Block Editor styles into the document head.
 */
export function injectStyles(): HTMLStyleElement {
	const style = document.createElement("style");
	style.id = "block-editor-styles";
	style.textContent = `
/* Block Editor Gutter — absolute child of .cm-editor */
.block-editor-gutter {
	position: absolute;
	top: 0;
	right: 0;
	bottom: 0;
	width: 0;
	z-index: 100;
	pointer-events: none;
	overflow: visible;
}

.block-editor-gutter-circle {
	position: absolute;
	width: 20px;
	height: 20px;
	border-radius: 50%;
	border: 2px solid var(--interactive-accent);
	background: var(--background-primary);
	cursor: pointer;
	pointer-events: auto;
	transition: background-color 0.15s ease, transform 0.1s ease;
	box-sizing: border-box;
}

.block-editor-gutter-circle:active {
	transform: scale(0.9);
}

.block-editor-gutter-circle.selected {
	background: var(--interactive-accent);
}

/* Block Highlighting */
.block-editor-highlight {
	background-color: var(--interactive-accent);
	opacity: 1;
}

.block-editor-highlight .cm-line {
	background-color: rgba(var(--interactive-accent-rgb, 72, 120, 208), 0.15) !important;
}

/* Toolbar */
.block-editor-toolbar {
	position: fixed;
	bottom: 0;
	left: 0;
	right: 0;
	background: var(--background-primary);
	border-top: 1px solid var(--background-modifier-border);
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: center;
	gap: 2px;
	padding: 6px 8px;
	padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px));
	z-index: 100;
	box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
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
}

.block-editor-toolbar button:active {
	background: var(--interactive-accent);
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
	margin: 0 4px;
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

.block-editor-fab.active {
	background: var(--text-error);
}

/* Line highlight decoration */
.cm-line.block-editor-selected-line {
	background-color: hsla(var(--interactive-accent-hsl), 0.15) !important;
}

/* Override for themes that don't have --interactive-accent-hsl */
.cm-line.block-editor-selected-line {
	background-color: rgba(72, 120, 208, 0.15) !important;
}

`;
	document.head.appendChild(style);
	return style;
}

export function removeStyles(): void {
	const el = document.getElementById("block-editor-styles");
	if (el) el.remove();
}
