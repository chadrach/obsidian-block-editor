import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { EditorState, Transaction } from "@codemirror/state";
import { blockSelectionState, setBlockSelection, toggleBlockMode } from "./state";
import { blockEditorTransaction } from "./operations";
import { getBlockWithChildren } from "./block-utils";

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

/**
 * ViewPlugin: renders fixed-position circles on document.body.
 * Rebuilt on scroll, viewport change, doc change, and selection change.
 */
export const blockSelectionGutter = ViewPlugin.fromClass(
	class {
		container: HTMLElement;
		private scrollHandler: () => void;
		private focusHandler: () => void;
		private contentPointerDownHandler: (e: PointerEvent) => void;
		private contentPointerUpHandler: (e: PointerEvent) => void;
		private pointerStart: { x: number; y: number } | null = null;
		// Long-press to enter block mode
		private longPressTimer: ReturnType<typeof setTimeout> | null = null;
		private longPressStart: { x: number; y: number } | null = null;
		private touchStartHandler: (e: TouchEvent) => void;
		private touchMoveHandler: (e: TouchEvent) => void;
		private touchEndHandler: () => void;

		constructor(readonly view: EditorView) {
			this.container = document.createElement("div");
			this.container.className = "block-editor-gutter";
			this.container.style.display = "none";
			document.body.appendChild(this.container);

			// Rebuild on scroll so newly-visible lines get circles
			this.scrollHandler = () => {
				if (this.view.state.field(blockSelectionState).active) {
					this.buildGutter();
				}
			};
			view.scrollDOM.addEventListener("scroll", this.scrollHandler);

			this.focusHandler = () => {
				if (this.view.state.field(blockSelectionState).active) {
					setTimeout(() => this.view.contentDOM.blur(), 0);
				}
			};
			view.contentDOM.addEventListener("focus", this.focusHandler);

			// Tap anywhere on a line to toggle selection — use pointerdown/up
			// pair to distinguish taps from scroll drags
			this.contentPointerDownHandler = (e: PointerEvent) => {
				if (!this.view.state.field(blockSelectionState).active) return;
				if ((e.target as HTMLElement).closest(".block-editor-gutter-circle")) return;
				this.pointerStart = { x: e.clientX, y: e.clientY };
			};
			this.contentPointerUpHandler = (e: PointerEvent) => {
				if (!this.pointerStart) return;
				if (!this.view.state.field(blockSelectionState).active) {
					this.pointerStart = null;
					return;
				}

				const dx = e.clientX - this.pointerStart.x;
				const dy = e.clientY - this.pointerStart.y;
				this.pointerStart = null;

				// If finger moved more than 10px, it's a scroll, not a tap
				if (Math.sqrt(dx * dx + dy * dy) > 10) return;

				const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
				if (pos === null) return;

				const lineNum = this.view.state.doc.lineAt(pos).number;
				const frontmatterEnd = getFrontmatterEnd(this.view);
				if (lineNum <= frontmatterEnd) return;

				e.preventDefault();
				this.toggleLineWithChildren(lineNum);
			};
			view.contentDOM.addEventListener("pointerdown", this.contentPointerDownHandler);
			view.contentDOM.addEventListener("pointerup", this.contentPointerUpHandler);

			// Long-press (400ms) to enter block mode when editor has no focus
			this.touchStartHandler = (e: TouchEvent) => {
				// Only when not in block mode and editor doesn't have focus
				if (this.view.state.field(blockSelectionState).active) return;
				if (this.view.hasFocus) return;

				const touch = e.touches[0];
				this.longPressStart = { x: touch.clientX, y: touch.clientY };

				// Suppress iOS text selection immediately
				this.view.contentDOM.style.userSelect = "none";
				(this.view.contentDOM.style as any).webkitUserSelect = "none";

				this.longPressTimer = setTimeout(() => {
					this.longPressTimer = null;
					if (!this.longPressStart) return;

					const pos = this.view.posAtCoords(this.longPressStart);
					if (pos === null) { this.clearLongPress(); return; }

					const lineNum = this.view.state.doc.lineAt(pos).number;
					const frontmatterEnd = getFrontmatterEnd(this.view);
					if (lineNum <= frontmatterEnd) { this.clearLongPress(); return; }

					// Enter block mode with this block + children selected
					const [start, end] = getBlockWithChildren(this.view.state, lineNum, 4, true);
					const selected = new Set<number>();
					for (let i = start; i <= end; i++) {
						if (this.view.state.doc.line(i).text.trim() !== "") {
							selected.add(i);
						}
					}

					this.view.dispatch({
						effects: [toggleBlockMode.of(true), setBlockSelection.of(selected)],
					});
					this.view.contentDOM.blur();
					this.clearLongPress();
				}, 800);
			};

			this.touchMoveHandler = (e: TouchEvent) => {
				if (!this.longPressStart || !this.longPressTimer) return;
				const touch = e.touches[0];
				const dx = touch.clientX - this.longPressStart.x;
				const dy = touch.clientY - this.longPressStart.y;
				if (Math.sqrt(dx * dx + dy * dy) > 10) {
					this.cancelLongPress();
				}
			};

			this.touchEndHandler = () => {
				this.cancelLongPress();
			};

			view.contentDOM.addEventListener("touchstart", this.touchStartHandler, { passive: true });
			view.contentDOM.addEventListener("touchmove", this.touchMoveHandler, { passive: true });
			view.contentDOM.addEventListener("touchend", this.touchEndHandler);
			view.contentDOM.addEventListener("touchcancel", this.touchEndHandler);
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

		/**
		 * Toggle selection for a line and its children.
		 * Selecting a parent auto-selects all indented children below it.
		 * If the parent+children are already all selected, deselect them all.
		 */
		private clearLongPress() {
			this.longPressStart = null;
			this.view.contentDOM.style.userSelect = "";
			(this.view.contentDOM.style as any).webkitUserSelect = "";
		}

		private cancelLongPress() {
			if (this.longPressTimer) {
				clearTimeout(this.longPressTimer);
				this.longPressTimer = null;
			}
			this.clearLongPress();
		}

		toggleLineWithChildren(lineNum: number) {
			const state = this.view.state.field(blockSelectionState);
			const [start, end] = getBlockWithChildren(this.view.state, lineNum, 4, true);

			const newSet = new Set(state.selectedBlocks);
			// Check if all lines in the range are already selected
			let allSelected = true;
			for (let i = start; i <= end; i++) {
				const lineText = this.view.state.doc.line(i).text;
				if (lineText.trim() === "") continue;
				if (!newSet.has(i)) {
					allSelected = false;
					break;
				}
			}

			if (allSelected) {
				// Deselect the parent and all children
				for (let i = start; i <= end; i++) {
					newSet.delete(i);
				}
			} else {
				// Select the parent and all children
				for (let i = start; i <= end; i++) {
					const lineText = this.view.state.doc.line(i).text;
					if (lineText.trim() === "") continue;
					newSet.add(i);
				}
			}

			this.view.dispatch({
				effects: [setBlockSelection.of(newSet)],
			});
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
					this.toggleLineWithChildren(lineNum);
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
			this.cancelLongPress();
			this.container.remove();
			this.view.scrollDOM.removeEventListener("scroll", this.scrollHandler);
			this.view.contentDOM.removeEventListener("focus", this.focusHandler);
			this.view.contentDOM.removeEventListener("pointerdown", this.contentPointerDownHandler);
			this.view.contentDOM.removeEventListener("pointerup", this.contentPointerUpHandler);
			this.view.contentDOM.removeEventListener("touchstart", this.touchStartHandler);
			this.view.contentDOM.removeEventListener("touchmove", this.touchMoveHandler);
			this.view.contentDOM.removeEventListener("touchend", this.touchEndHandler);
			this.view.contentDOM.removeEventListener("touchcancel", this.touchEndHandler);
		}
	}
);
