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
 * The gutter is a child of view.dom (.cm-editor), NOT .cm-scroller, to avoid
 * z-index/clipping issues with CM6's internal layers. Circle positions are
 * computed from coordsAtPos() screen coords converted to .cm-editor-relative.
 */
export const blockSelectionGutter = ViewPlugin.fromClass(
	class {
		container: HTMLElement;
		circles: Map<number, HTMLElement> = new Map();

		constructor(readonly view: EditorView) {
			this.container = document.createElement("div");
			this.container.className = "block-editor-gutter";

			// Append to .cm-editor (view.dom) — sits outside the scroll clip area
			view.dom.style.position = "relative";
			view.dom.appendChild(this.container);

			// Rebuild on scroll so circles track visible lines
			view.scrollDOM.addEventListener("scroll", () => {
				const state = this.view.state.field(blockSelectionState);
				if (state.active) {
					this.buildGutter();
				}
			});

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

			// Positions are relative to .cm-editor (view.dom)
			const editorRect = this.view.dom.getBoundingClientRect();

			for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
				// Skip frontmatter lines
				if (lineNum <= frontmatterEnd) continue;

				const line = doc.line(lineNum);

				// Skip empty lines
				if (line.text.trim() === "") continue;

				// Get screen coordinates of this line
				const coords = this.view.coordsAtPos(line.from);
				if (!coords) continue;

				// Convert screen coords to .cm-editor-relative
				const relativeTop = coords.top - editorRect.top;
				const lineHeight = coords.bottom - coords.top;

				const circle = document.createElement("div");
				circle.className = "block-editor-gutter-circle";
				if (state.selectedBlocks.has(lineNum)) {
					circle.classList.add("selected");
				}

				// Position the circle vertically centered on the line
				circle.style.top = (relativeTop + (lineHeight - 20) / 2) + "px";

				// Use pointerdown for selection — fires on both touch and
				// mouse, lets us preventDefault to block focus transfer.
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
			this.view.dom.classList.remove("block-editor-active");
		}
	}
);

/**
 * EditorView.domEventHandlers that prevents focus (and thus keyboard) when
 * Block Mode is active. This lets scrolling work natively while intercepting
 * focus-causing events.
 */
export const blockModeFocusPrevention = EditorView.domEventHandlers({
	mousedown(event, view) {
		const state = view.state.field(blockSelectionState);
		if (state.active) {
			event.preventDefault();
			return true;
		}
		return false;
	},
	touchstart(event, view) {
		const state = view.state.field(blockSelectionState);
		if (state.active) {
			// Do NOT preventDefault here — that would block scrolling.
			// Returning true tells CM6 not to process it further (no focus).
			return true;
		}
		return false;
	},
	focus(event, view) {
		const state = view.state.field(blockSelectionState);
		if (state.active) {
			// If the editor somehow gets focus in block mode, blur it
			view.contentDOM.blur();
			return true;
		}
		return false;
	},
});
