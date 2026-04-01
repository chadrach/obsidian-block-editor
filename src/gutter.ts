import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { blockSelectionState, toggleBlockSelection, toggleBlockMode } from "./state";

/**
 * ViewPlugin that renders tappable gutter circles for each visible block line
 * when Block Mode is active.
 */
export const blockSelectionGutter = ViewPlugin.fromClass(
	class {
		container: HTMLElement;
		circles: Map<number, HTMLElement> = new Map();
		overlay: HTMLElement | null = null;

		constructor(readonly view: EditorView) {
			this.container = document.createElement("div");
			this.container.className = "block-editor-gutter";

			// Attach to scrollDOM so that lineBlockAt() top values align
			// with the gutter's coordinate space (both are relative to
			// the scrollable document).
			view.scrollDOM.style.position = "relative";
			view.scrollDOM.appendChild(this.container);

			this.overlay = document.createElement("div");
			this.overlay.className = "block-editor-touch-overlay";
			this.overlay.style.display = "none";

			// The overlay captures touches on the editor content area to prevent focus.
			// Use pointerdown so we can both preventDefault and act on it.
			this.overlay.addEventListener("pointerdown", (e) => {
				const state = this.view.state.field(blockSelectionState);
				if (state.active) {
					e.preventDefault();
					e.stopPropagation();
				}
			});
			// Fallback prevent-focus handlers
			this.overlay.addEventListener("mousedown", (e) => {
				const state = this.view.state.field(blockSelectionState);
				if (state.active) e.preventDefault();
			});
			this.overlay.addEventListener("touchstart", (e) => {
				const state = this.view.state.field(blockSelectionState);
				if (state.active) e.preventDefault();
			}, { passive: false });

			// Tapping the overlay exits block mode and places cursor
			this.overlay.addEventListener("pointerup", (e) => {
				const state = this.view.state.field(blockSelectionState);
				if (state.active) {
					this.view.dispatch({ effects: [toggleBlockMode.of(false)] });
					// Focus editor and place cursor at tap position
					const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
					if (pos !== null) {
						this.view.focus();
						this.view.dispatch({
							selection: { anchor: pos },
						});
					}
				}
			});

			view.scrollDOM.appendChild(this.overlay);
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
				if (this.overlay) this.overlay.style.display = "none";
				this.view.dom.classList.remove("block-editor-active");
				return;
			}

			this.container.style.display = "block";
			if (this.overlay) this.overlay.style.display = "block";
			this.view.dom.classList.add("block-editor-active");

			// Clear old circles
			this.container.innerHTML = "";
			this.circles.clear();

			// Get visible range
			const { from, to } = this.view.viewport;
			const doc = this.view.state.doc;

			const startLine = doc.lineAt(from).number;
			const endLine = doc.lineAt(to).number;

			for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
				const line = doc.line(lineNum);

				// Skip empty lines
				if (line.text.trim() === "") continue;

				// Get the visual position of this line
				const lineBlock = this.view.lineBlockAt(line.from);
				const top = lineBlock.top;

				const circle = document.createElement("div");
				circle.className = "block-editor-gutter-circle";
				if (state.selectedBlocks.has(lineNum)) {
					circle.classList.add("selected");
				}

				// Position the circle vertically centered on the line
				circle.style.top = (top + (lineBlock.height - 20) / 2) + "px";

				// Use pointerdown for selection — this fires on both touch and
				// mouse, and lets us preventDefault to block focus transfer.
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
			if (this.overlay) this.overlay.remove();
			this.view.dom.classList.remove("block-editor-active");
		}
	}
);
