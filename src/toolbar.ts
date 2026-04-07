import { EditorView } from "@codemirror/view";
import { setIcon } from "obsidian";
import { blockSelectionState, toggleBlockMode, setBlockSelection } from "./state";
import {
	moveBlocksUp,
	moveBlocksDown,
	indentBlocks,
	outdentBlocks,
	setHeadingLevel,
	toggleBulletList,
	toggleNumberedList,
	toggleCheckbox,
	toggleQuote,
	toggleInlineFormat,
	toggleCodeFormat,
	deleteBlocks,
	undoAction,
	redoAction,
	copyBlocks,
	cutBlocks,
	progressiveSelectAll,
	insertAbove,
	insertBelow,
	editBlock,
} from "./operations";

export class BlockEditorToolbar {
	el: HTMLElement;
	private view: EditorView | null = null;
	private indentUnit: string;
	private primaryDrawer: HTMLElement;
	private formatDrawer: HTMLElement;
	private showingFormat: boolean = false;

	constructor(indentUnit: string) {
		this.indentUnit = indentUnit;
		this.el = document.createElement("div");
		this.el.className = "block-editor-toolbar";
		this.el.style.display = "none";

		this.primaryDrawer = this.buildPrimaryDrawer();
		this.formatDrawer = this.buildFormatDrawer();

		this.el.appendChild(this.primaryDrawer);
		this.el.appendChild(this.formatDrawer);
	}

	setView(view: EditorView) {
		this.view = view;
	}

	setIndentUnit(unit: string) {
		this.indentUnit = unit;
	}

	private makeCloseButton(action: () => void): HTMLElement {
		const btn = document.createElement("button");
		btn.className = "block-editor-drawer-close";
		btn.setAttribute("aria-label", "Close");
		setIcon(btn, "x");
		btn.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		btn.addEventListener("pointerup", (e) => {
			e.preventDefault();
			e.stopPropagation();
			action();
		});
		return btn;
	}

	private makeSeparator(): HTMLElement {
		const sep = document.createElement("div");
		sep.className = "block-editor-pill-separator";
		return sep;
	}

	private buildPrimaryDrawer(): HTMLElement {
		const drawer = document.createElement("div");
		drawer.className = "block-editor-drawer block-editor-primary-drawer";
		drawer.style.display = "none";

		// X close button — exits block mode
		drawer.appendChild(this.makeCloseButton(() => this.exitBlockMode()));

		// Prevent text selection when tapping on drawer background
		drawer.addEventListener("pointerdown", (e) => {
			if ((e.target as HTMLElement).closest("button")) return;
			e.preventDefault();
		});

		// ── Row 1: (Aa | Up | Down) | (InsertAbove | InsertBelow | Edit) ────
		const row1 = document.createElement("div");
		row1.className = "block-editor-drawer-row";

		const movePill = document.createElement("div");
		movePill.className = "block-editor-format-pill block-editor-format-pill-stretch";
		movePill.appendChild(this.makeButton("case-sensitive", "Format", () => this.openFormatDrawer()));
		movePill.appendChild(this.makeSeparator());
		movePill.appendChild(this.makeButton("arrow-up", "Move Up", () => this.doAction(moveBlocksUp)));
		movePill.appendChild(this.makeButton("arrow-down", "Move Down", () => this.doAction(moveBlocksDown)));
		row1.appendChild(movePill);

		const insertPill = document.createElement("div");
		insertPill.className = "block-editor-format-pill block-editor-format-pill-stretch";
		insertPill.appendChild(this.makeButton("arrow-up-to-line", "Insert Above", () => this.doInsertAbove()));
		insertPill.appendChild(this.makeButton("arrow-down-to-line", "Insert Below", () => this.doInsertBelow()));
		insertPill.appendChild(this.makeButton("pencil", "Edit", () => this.doEditBlock()));
		row1.appendChild(insertPill);

		drawer.appendChild(row1);

		// ── Row 2: (SelectAll | Cut | Copy) | (Undo | Redo | Delete) ──────
		const row2 = document.createElement("div");
		row2.className = "block-editor-drawer-row";

		const clipPill = document.createElement("div");
		clipPill.className = "block-editor-format-pill block-editor-format-pill-stretch";
		clipPill.appendChild(this.makeButton("check-check", "Select All", () => this.doSelectAll()));
		clipPill.appendChild(this.makeButton("scissors", "Cut", () => this.doCut()));
		clipPill.appendChild(this.makeButton("copy", "Copy", () => this.doCopy()));
		row2.appendChild(clipPill);

		const undoPill = document.createElement("div");
		undoPill.className = "block-editor-format-pill block-editor-format-pill-stretch";
		undoPill.appendChild(this.makeButton("undo-2", "Undo", () => this.doUndo()));
		undoPill.appendChild(this.makeButton("redo-2", "Redo", () => this.doRedo()));
		undoPill.appendChild(this.makeSeparator());
		undoPill.appendChild(this.makeButton("trash-2", "Delete", () => this.doDelete(), "block-editor-btn-danger"));
		row2.appendChild(undoPill);

		drawer.appendChild(row2);

		return drawer;
	}

	private buildFormatDrawer(): HTMLElement {
		const drawer = document.createElement("div");
		drawer.className = "block-editor-drawer block-editor-format-drawer";
		drawer.style.display = "none";

		// X close button — returns to primary drawer
		drawer.appendChild(this.makeCloseButton(() => this.closeFormatDrawer()));

		// Prevent text selection when tapping on drawer background
		drawer.addEventListener("pointerdown", (e) => {
			if ((e.target as HTMLElement).closest("button")) return;
			e.preventDefault();
		});

		// "Format" label
		const label = document.createElement("div");
		label.className = "block-editor-format-label";
		label.textContent = "Format";
		drawer.appendChild(label);

		// ── Heading row ───────────────────────────────────────────────────────
		const headingRow = document.createElement("div");
		headingRow.className = "block-editor-format-headings";

		const headings = [
			{ label: "Title", level: 1 },
			{ label: "Subtitle", level: 2 },
			{ label: "Heading", level: 3 },
			{ label: "Strong", level: 4 },
			{ label: "Body", level: 0 },
		];

		for (const h of headings) {
			const btn = document.createElement("button");
			btn.className = `block-editor-heading-btn block-editor-heading-${h.level}`;
			btn.textContent = h.label;

			let downPos: { x: number; y: number } | null = null;
			btn.addEventListener("pointerdown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				downPos = { x: e.clientX, y: e.clientY };
			});
			btn.addEventListener("pointerup", (e) => {
				if (!downPos) return;
				const dx = e.clientX - downPos.x;
				const dy = e.clientY - downPos.y;
				downPos = null;
				if (Math.sqrt(dx * dx + dy * dy) > 10) return;
				e.preventDefault();
				e.stopPropagation();
				const selected = this.getSelectedLines();
				if (selected && this.view) {
					setHeadingLevel(this.view, selected, h.level);
				}
			});
			btn.addEventListener("pointercancel", () => { downPos = null; });
			headingRow.appendChild(btn);
		}

		drawer.appendChild(headingRow);

		// ── List/block row ────────────────────────────────────────────────────
		const listRow = document.createElement("div");
		listRow.className = "block-editor-format-row";

		const listPill = document.createElement("div");
		listPill.className = "block-editor-format-pill block-editor-format-pill-stretch";
		listPill.appendChild(this.makeButton("list", "Bullet List", () => this.doAction(toggleBulletList)));
		listPill.appendChild(this.makeButton("list-ordered", "Numbered List", () => this.doAction(toggleNumberedList)));
		listPill.appendChild(this.makeButton("check-square", "Checklist", () => this.doAction(toggleCheckbox)));
		listPill.appendChild(this.makeButton("text-quote", "Quote", () => this.doAction(toggleQuote)));
		listPill.appendChild(this.makeButton("code", "Code", () => this.doCodeFormat()));
		listRow.appendChild(listPill);
		drawer.appendChild(listRow);

		// ── Inline / indent row ───────────────────────────────────────────────
		const inlineRow = document.createElement("div");
		inlineRow.className = "block-editor-format-row";

		const inlinePill = document.createElement("div");
		inlinePill.className = "block-editor-format-pill block-editor-format-pill-left";
		inlinePill.appendChild(this.makeButton("bold", "Bold", () => this.doInlineFormat("**")));
		inlinePill.appendChild(this.makeButton("italic", "Italic", () => this.doInlineFormat("*")));
		inlinePill.appendChild(this.makeButton("strikethrough", "Strikethrough", () => this.doInlineFormat("~~")));
		inlinePill.appendChild(this.makeButton("highlighter", "Highlight", () => this.doInlineFormat("==")));
		inlineRow.appendChild(inlinePill);

		const indentPill = document.createElement("div");
		indentPill.className = "block-editor-format-pill block-editor-format-pill-right";
		indentPill.appendChild(this.makeButton("outdent", "Outdent", () => this.doOutdent()));
		indentPill.appendChild(this.makeButton("indent", "Indent", () => this.doIndent()));
		inlineRow.appendChild(indentPill);

		drawer.appendChild(inlineRow);

		return drawer;
	}

	private makeButton(icon: string, title: string, action: () => void, className?: string): HTMLElement {
		const btn = document.createElement("button");
		btn.setAttribute("aria-label", title);
		btn.title = title;
		if (className) btn.classList.add(className);
		setIcon(btn, icon);

		let downPos: { x: number; y: number } | null = null;

		btn.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			downPos = { x: e.clientX, y: e.clientY };
		});

		btn.addEventListener("pointerup", (e) => {
			if (!downPos) return;
			const dx = e.clientX - downPos.x;
			const dy = e.clientY - downPos.y;
			downPos = null;
			if (Math.sqrt(dx * dx + dy * dy) > 10) return;
			e.preventDefault();
			e.stopPropagation();
			action();
		});

		btn.addEventListener("pointercancel", () => { downPos = null; });

		return btn;
	}

	// ── Drawer open/close ──────────────────────────────────────────────────

	private openFormatDrawer() {
		this.showingFormat = true;
		this.primaryDrawer.style.display = "none";
		this.formatDrawer.style.display = "flex";
	}

	private closeFormatDrawer() {
		this.showingFormat = false;
		this.formatDrawer.style.display = "none";
		this.primaryDrawer.style.display = "flex";
	}

	private exitBlockMode() {
		if (!this.view) return;
		this.view.dispatch({ effects: [toggleBlockMode.of(false)] });
	}

	// ── Visibility ─────────────────────────────────────────────────────────

	show() {
		this.el.style.display = "flex";
		if (this.showingFormat) {
			this.primaryDrawer.style.display = "none";
			this.formatDrawer.style.display = "flex";
		} else {
			this.primaryDrawer.style.display = "flex";
			this.formatDrawer.style.display = "none";
		}
	}

	hide() {
		this.el.style.display = "none";
		this.showingFormat = false;
	}

	destroy() {
		this.el.remove();
	}

	updateVisibility(active: boolean, hasSelection: boolean) {
		if (active && hasSelection) {
			this.show();
		} else {
			this.hide();
		}
	}

	// ── Action helpers ─────────────────────────────────────────────────────

	private getSelectedLines(): Set<number> | null {
		if (!this.view) return null;
		const state = this.view.state.field(blockSelectionState);
		if (!state.active || state.selectedBlocks.size === 0) return null;
		return state.selectedBlocks;
	}

	private doAction(fn: (view: EditorView, selected: Set<number>) => void) {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		fn(this.view, selected);
	}

	private doIndent() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		indentBlocks(this.view, selected, this.indentUnit);
	}

	private doOutdent() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		outdentBlocks(this.view, selected, this.indentUnit);
	}

	private doDelete() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		deleteBlocks(this.view, selected);
	}

	private doCopy() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		copyBlocks(this.view, selected);
	}

	private doCut() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		cutBlocks(this.view, selected);
	}

	private doSelectAll() {
		if (!this.view) return;
		const state = this.view.state.field(blockSelectionState);
		progressiveSelectAll(this.view, state.selectedBlocks);
	}

	private doInlineFormat(marker: string) {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		toggleInlineFormat(this.view, selected, marker);
	}

	private doCodeFormat() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		toggleCodeFormat(this.view, selected);
	}

	private doUndo() {
		if (!this.view) return;
		undoAction(this.view);
	}

	private doRedo() {
		if (!this.view) return;
		redoAction(this.view);
	}

	private doInsertAbove() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		insertAbove(this.view, selected);
	}

	private doInsertBelow() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		insertBelow(this.view, selected);
	}

	private doEditBlock() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		editBlock(this.view, selected);
	}
}
