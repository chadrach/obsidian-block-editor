import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
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
 * ViewPlugin that renders tappable gutter circles for each visible block line
 * when Block Mode is active.
 *
 * The gutter is a fixed-position container on document.body (like the FAB,
 * which we know works). Circles are positioned using lineBlockAt() converted
 * to screen coordinates via the scroller's bounding rect and scroll offset.
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

			// Toggle contenteditable to prevent focus/keyboard in block mode
			if (state.active !== prevState.active) {
				if (state.active) {
					this.view.contentDOM.setAttribute("contenteditable", "false");
					this.view.contentDOM.blur();
				} else {
					this.view.contentDOM.setAttribute("contenteditable", "true");
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

			// lineBlockAt() returns positions in document coordinates (pixels
			// from the top of the document). To convert to screen coordinates:
			//   screenY = scrollerRect.top + lineBlock.top - scrollTop
			const scrollerRect = this.view.scrollDOM.getBoundingClientRect();
			const scrollTop = this.view.scrollDOM.scrollTop;

			for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
				if (lineNum <= frontmatterEnd) continue;

				const line = doc.line(lineNum);
				if (line.text.trim() === "") continue;

				const lineBlock = this.view.lineBlockAt(line.from);
				const screenY = scrollerRect.top + lineBlock.top - scrollTop;

				// Skip if off-screen
				if (screenY + lineBlock.height < scrollerRect.top || screenY > scrollerRect.bottom) continue;

				const circle = document.createElement("div");
				circle.className = "block-editor-gutter-circle";
				if (state.selectedBlocks.has(lineNum)) {
					circle.classList.add("selected");
				}

				// Position circle at screen Y, centered vertically on the line
				circle.style.top = (screenY + (lineBlock.height - 20) / 2) + "px";
				circle.style.left = (scrollerRect.left + 4) + "px";

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
			this.view.contentDOM.setAttribute("contenteditable", "true");
		}
	}
);
