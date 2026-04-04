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
	deleteBlocks,
	undoAction,
	redoAction,
	copyBlocks,
	cutBlocks,
	progressiveSelectAll,
} from "./operations";

type ButtonDef = { icon: string; title: string; action: () => void; className?: string };

export class BlockEditorToolbar {
	el: HTMLElement;
	headingPopup: HTMLElement | null = null;
	private view: EditorView | null = null;
	private indentUnit: string;

	constructor(indentUnit: string) {
		this.indentUnit = indentUnit;
		this.el = document.createElement("div");
		this.el.className = "block-editor-toolbar";
		this.el.style.display = "none";

		this.buildToolbar();

		this.el.addEventListener("pointerdown", (e) => e.preventDefault());
	}

	setView(view: EditorView) {
		this.view = view;
	}

	setIndentUnit(unit: string) {
		this.indentUnit = unit;
	}

	private buildToolbar() {
		// Top row: Undo, Redo, Select All, Cut, Copy | Outdent, Indent, Move Up, Move Down
		const topRow: Array<ButtonDef | "separator"> = [
			{ icon: "undo-2", title: "Undo", action: () => this.doUndo() },
			{ icon: "redo-2", title: "Redo", action: () => this.doRedo() },
			{ icon: "check-check", title: "Select All", action: () => this.doSelectAll() },
			{ icon: "scissors", title: "Cut", action: () => this.doCut() },
			{ icon: "copy", title: "Copy", action: () => this.doCopy() },
			"separator",
			{ icon: "outdent", title: "Outdent", action: () => this.doOutdent() },
			{ icon: "indent", title: "Indent", action: () => this.doIndent() },
			{ icon: "arrow-up", title: "Move Up", action: () => this.doAction(moveBlocksUp) },
			{ icon: "arrow-down", title: "Move Down", action: () => this.doAction(moveBlocksDown) },
		];

		// Bottom row: Heading, Bullet, Numbered, Checkbox, Quote, Delete
		const bottomRow: Array<ButtonDef | "separator"> = [
			{ icon: "heading", title: "Heading", action: () => this.showHeadingPopup() },
			{ icon: "list", title: "Bullet List", action: () => this.doAction(toggleBulletList) },
			{ icon: "list-ordered", title: "Numbered List", action: () => this.doAction(toggleNumberedList) },
			{ icon: "check-square", title: "Checkbox", action: () => this.doAction(toggleCheckbox) },
			{ icon: "text-quote", title: "Quote", action: () => this.doAction(toggleQuote) },
			"separator",
			{ icon: "trash-2", title: "Delete", action: () => this.doDelete(), className: "block-editor-btn-danger" },
		];

		this.el.appendChild(this.buildRow(topRow));
		this.el.appendChild(this.buildRow(bottomRow));
	}

	private buildRow(items: Array<ButtonDef | "separator">): HTMLElement {
		const row = document.createElement("div");
		row.className = "block-editor-toolbar-row";

		for (const item of items) {
			if (item === "separator") {
				const sep = document.createElement("div");
				sep.className = "block-editor-toolbar-separator";
				row.appendChild(sep);
				continue;
			}

			const btn = document.createElement("button");
			btn.setAttribute("aria-label", item.title);
			btn.title = item.title;
			if (item.className) btn.classList.add(item.className);
			setIcon(btn, item.icon);

			btn.addEventListener("pointerup", (e) => {
				e.preventDefault();
				e.stopPropagation();
				item.action();
			});

			row.appendChild(btn);
		}

		return row;
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

	private doUndo() {
		if (!this.view) return;
		undoAction(this.view);
	}

	private doRedo() {
		if (!this.view) return;
		redoAction(this.view);
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

	private showHeadingPopup() {
		if (this.headingPopup) {
			this.headingPopup.remove();
			this.headingPopup = null;
			return;
		}

		const popup = document.createElement("div");
		popup.className = "block-editor-heading-popup";
		popup.addEventListener("pointerdown", (e) => e.preventDefault());

		const options = [
			{ label: "Body", level: 0 },
			{ label: "H1", level: 1 },
			{ label: "H2", level: 2 },
			{ label: "H3", level: 3 },
			{ label: "H4", level: 4 },
			{ label: "H5", level: 5 },
			{ label: "H6", level: 6 },
		];

		for (const opt of options) {
			const btn = document.createElement("button");
			btn.textContent = opt.label;
			btn.addEventListener("pointerup", (e) => {
				e.preventDefault();
				e.stopPropagation();
				const selected = this.getSelectedLines();
				if (selected && this.view) {
					setHeadingLevel(this.view, selected, opt.level);
				}
				this.hideHeadingPopup();
			});
			popup.appendChild(btn);
		}

		popup.style.bottom = this.el.offsetHeight + 8 + "px";
		popup.style.left = "50%";
		popup.style.transform = "translateX(-50%)";

		document.body.appendChild(popup);
		this.headingPopup = popup;

		const close = (e: PointerEvent) => {
			if (!popup.contains(e.target as Node) && !this.el.contains(e.target as Node)) {
				this.hideHeadingPopup();
				document.removeEventListener("pointerdown", close);
			}
		};
		setTimeout(() => document.addEventListener("pointerdown", close), 0);
	}

	private hideHeadingPopup() {
		if (this.headingPopup) {
			this.headingPopup.remove();
			this.headingPopup = null;
		}
	}

	show() {
		this.el.style.display = "flex";
	}

	hide() {
		this.el.style.display = "none";
		this.hideHeadingPopup();
	}

	destroy() {
		this.el.remove();
		this.hideHeadingPopup();
	}

	updateVisibility(active: boolean, hasSelection: boolean) {
		if (active && hasSelection) {
			this.show();
		} else {
			this.hide();
		}
	}
}
