import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { blockSelectionState, toggleBlockSelection } from "./state";
import { blockEditorTransaction } from "./operations";

/**
 * Detect the end of YAML frontmatter. Returns last frontmatter line, or 0.
 */
function getFrontmatterEnd(view: EditorView): number {
	const doc = view.state.doc;
	if (doc.lines < 1) return 0;
	if (doc.line(1).text.trim() !== "---") return 0;
	for (let i = 2; i <= doc.lines; i++) {
		if (doc.line(i).text.trim() === "---") return i;
	}
	return 0;
}

/**
 * Transaction filter: blocks document changes in block mode unless
 * the transaction is annotated as coming from the block editor toolbar.
 */
export const blockModeTransactionFilter = EditorState.transactionFilter.of((tr) => {
	const state = tr.startState.field(blockSelectionState);
	if (!state.active) return tr;
	// Allow toolbar-initiated transactions
	if (tr.annotation(blockEditorTransaction)) return tr;
	// Allow transactions with our state effects (mode toggle, selection)
	if (tr.effects.length > 0) return tr;
	// Block user input (typing, paste, etc.)
	if (tr.docChanged) return [];
	return tr;
});

/**
 * ViewPlugin: renders fixed-position circles on document.body.
 *
 * Screen Y for a line = contentDOM.getBoundingClientRect().top + lineBlockAt().top
 * This works because contentDOM.top moves with scroll, and lineBlockAt().top
 * is the fixed document-relative position.
 */
export const blockSelectionGutter = ViewPlugin.fromClass(
	class {
		container: HTMLElement;
		private scrollHandler: () => void;
		private focusHandler: () => void;
		private rafId: number | null = null;

		constructor(readonly view: EditorView) {
			this.container = document.createElement("div");
			this.container.className = "block-editor-gutter";
			this.container.style.display = "none";
			document.body.appendChild(this.container);

			this.scrollHandler = () => {
				if (this.view.state.field(blockSelectionState).active) {
					if (this.rafId !== null) cancelAnimationFrame(this.rafId);
					this.rafId = requestAnimationFrame(() => {
						this.rafId = null;
						this.buildGutter();
					});
				}
			};
			view.scrollDOM.addEventListener("scroll", this.scrollHandler);

			this.focusHandler = () => {
				if (this.view.state.field(blockSelectionState).active) {
					setTimeout(() => this.view.contentDOM.blur(), 0);
				}
			};
			view.contentDOM.addEventListener("focus", this.focusHandler);
		}

		update(update: ViewUpdate) {
			const state = update.state.field(blockSelectionState);
			const prev = update.startState.field(blockSelectionState);

			if (state.active && !prev.active) {
				this.view.contentDOM.blur();
			}

			if (
				state.active !== prev.active ||
				state.selectedBlocks !== prev.selectedBlocks ||
				update.docChanged ||
				update.viewportChanged ||
				update.geometryChanged
			) {
				this.buildGutter();
			}
		}

		buildGutter() {
			const state = this.view.state.field(blockSelectionState);
			this.container.innerHTML = "";

			if (!state.active) {
				this.container.style.display = "none";
				return;
			}
			this.container.style.display = "block";

			const frontmatterEnd = getFrontmatterEnd(this.view);
			const { from, to } = this.view.viewport;
			const doc = this.view.state.doc;
			const startLine = doc.lineAt(from).number;
			const endLine = doc.lineAt(to).number;

			// The key formula: screen position of a line is
			// contentDOM.top + lineBlockAt.top
			// contentDOM.top already accounts for scroll position.
			const contentTop = this.view.contentDOM.getBoundingClientRect().top;
			const scrollerRect = this.view.scrollDOM.getBoundingClientRect();

			// Position circles right next to where text ends,
			// at the left edge of the right padding zone.
			const circleLeft = scrollerRect.right - 44;

			for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
				if (lineNum <= frontmatterEnd) continue;
				const line = doc.line(lineNum);
				if (line.text.trim() === "") continue;

				const block = this.view.lineBlockAt(line.from);
				const screenY = contentTop + block.top;

				// Clip to visible scroller area
				if (screenY + block.height < scrollerRect.top) continue;
				if (screenY > scrollerRect.bottom) continue;

				const circle = document.createElement("div");
				circle.className = "block-editor-gutter-circle";
				if (state.selectedBlocks.has(lineNum)) {
					circle.classList.add("selected");
				}

				circle.style.top = (screenY + (block.height - 20) / 2) + "px";
				circle.style.left = circleLeft + "px";

				circle.addEventListener("pointerdown", (e) => {
					e.preventDefault();
					e.stopPropagation();
					this.view.dispatch({
						effects: [toggleBlockSelection.of(lineNum)],
					});
				});
				circle.addEventListener("mousedown", (e) => {
					e.preventDefault();
					e.stopPropagation();
				});
				circle.addEventListener("touchstart", (e) => {
					e.preventDefault();
					e.stopPropagation();
				}, { passive: false });

				this.container.appendChild(circle);
			}
		}

		destroy() {
			this.container.remove();
			this.view.scrollDOM.removeEventListener("scroll", this.scrollHandler);
			this.view.contentDOM.removeEventListener("focus", this.focusHandler);
			if (this.rafId !== null) cancelAnimationFrame(this.rafId);
		}
	}
);
