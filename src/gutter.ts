import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { blockSelectionState, toggleBlockSelection } from "./state";

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
			view.dom.appendChild(this.container);

			this.overlay = document.createElement("div");
			this.overlay.className = "block-editor-touch-overlay";
			this.overlay.style.display = "none";

			// The overlay captures touches on the editor content area to prevent focus
			const preventFocus = (e: Event) => {
				const state = this.view.state.field(blockSelectionState);
				if (state.active) {
					e.preventDefault();
					e.stopPropagation();
				}
			};
			this.overlay.addEventListener("mousedown", preventFocus);
			this.overlay.addEventListener("touchstart", preventFocus, { passive: false });

			// Tapping the overlay exits block mode
			this.overlay.addEventListener("click", (e: MouseEvent) => {
				const state = this.view.state.field(blockSelectionState);
				if (state.active) {
					// Import here to avoid circular dependency
					const { toggleBlockMode } = require("./state");
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

			view.dom.appendChild(this.overlay);
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

				// Prevent focus transfer on touch/mouse
				const preventAndSelect = (e: Event) => {
					e.preventDefault();
					e.stopPropagation();
					this.view.dispatch({
						effects: [toggleBlockSelection.of(lineNum)],
					});
				};

				circle.addEventListener("mousedown", (e) => {
					e.preventDefault();
					e.stopPropagation();
				});
				circle.addEventListener("touchstart", (e) => {
					e.preventDefault();
					e.stopPropagation();
				}, { passive: false });
				circle.addEventListener("click", preventAndSelect);

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
