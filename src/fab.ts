import { setIcon } from "obsidian";
import { EditorView } from "@codemirror/view";
import { blockSelectionState, toggleBlockMode } from "./state";

export class BlockEditorFAB {
	el: HTMLElement;
	private view: EditorView | null = null;

	constructor() {
		this.el = document.createElement("button");
		this.el.className = "block-editor-fab";
		this.el.style.display = "none";
		this.el.setAttribute("aria-label", "Exit Block Mode");
		setIcon(this.el, "x");

		this.el.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.exitBlockMode();
		});
		this.el.addEventListener("mousedown", (e) => e.preventDefault());
		this.el.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
	}

	setView(view: EditorView) {
		this.view = view;
	}

	private exitBlockMode() {
		if (!this.view) return;
		this.view.dispatch({
			effects: [toggleBlockMode.of(false)],
		});
	}

	updateAppearance(active: boolean) {
		if (active) {
			this.el.classList.add("active");
		} else {
			this.el.classList.remove("active");
		}
	}

	destroy() {
		this.el.remove();
	}
}
