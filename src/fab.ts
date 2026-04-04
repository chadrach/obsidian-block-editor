import { setIcon } from "obsidian";
import { EditorView } from "@codemirror/view";
import { blockSelectionState, toggleBlockMode, setBlockSelection } from "./state";
import { getBlockWithChildren } from "./block-utils";

export class BlockEditorFAB {
	el: HTMLElement;
	private view: EditorView | null = null;

	constructor() {
		this.el = document.createElement("button");
		this.el.className = "block-editor-fab";
		this.el.setAttribute("aria-label", "Toggle Block Mode");
		setIcon(this.el, "layout-grid");

		// Use pointerdown for the toggle action. On mobile, preventDefault()
		// on touchstart suppresses the subsequent click event, so we can't
		// rely on click. pointerdown fires on both touch and mouse and lets
		// us preventDefault() to block focus transfer at the same time.
		this.el.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.toggle();
		});
		// Fallback: also prevent focus via mousedown/touchstart in case
		// pointerdown isn't supported (older WebViews).
		this.el.addEventListener("mousedown", (e) => e.preventDefault());
		this.el.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
	}

	setView(view: EditorView) {
		this.view = view;
	}

	private toggle() {
		if (!this.view) return;

		const state = this.view.state.field(blockSelectionState);
		const newActive = !state.active;

		if (newActive) {
			const selected = new Set<number>();
			const hasFocus = this.view.hasFocus;

			if (hasFocus) {
				const sel = this.view.state.selection.main;
				const fromLine = this.view.state.doc.lineAt(sel.from).number;
				const toLine = this.view.state.doc.lineAt(sel.to).number;

				const visited = new Set<number>();
				for (let ln = fromLine; ln <= toLine; ln++) {
					if (visited.has(ln)) continue;
					const [start, end] = getBlockWithChildren(this.view.state, ln, 4, true);
					for (let i = start; i <= end; i++) {
						visited.add(i);
						if (this.view.state.doc.line(i).text.trim() !== "") {
							selected.add(i);
						}
					}
				}
			}

			const effects = selected.size > 0
				? [toggleBlockMode.of(true), setBlockSelection.of(selected)]
				: [toggleBlockMode.of(true)];

			this.view.dispatch({ effects });
			this.view.contentDOM.blur();
		} else {
			this.view.dispatch({
				effects: [toggleBlockMode.of(false)],
			});
		}
		// When exiting, do NOT focus the editor — that would trigger
		// the on-screen keyboard.

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
