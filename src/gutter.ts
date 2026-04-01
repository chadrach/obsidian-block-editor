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
 */
export const blockSelectionGutter = ViewPlugin.fromClass(
	class {
		container: HTMLElement;
		circles: Map<number, HTMLElement> = new Map();

		constructor(readonly view: EditorView) {
			this.container = document.createElement("div");
			this.container.className = "block-editor-gutter";

			// Attach to scrollDOM so that coordsAtPos-based positions align
			view.scrollDOM.style.position = "relative";
			view.scrollDOM.appendChild(this.container);

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

			// Use coordsAtPos to get screen-relative positions, then convert
			// to scroll-container-relative positions. This correctly accounts
			// for all editor padding and gutter offsets.
			const containerRect = this.view.scrollDOM.getBoundingClientRect();
			const scrollTop = this.view.scrollDOM.scrollTop;

			for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
				// Skip frontmatter lines
				if (lineNum <= frontmatterEnd) continue;

				const line = doc.line(lineNum);

				// Skip empty lines
				if (line.text.trim() === "") continue;

				// Get screen coordinates of this line
				const coords = this.view.coordsAtPos(line.from);
				if (!coords) continue;

				// Convert screen Y to position relative to the scroll container
				const relativeTop = coords.top - containerRect.top + scrollTop;

				const circle = document.createElement("div");
				circle.className = "block-editor-gutter-circle";
				if (state.selectedBlocks.has(lineNum)) {
					circle.classList.add("selected");
				}

				// Position the circle vertically centered on the line
				const lineHeight = coords.bottom - coords.top;
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
 * Block Mode is active. This replaces the overlay approach — it lets
 * scrolling work natively while intercepting focus-causing events.
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
