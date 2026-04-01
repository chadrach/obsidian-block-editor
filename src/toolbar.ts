import { EditorView } from "@codemirror/view";
import { setIcon } from "obsidian";
import { blockSelectionState, toggleBlockMode, setBlockSelection } from "./state";
import {
	moveBlocksUp,
	moveBlocksDown,
	indentBlocks,
	outdentBlocks,
	cycleHeading,
	setHeadingLevel,
	toggleBulletList,
	toggleNumberedList,
	toggleCheckbox,
	deleteBlocks,
} from "./operations";

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

		// Prevent focus transfer from the toolbar container itself.
		// We use pointerdown so this works on both desktop and mobile.
		this.el.addEventListener("pointerdown", (e) => e.preventDefault());
	}

	setView(view: EditorView) {
		this.view = view;
	}

	setIndentUnit(unit: string) {
		this.indentUnit = unit;
	}

	private buildToolbar() {
		const buttons: Array<{ icon: string; title: string; action: () => void } | "separator"> = [
			{ icon: "arrow-up", title: "Move Up", action: () => this.doAction(moveBlocksUp) },
			{ icon: "arrow-down", title: "Move Down", action: () => this.doAction(moveBlocksDown) },
			"separator",
			{ icon: "indent", title: "Indent", action: () => this.doIndent() },
			{ icon: "outdent", title: "Outdent", action: () => this.doOutdent() },
			"separator",
			{ icon: "heading", title: "Heading", action: () => this.showHeadingPopup() },
			{ icon: "list", title: "Bullet List", action: () => this.doAction(toggleBulletList) },
			{ icon: "list-ordered", title: "Numbered List", action: () => this.doAction(toggleNumberedList) },
			{ icon: "check-square", title: "Checkbox", action: () => this.doAction(toggleCheckbox) },
			"separator",
			{ icon: "trash-2", title: "Delete", action: () => this.doDelete() },
		];

		for (const item of buttons) {
			if (item === "separator") {
				const sep = document.createElement("div");
				sep.className = "block-editor-toolbar-separator";
				this.el.appendChild(sep);
				continue;
			}

			const btn = document.createElement("button");
			btn.setAttribute("aria-label", item.title);
			btn.title = item.title;
			setIcon(btn, item.icon);

			// Use pointerup for the action. pointerdown on the container
			// already calls preventDefault() to block focus. We use
			// pointerup (not pointerdown) so the user can see the :active
			// press state before the action fires.
			btn.addEventListener("pointerup", (e) => {
				e.preventDefault();
				e.stopPropagation();
				item.action();
			});

			this.el.appendChild(btn);
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

	private showHeadingPopup() {
		if (this.headingPopup) {
			this.headingPopup.remove();
			this.headingPopup = null;
			return;
		}

		const popup = document.createElement("div");
		popup.className = "block-editor-heading-popup";

		// Prevent focus transfer from the popup
		popup.addEventListener("pointerdown", (e) => e.preventDefault());

		const options = [
			{ label: "Paragraph", level: 0 },
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

		// Position above the toolbar
		popup.style.bottom = this.el.offsetHeight + 8 + "px";
		popup.style.left = "50%";
		popup.style.transform = "translateX(-50%)";

		document.body.appendChild(popup);
		this.headingPopup = popup;

		// Close popup when tapping outside
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

	/**
	 * Called from the main plugin to update visibility based on state.
	 */
	updateVisibility(active: boolean, hasSelection: boolean) {
		if (active && hasSelection) {
			this.show();
		} else {
			this.hide();
		}
	}
}
