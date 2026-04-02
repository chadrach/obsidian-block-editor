import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { EditorState, Transaction } from "@codemirror/state";
import { blockSelectionState, toggleBlockSelection } from "./state";

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
 * Transaction filter that blocks document changes and selection changes
 * while block mode is active. Only our own effects (block selection
 * toggles, etc.) are allowed through.
 */
export const blockModeTransactionFilter = EditorState.transactionFilter.of((tr) => {
	const state = tr.startState.field(blockSelectionState);
	if (!state.active) return tr;

	// If the transaction has our block mode effects, allow it through
	for (const effect of tr.effects) {
		// Allow all our custom effects
		if (effect.value !== undefined) return tr;
	}

	// Block document changes and selection changes from user input
	if (tr.docChanged) return [];

	return tr;
});

/**
 * ViewPlugin that renders tappable gutter circles in the RIGHT margin
 * for each visible block line when Block Mode is active.
 */
export const blockSelectionGutter = ViewPlugin.fromClass(
	class {
		container: HTMLElement;
		circles: Map<number, HTMLElement> = new Map();
		private scrollHandler: () => void;
		private rafId: number | null = null;

		constructor(readonly view: EditorView) {
			this.container = document.createElement("div");
			this.container.className = "block-editor-gutter";
			this.container.style.display = "none";
			document.body.appendChild(this.container);

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
		}

		update(update: ViewUpdate) {
			const state = update.state.field(blockSelectionState);
			const prevState = update.startState.field(blockSelectionState);

			// Re-enforce contenteditable="false" on EVERY update while active.
			// CM6 resets this attribute during its own update cycles.
			if (state.active) {
				if (this.view.contentDOM.contentEditable !== "false") {
					this.view.contentDOM.contentEditable = "false";
				}
				this.view.contentDOM.blur();
			}

			if (state.active !== prevState.active) {
				if (state.active) {
					this.view.contentDOM.contentEditable = "false";
					this.view.contentDOM.blur();
				} else {
					this.view.contentDOM.contentEditable = "true";
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
				this.view.dom.classList.remove("block-editor-active");
				return;
			}

			this.view.dom.classList.add("block-editor-active");
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

			// Use contentDOM's bounding rect as reference. lineBlockAt().top
			// is in document coordinates where 0 = top of content. The screen
			// position of that origin is contentDOM.top + content's CSS padding
			// minus scroll offset.
			const contentRect = this.view.contentDOM.getBoundingClientRect();
			const scrollTop = this.view.scrollDOM.scrollTop;
			const scrollerRect = this.view.scrollDOM.getBoundingClientRect();

			// contentDOM.top already accounts for scroll, but lineBlockAt
			// returns absolute doc coords. The mapping is:
			//   screenY = contentRect.top + lineBlock.top - scrollTop
			// BUT contentRect.top already includes the effect of scrolling
			// on the content element itself. Since .cm-content is inside
			// .cm-scroller, contentRect.top = scrollerRect.top + paddingTop - scrollTop
			// (approximately). So we need:
			//   screenY = scrollerRect.top + paddingTop + lineBlock.top - scrollTop
			// The easiest way: use the first visible line to calibrate.
			let offsetY = 0;
			const firstVisibleLine = doc.lineAt(from);
			const firstBlock = this.view.lineBlockAt(firstVisibleLine.from);
			const firstCoords = this.view.coordsAtPos(firstVisibleLine.from);
			if (firstCoords) {
				// offsetY maps lineBlockAt.top to screen Y
				offsetY = firstCoords.top - firstBlock.top;
			} else {
				// Fallback: estimate from contentDOM position
				offsetY = contentRect.top - scrollTop;
			}

			// Right edge: position circles at the right side of the scroller
			const circleRight = scrollerRect.right - 28;

			for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
				if (lineNum <= frontmatterEnd) continue;

				const line = doc.line(lineNum);
				if (line.text.trim() === "") continue;

				const lineBlock = this.view.lineBlockAt(line.from);
				const screenY = offsetY + lineBlock.top;

				// Skip if off-screen
				if (screenY + lineBlock.height < scrollerRect.top || screenY > scrollerRect.bottom) continue;

				const circle = document.createElement("div");
				circle.className = "block-editor-gutter-circle";
				if (state.selectedBlocks.has(lineNum)) {
					circle.classList.add("selected");
				}

				// Position circle at screen Y, centered vertically on the line
				circle.style.top = (screenY + (lineBlock.height - 20) / 2) + "px";
				circle.style.left = circleRight + "px";

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
			if (this.rafId !== null) cancelAnimationFrame(this.rafId);
			this.view.dom.classList.remove("block-editor-active");
			this.view.contentDOM.contentEditable = "true";
		}
	}
);
