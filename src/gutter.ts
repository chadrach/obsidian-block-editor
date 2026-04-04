import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { EditorState, Transaction } from "@codemirror/state";
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
 * Transaction filter: blocks USER-initiated document changes (typing, paste,
 * delete) in block mode. Allows:
 * - Our annotated toolbar operations
 * - Transactions with our custom effects
 * - Internal/programmatic changes from Obsidian (live preview rendering, etc.)
 */
export const blockModeTransactionFilter = EditorState.transactionFilter.of((tr) => {
	const state = tr.startState.field(blockSelectionState);
	if (!state.active) return tr;
	// Always allow our own toolbar operations
	if (tr.annotation(blockEditorTransaction)) return tr;
	// Always allow transactions with our custom effects
	if (tr.effects.length > 0) return tr;
	// Only block user-initiated doc changes (typing, paste, etc.)
	// Let internal/programmatic changes through (live preview, etc.)
	if (tr.docChanged) {
		const userEvent = tr.annotation(Transaction.userEvent);
		if (userEvent) return [];
		return tr;
	}
	return tr;
});

interface CircleInfo {
	el: HTMLElement;
	lineNum: number;
	// docTop: the lineBlockAt().top value (stable during scroll)
	docTop: number;
	lineHeight: number;
}

/**
 * ViewPlugin: renders fixed-position circles on document.body.
 *
 * For smooth scrolling: circles are fully rebuilt only when the doc or
 * selection changes. During scroll, we just reposition existing circles
 * using the current contentDOM.top offset — no DOM rebuild needed.
 */
export const blockSelectionGutter = ViewPlugin.fromClass(
	class {
		container: HTMLElement;
		circles: CircleInfo[] = [];
		private scrollHandler: () => void;
		private focusHandler: () => void;
		private lastContentTop: number = 0;
		private circleLeft: number = 0;

		constructor(readonly view: EditorView) {
			this.container = document.createElement("div");
			this.container.className = "block-editor-gutter";
			this.container.style.display = "none";
			document.body.appendChild(this.container);

			// On scroll, just reposition existing circles (fast path)
			this.scrollHandler = () => {
				if (this.view.state.field(blockSelectionState).active) {
					this.repositionCircles();
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
				update.viewportChanged
			) {
				// Full rebuild when content or selection changes
				this.buildGutter();
			} else if (update.geometryChanged && state.active) {
				// Geometry change (resize etc) — reposition
				this.repositionCircles();
			}
		}

		/**
		 * Fast path: reposition existing circle elements using current
		 * contentDOM offset. No DOM creation/destruction.
		 */
		repositionCircles() {
			const contentTop = this.view.contentDOM.getBoundingClientRect().top;
			const scrollerRect = this.view.scrollDOM.getBoundingClientRect();

			for (const c of this.circles) {
				const screenY = contentTop + c.docTop;
				// Hide if off-screen
				if (screenY + c.lineHeight < scrollerRect.top || screenY > scrollerRect.bottom) {
					c.el.style.display = "none";
				} else {
					c.el.style.display = "";
					c.el.style.top = (screenY + (c.lineHeight - 20) / 2) + "px";
				}
			}
		}

		buildGutter() {
			const state = this.view.state.field(blockSelectionState);
			this.container.innerHTML = "";
			this.circles = [];

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

			const contentTop = this.view.contentDOM.getBoundingClientRect().top;
			const scrollerRect = this.view.scrollDOM.getBoundingClientRect();
			const circleLeft = scrollerRect.right - 44;

			for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
				if (lineNum <= frontmatterEnd) continue;
				const line = doc.line(lineNum);
				if (line.text.trim() === "") continue;

				const block = this.view.lineBlockAt(line.from);
				const screenY = contentTop + block.top;

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
				this.circles.push({
					el: circle,
					lineNum,
					docTop: block.top,
					lineHeight: block.height,
				});
			}
		}

		destroy() {
			this.container.remove();
			this.view.scrollDOM.removeEventListener("scroll", this.scrollHandler);
			this.view.contentDOM.removeEventListener("focus", this.focusHandler);
		}
	}
);
