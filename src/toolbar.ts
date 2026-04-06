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
} from "./operations";

export class BlockEditorToolbar {
	el: HTMLElement;
	private view: EditorView | null = null;
	private indentUnit: string;
	private primaryPill: HTMLElement;
	private formatPopup: HTMLElement;
	private showingFormat: boolean = false;

	constructor(indentUnit: string) {
		this.indentUnit = indentUnit;
		this.el = document.createElement("div");
		this.el.className = "block-editor-toolbar";
		this.el.style.display = "none";

		this.primaryPill = this.buildPrimaryPill();
		this.formatPopup = this.buildFormatPopup();

		this.el.appendChild(this.primaryPill);
		this.el.appendChild(this.formatPopup);

		this.el.addEventListener("pointerdown", (e) => e.preventDefault());
	}

	setView(view: EditorView) {
		this.view = view;
	}

	setIndentUnit(unit: string) {
		this.indentUnit = unit;
	}

	private buildPrimaryPill(): HTMLElement {
		const pill = document.createElement("div");
		pill.className = "block-editor-pill";

		const buttons: Array<{ icon: string; title: string; action: () => void; className?: string }> = [
			{ icon: "case-sensitive", title: "Format", action: () => this.toggleFormatPopup() },
			{ icon: "undo-2", title: "Undo", action: () => this.doUndo() },
			{ icon: "redo-2", title: "Redo", action: () => this.doRedo() },
			{ icon: "arrow-up", title: "Move Up", action: () => this.doAction(moveBlocksUp) },
			{ icon: "arrow-down", title: "Move Down", action: () => this.doAction(moveBlocksDown) },
			{ icon: "check-check", title: "Select All", action: () => this.doSelectAll() },
			{ icon: "scissors", title: "Cut", action: () => this.doCut() },
			{ icon: "copy", title: "Copy", action: () => this.doCopy() },
			{ icon: "trash-2", title: "Delete", action: () => this.doDelete(), className: "block-editor-btn-danger" },
		];

		for (const btn of buttons) {
			const el = this.makeButton(btn.icon, btn.title, btn.action, btn.className);
			pill.appendChild(el);
		}

		return pill;
	}

	private buildFormatPopup(): HTMLElement {
		const popup = document.createElement("div");
		popup.className = "block-editor-format-popup";
		popup.style.display = "none";

		// Header row: "Format" label + X close button
		const header = document.createElement("div");
		header.className = "block-editor-format-header";

		const label = document.createElement("span");
		label.className = "block-editor-format-label";
		label.textContent = "Format";
		header.appendChild(label);

		const closeBtn = document.createElement("button");
		closeBtn.className = "block-editor-format-close";
		closeBtn.setAttribute("aria-label", "Close");
		setIcon(closeBtn, "x");
		closeBtn.addEventListener("pointerup", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.toggleFormatPopup();
		});
		header.appendChild(closeBtn);

		popup.appendChild(header);

		// Row 1: Heading styles (styled text, horizontally scrollable)
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

		popup.appendChild(headingRow);

		// Row 2: List/block types in a pill
		const listRow = document.createElement("div");
		listRow.className = "block-editor-format-row";

		const listPill = document.createElement("div");
		listPill.className = "block-editor-format-pill";

		const listButtons = [
			{ icon: "list", title: "Bullet List", action: () => this.doAction(toggleBulletList) },
			{ icon: "list-ordered", title: "Numbered List", action: () => this.doAction(toggleNumberedList) },
			{ icon: "check-square", title: "Checklist", action: () => this.doAction(toggleCheckbox) },
			{ icon: "text-quote", title: "Quote", action: () => this.doAction(toggleQuote) },
			{ icon: "code", title: "Code", action: () => this.doCodeFormat() },
		];

		for (const btn of listButtons) {
			listPill.appendChild(this.makeButton(btn.icon, btn.title, btn.action));
		}

		listRow.appendChild(listPill);
		popup.appendChild(listRow);

		// Row 3: Inline formatting pill + Indent pill
		const inlineRow = document.createElement("div");
		inlineRow.className = "block-editor-format-row";

		const inlinePill = document.createElement("div");
		inlinePill.className = "block-editor-format-pill";

		const inlineButtons = [
			{ icon: "bold", title: "Bold", action: () => this.doInlineFormat("**") },
			{ icon: "italic", title: "Italic", action: () => this.doInlineFormat("*") },
			{ icon: "strikethrough", title: "Strikethrough", action: () => this.doInlineFormat("~~") },
			{ icon: "highlighter", title: "Highlight", action: () => this.doInlineFormat("==") },
		];

		for (const btn of inlineButtons) {
			inlinePill.appendChild(this.makeButton(btn.icon, btn.title, btn.action));
		}

		inlineRow.appendChild(inlinePill);

		const indentPill = document.createElement("div");
		indentPill.className = "block-editor-format-pill";

		const indentButtons = [
			{ icon: "outdent", title: "Outdent", action: () => this.doOutdent() },
			{ icon: "indent", title: "Indent", action: () => this.doIndent() },
		];

		for (const btn of indentButtons) {
			indentPill.appendChild(this.makeButton(btn.icon, btn.title, btn.action));
		}

		inlineRow.appendChild(indentPill);
		popup.appendChild(inlineRow);

		return popup;
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
			// Only fire if finger didn't move more than 10px
			if (Math.sqrt(dx * dx + dy * dy) > 10) return;
			e.preventDefault();
			e.stopPropagation();
			action();
		});

		// Clear on cancel/leave
		btn.addEventListener("pointercancel", () => { downPos = null; });

		return btn;
	}

	private toggleFormatPopup() {
		this.showingFormat = !this.showingFormat;
		if (this.showingFormat) {
			this.primaryPill.style.display = "none";
			this.formatPopup.style.display = "flex";
		} else {
			this.primaryPill.style.display = "flex";
			this.formatPopup.style.display = "none";
		}
	}

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

	show() {
		this.el.style.display = "flex";
		// Preserve format popup state — don't reset on every show()
		if (this.showingFormat) {
			this.primaryPill.style.display = "none";
			this.formatPopup.style.display = "flex";
		} else {
			this.primaryPill.style.display = "flex";
			this.formatPopup.style.display = "none";
		}
	}

	hide() {
		this.el.style.display = "none";
		// Reset to primary pill when fully hidden
		this.showingFormat = false;
		this.primaryPill.style.display = "flex";
		this.formatPopup.style.display = "none";
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
}
