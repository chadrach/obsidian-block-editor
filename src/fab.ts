import { setIcon } from "obsidian";
import { EditorView } from "@codemirror/view";
import { blockSelectionState, toggleBlockMode } from "./state";

export class BlockEditorFAB {
	el: HTMLElement;
	private view: EditorView | null = null;

	constructor() {
		this.el = document.createElement("button");
		this.el.className = "block-editor-fab";
		this.el.setAttribute("aria-label", "Toggle Block Mode");
		setIcon(this.el, "layout-grid");

		// Prevent focus transfer
		this.el.addEventListener("mousedown", (e) => e.preventDefault());
		this.el.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });

		this.el.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.toggle();
		});
	}

	setView(view: EditorView) {
		this.view = view;
	}

	private toggle() {
		if (!this.view) return;

		const state = this.view.state.field(blockSelectionState);
		const newActive = !state.active;

		this.view.dispatch({
			effects: [toggleBlockMode.of(newActive)],
		});

		if (!newActive) {
			// Exiting block mode - restore editor focus
			this.view.focus();
		} else {
			// Entering block mode - blur editor to dismiss keyboard
			this.view.contentDOM.blur();
		}

		this.updateAppearance(newActive);
	}

	updateAppearance(active: boolean) {
		if (active) {
			this.el.classList.add("active");
			setIcon(this.el, "x");
		} else {
			this.el.classList.remove("active");
			setIcon(this.el, "layout-grid");
		}
	}

	show() {
		this.el.style.display = "flex";
	}

	hide() {
		this.el.style.display = "none";
	}

	destroy() {
		this.el.remove();
	}
}
