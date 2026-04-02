import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { blockSelectionState, toggleBlockSelection, toggleBlockMode } from "./state";

/**
 * Detect the line range occupied by YAML frontmatter (if any).
 * Returns the last line number of the frontmatter (inclusive), or 0 if none.
 */
function getFrontmatterEnd(view: EditorView): number {
	const doc = view.state.doc;
	if (doc.lines < 1) return 0;
	const firstLine = doc.line(1).text;
	if (firstLine.trim() !== "---") return 0;

	for (let i = 2; i <= doc.lines; i++) {
		const text = doc.line(i).text;
		if (text.trim() === "---") return i;
	}
	return 0;
}

/**
 * Transaction filter that blocks document changes while block mode is active.
 * Our own effects (selection toggles, mode toggles, formatting ops) pass through.
 */
export const blockModeTransactionFilter = EditorState.transactionFilter.of((tr) => {
	const state = tr.startState.field(blockSelectionState);
	if (!state.active) return tr;

	// Allow transactions with our effects through
	if (tr.effects.length > 0) return tr;

	// Block document changes from user input (typing, paste, etc.)
	if (tr.docChanged) return [];

	return tr;
});

/**
 * ViewPlugin that renders tappable gutter circles in the RIGHT margin.
 *
 * Container is a child of view.dom (.cm-editor) with position:absolute.
 * Circles positioned via lineBlockAt() + a padding offset computed from DOM.
 * This is the approach proven to render circles reliably.
 */
export const blockSelectionGutter = ViewPlugin.fromClass(
	class {
		container: HTMLElement;
		circles: Map<number, HTMLElement> = new Map();
		private scrollHandler: () => void;
		private focusHandler: () => void;
		private rafId: number | null = null;

		constructor(readonly view: EditorView) {
			this.container = document.createElement("div");
			this.container.className = "block-editor-gutter";
			this.container.style.display = "none";
			view.dom.appendChild(this.container);

			// Rebuild circles on scroll (throttled via rAF)
			this.scrollHandler = () => {
				const state = this.view.state.field(blockSelectionState);
				if (state.active) {
					if (this.rafId !== null) cancelAnimationFrame(this.rafId);
					this.rafId = requestAnimationFrame(() => {
						this.rafId = null;
						this.buildGutter();
					});
				}
			};
			view.scrollDOM.addEventListener("scroll", this.scrollHandler);

			// Prevent keyboard by blurring whenever editor receives focus
			// in block mode. This doesn't touch contenteditable, so CM6's
			// rendering pipeline stays intact.
			this.focusHandler = () => {
				const state = this.view.state.field(blockSelectionState);
				if (state.active) {
					// Use setTimeout to let the focus event complete, then blur.
					// This avoids interfering with CM6's focus handling.
					setTimeout(() => {
						this.view.contentDOM.blur();
					}, 0);
				}
			};
			view.contentDOM.addEventListener("focus", this.focusHandler);
		}

		update(update: ViewUpdate) {
			const state = update.state.field(blockSelectionState);
			const prevState = update.startState.field(blockSelectionState);

			if (state.active !== prevState.active) {
				if (state.active) {
					this.view.contentDOM.blur();
				}
			}

			if (
				state.active !== prevState.active ||
				state.selectedBlocks !== prevState.selectedBlocks ||
				update.docChanged ||
				update.viewportChanged ||
				update.geometryChanged
			) {
				this.buildGutter();
			}
		}

		buildGutter() {
			const state = this.view.state.field(blockSelectionState);

			if (!state.active) {
				this.container.style.display = "none";
				return;
			}

			this.container.style.display = "block";

			// Clear old circles
			this.container.innerHTML = "";
			this.circles.clear();

			// Find frontmatter boundary
			const frontmatterEnd = getFrontmatterEnd(this.view);

			// Get visible range
			const { from, to } = this.view.viewport;
			const doc = this.view.state.doc;
			const startLine = doc.lineAt(from).number;
			const endLine = doc.lineAt(to).number;

			// Compute the pixel offset between lineBlockAt coordinates and
			// the container's (view.dom) coordinate space.
			//
			// lineBlockAt().top = pixels from start of document content (0 = first line)
			// For a child of .cm-editor, we need to account for:
			//   1. The scroller's position within .cm-editor
			//   2. The content padding within the scroller
			//   3. The current scroll offset
			//
			// We compute this as:
			//   offset = (contentDOM screen top) - (editor screen top) + scrollTop
			// Then: circleTop = offset + lineBlock.top - scrollTop
			// Which simplifies to: circleTop = (contentDOM screen top) - (editor screen top) + lineBlock.top
			const editorRect = this.view.dom.getBoundingClientRect();
			const contentRect = this.view.contentDOM.getBoundingClientRect();
			const yOffset = contentRect.top - editorRect.top;

			// Right edge: position circles in the right padding area.
			// The container is position:absolute inside .cm-editor, so we
			// use the editor's width minus space for the circle.
			const scrollerRect = this.view.scrollDOM.getBoundingClientRect();
			const circleLeft = scrollerRect.right - editorRect.left - 24;

			for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
				if (lineNum <= frontmatterEnd) continue;

				const line = doc.line(lineNum);
				if (line.text.trim() === "") continue;

				const lineBlock = this.view.lineBlockAt(line.from);

				// circleTop in .cm-editor coordinate space
				const circleTop = yOffset + lineBlock.top;

				// Skip if off-screen (relative to the editor's visible area)
				const scrollerTop = scrollerRect.top - editorRect.top;
				const scrollerBottom = scrollerRect.bottom - editorRect.top;
				if (circleTop + lineBlock.height < scrollerTop || circleTop > scrollerBottom) continue;

				const circle = document.createElement("div");
				circle.className = "block-editor-gutter-circle";
				if (state.selectedBlocks.has(lineNum)) {
					circle.classList.add("selected");
				}

				// Centered vertically on the line
				circle.style.top = (circleTop + (lineBlock.height - 20) / 2) + "px";
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
				this.circles.set(lineNum, circle);
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
