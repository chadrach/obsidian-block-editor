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
 * Uses a fixed-position container on document.body to avoid all CM6 clipping
 * and z-index issues. Circles are positioned using coordsAtPos() screen coords.
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

			this.buildGutter();
		}

		update(update: ViewUpdate) {
			const state = update.state.field(blockSelectionState);
			const prevState = update.startState.field(blockSelectionState);

			if (
				state.active !== prevState.active ||
				state.selectedBlocks !== prevState.selectedBlocks ||
				update.docChanged ||
				update.viewportChanged ||
				update.geometryChanged
			) {
				this.buildGutter();
			}

			// Toggle contenteditable to prevent focus/keyboard in block mode
			if (state.active !== prevState.active) {
				if (state.active) {
					this.view.contentDOM.setAttribute("contenteditable", "false");
					this.view.contentDOM.blur();
				} else {
					this.view.contentDOM.setAttribute("contenteditable", "true");
				}
			}
		}

		buildGutter() {
			const state = this.view.state.field(blockSelectionState);

			if (!state.active) {
				this.container.style.display = "none";
				this.view.dom.classList.remove("block-editor-active");
				return;
			}

			this.container.style.display = "block";
			this.view.dom.classList.add("block-editor-active");

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

			// Get the editor's bounding rect for clipping
			const editorRect = this.view.dom.getBoundingClientRect();

			// Position the container to match the editor's left edge
			this.container.style.top = editorRect.top + "px";
			this.container.style.left = editorRect.left + "px";
			this.container.style.height = editorRect.height + "px";

			for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
				// Skip frontmatter lines
				if (lineNum <= frontmatterEnd) continue;

				const line = doc.line(lineNum);

				// Skip empty lines
				if (line.text.trim() === "") continue;

				// Get screen coordinates of this line
				const coords = this.view.coordsAtPos(line.from);
				if (!coords) continue;

				// Skip if outside the visible editor area
				if (coords.top < editorRect.top || coords.bottom > editorRect.bottom) continue;

				// Position relative to the container (which is at editorRect.top)
				const relativeTop = coords.top - editorRect.top;
				const lineHeight = coords.bottom - coords.top;

				const circle = document.createElement("div");
				circle.className = "block-editor-gutter-circle";
				if (state.selectedBlocks.has(lineNum)) {
					circle.classList.add("selected");
				}

				circle.style.top = (relativeTop + (lineHeight - 20) / 2) + "px";

				// Use pointerdown for selection
				circle.addEventListener("pointerdown", (e) => {
					e.preventDefault();
					e.stopPropagation();
					this.view.dispatch({
						effects: [toggleBlockSelection.of(lineNum)],
					});
				});
				// Fallback prevent-focus handlers
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
			// Ensure contenteditable is restored
			this.view.contentDOM.setAttribute("contenteditable", "true");
		}
	}
);
