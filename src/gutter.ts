import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { EditorState, Transaction } from "@codemirror/state";
import { blockSelectionState, setBlockSelection, toggleBlockMode } from "./state";
import { blockEditorTransaction, moveBlocksToPosition } from "./operations";
import { getBlockWithChildren } from "./block-utils";
import { parseDocument } from "./block-parser";

/**
 * Module-level exit cooldown — set by main.ts when auto-exiting block mode
 * so the focus handler can suppress focus briefly after exit.
 */
let gutterExitCooldownUntil = 0;
export function setExitCooldown(_view: EditorView, until: number) {
	gutterExitCooldownUntil = until;
}

/**
 * Module-level flag: true while a drag-select gesture is in progress.
 * Used by main.ts to suppress auto-exit during drag deselection.
 */
let dragSelectActive = false;
export function isDragSelecting(): boolean {
	return dragSelectActive;
}

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
		// Drag-select across circles
		private circlePositions: Array<{ lineNum: number; centerY: number }> = [];
		private dragAnchorLine: number | null = null;
		private dragSelectionBefore: Set<number> = new Set();
		private dragIsDeselecting: boolean = false;
		private dragLastLine: number | null = null;
		private dragMoveHandler: (e: PointerEvent) => void;
		private dragEndHandler: (e: PointerEvent) => void;
		// Auto-scroll during drag
		private autoScrollRAF: number | null = null;
		private autoScrollSpeed: number = 0;
		private lastDragClientX: number = 0;
		private lastDragClientY: number = 0;
		// Reorder drag
		private reorderActive: boolean = false;
		private reorderTimer: ReturnType<typeof setTimeout> | null = null;
		private reorderStartPos: { x: number; y: number } | null = null;
		private reorderStartLine: number | null = null;
		// Where the reorder gesture started — affects timer-cancel fallback.
		// "circle" → cancelling falls back to drag-select circles.
		// "content" → cancelling just aborts; click is handled by dragEnd's toggle.
		private reorderSource: "circle" | "content" | null = null;
		private reorderIndicator: HTMLElement | null = null;
		private reorderIndicatorShown: boolean = false;
		private reorderDropTargets: Array<{ insertIdx: number; y: number }> = [];
		private reorderCurrentTarget: number = -1;
		private reorderOriginalIdx: number = -1;
		// Margin drag-to-select (desktop)
		private marginDragStart: { x: number; y: number; scrollTop: number } | null = null;
		private marginDragActive: boolean = false;
		private marginSelectBox: HTMLElement | null = null;
		private scrollDOMPointerDownHandler: (e: PointerEvent) => void;

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
				if (this.view.state.field(blockSelectionState).active ||
					Date.now() < gutterExitCooldownUntil) {
					setTimeout(() => this.view.contentDOM.blur(), 0);
				}
			};
			view.contentDOM.addEventListener("focus", this.focusHandler);

			// Tap anywhere on a line to toggle selection — use pointerdown/up
			// pair to distinguish taps from scroll drags
			this.contentPointerDownHandler = (e: PointerEvent) => {
				if (!this.view.state.field(blockSelectionState).active) return;
				if ((e.target as HTMLElement).closest(".block-editor-gutter-circle")) return;

				// Mouse/pen press on a selected line in block mode → reorder candidate.
				// Touch is intentionally excluded so we don't fight iOS native
				// long-press for word selection.
				if (e.pointerType === "mouse" || e.pointerType === "pen") {
					const onSelected = (e.target as HTMLElement)
						.closest(".cm-line.block-editor-selected-line");
					if (onSelected) {
						const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
						if (pos !== null) {
							const lineNum = this.view.state.doc.lineAt(pos).number;
							e.preventDefault(); // suppress native text selection
							this.reorderStartPos = { x: e.clientX, y: e.clientY };
							this.reorderStartLine = lineNum;
							this.reorderSource = "content";
							this.reorderTimer = setTimeout(() => {
								this.reorderTimer = null;
								this.enterReorderMode();
							}, 200);
							return;
						}
					}
				}

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

				// If the tap landed to the left of the first character on the line
				// it's a click in the visual left margin — deselect all and exit.
				const line = this.view.state.doc.line(lineNum);
				const lineStartCoords = this.view.coordsAtPos(line.from);
				if (lineStartCoords && e.clientX < lineStartCoords.left) {
					this.view.dispatch({ effects: [setBlockSelection.of(new Set())] });
					return;
				}

				e.preventDefault();
				this.toggleLineWithChildren(lineNum);
			};
			view.contentDOM.addEventListener("pointerdown", this.contentPointerDownHandler);
			view.contentDOM.addEventListener("pointerup", this.contentPointerUpHandler);

			// Long-press (800ms) to enter block mode when editor has no focus
			this.touchStartHandler = (e: TouchEvent) => {
				// Only when not in block mode and editor doesn't have focus
				if (this.view.state.field(blockSelectionState).active) return;
				if (this.view.hasFocus) return;

				const touch = e.touches[0];
				this.longPressStart = { x: touch.clientX, y: touch.clientY };

				// Suppress iOS text selection and callout menu immediately
				this.view.contentDOM.style.userSelect = "none";
				(this.view.contentDOM.style as any).webkitUserSelect = "none";
				(this.view.contentDOM.style as any).webkitTouchCallout = "none";

				this.longPressTimer = setTimeout(() => {
					this.longPressTimer = null;
					if (!this.longPressStart) return;

					const pos = this.view.posAtCoords(this.longPressStart);
					if (pos === null) { this.clearLongPress(); return; }

					const lineNum = this.view.state.doc.lineAt(pos).number;
					const frontmatterEnd = getFrontmatterEnd(this.view);
					if (lineNum <= frontmatterEnd) { this.clearLongPress(); return; }

					// Enter block mode with this parser block selected
					const allBlocks = parseDocument(this.view.state.doc);
					const pressedBlock = allBlocks.find(b => lineNum >= b.startLine && lineNum <= b.endLine);
					const selected = new Set<number>();
					if (pressedBlock && pressedBlock.type !== "blank" && pressedBlock.type !== "frontmatter") {
						let blockEnd = pressedBlock.endLine;
						if (pressedBlock.type === "list-item") {
							const [, childEnd] = getBlockWithChildren(this.view.state, pressedBlock.startLine, 4, true);
							blockEnd = Math.max(blockEnd, childEnd);
						}
						for (let i = pressedBlock.startLine; i <= blockEnd; i++) {
							if (this.view.state.doc.line(i).text.trim() !== "") {
								selected.add(i);
							}
						}
					}

					this.view.dispatch({
						effects: [toggleBlockMode.of(true), setBlockSelection.of(selected)],
					});
					// Clear any native text selection iOS may have started
					const winSel = window.getSelection();
					if (winSel) winSel.removeAllRanges();
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

			// Margin drag-to-select: left margin click-and-drag on desktop
			this.scrollDOMPointerDownHandler = (e: PointerEvent) => {
				if (e.pointerType === "touch") return;
				if (e.button !== 0) return;
				const contentRect = this.view.contentDOM.getBoundingClientRect();
				if (e.clientX >= contentRect.left) return;
				e.preventDefault();
				this.marginDragStart = {
					x: e.clientX,
					y: e.clientY,
					scrollTop: this.view.scrollDOM.scrollTop,
				};
			};
			view.scrollDOM.addEventListener("pointerdown", this.scrollDOMPointerDownHandler);

			// Drag-select: pointermove/up on document to track finger across circles
			this.dragMoveHandler = (e: PointerEvent) => {
				if (this.marginDragStart) {
					this.updateMarginDrag(e);
					return;
				}

				if (this.reorderTimer && this.reorderStartPos) {
					const dx = e.clientX - this.reorderStartPos.x;
					const dy = e.clientY - this.reorderStartPos.y;
					if (Math.sqrt(dx * dx + dy * dy) > 10) {
						const source = this.reorderSource;
						this.cancelReorderTimer();
						// Only the circle path falls back to drag-select. A content
						// press that moves before the hold completes simply aborts.
						if (source === "circle" && this.reorderStartLine !== null) {
							this.startDragSelect(this.reorderStartLine);
							this.toggleLineWithChildren(this.reorderStartLine);
						}
						this.reorderStartLine = null;
					}
					return;
				}

				if (this.reorderActive) {
					this.lastDragClientY = e.clientY;
					this.updateReorderDrag(e.clientY);
					this.updateAutoScroll(e.clientY);
					return;
				}

				if (this.dragAnchorLine === null) return;
				this.lastDragClientY = e.clientY;
				if (!dragSelectActive) dragSelectActive = true;
				this.updateDragSelection(e.clientY);
				this.updateAutoScroll(e.clientY);
			};

			this.dragEndHandler = () => {
				if (this.marginDragStart) {
					this.finalizeMarginDrag();
					return;
				}

				if (this.reorderTimer) {
					this.cancelReorderTimer();
					if (this.reorderStartLine !== null) {
						this.toggleLineWithChildren(this.reorderStartLine);
						this.reorderStartLine = null;
					}
					return;
				}

				if (this.reorderActive) {
					this.finalizeReorder();
					return;
				}

				this.stopAutoScroll();
				this.dragAnchorLine = null;
				this.dragLastLine = null;
				dragSelectActive = false;
			};

			document.addEventListener("pointermove", this.dragMoveHandler);
			document.addEventListener("pointerup", this.dragEndHandler);
			document.addEventListener("pointercancel", this.dragEndHandler);
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
			(this.view.contentDOM.style as any).webkitTouchCallout = "";
		}

		private cancelLongPress() {
			if (this.longPressTimer) {
				clearTimeout(this.longPressTimer);
				this.longPressTimer = null;
			}
			this.clearLongPress();
		}

		/**
		 * Find the nearest circle line number for a given screen Y position.
		 */
		private findNearestCircleLine(y: number): number | null {
			let best: number | null = null;
			let bestDist = Infinity;
			for (const cp of this.circlePositions) {
				const dist = Math.abs(y - cp.centerY);
				if (dist < bestDist) {
					bestDist = dist;
					best = cp.lineNum;
				}
			}
			// During auto-scroll the finger is at the edge, so allow a larger tolerance
			const maxDist = this.autoScrollSpeed !== 0 ? 200 : 40;
			return bestDist < maxDist ? best : null;
		}

		/**
		 * Update selection based on current drag Y position.
		 */
		private updateDragSelection(clientY: number) {
			// Rebuild circle positions since scroll may have changed them
			this.rebuildCirclePositions();

			const lineNum = this.findNearestCircleLine(clientY);
			if (lineNum === null || lineNum === this.dragLastLine) return;
			this.dragLastLine = lineNum;

			const newSet = new Set(this.dragSelectionBefore);
			const lo = Math.min(this.dragAnchorLine!, lineNum);
			const hi = Math.max(this.dragAnchorLine!, lineNum);
			const doc = this.view.state.doc;

			const dragLines = new Set<number>();
			for (let ln = lo; ln <= hi; ln++) {
				const [start, end] = getBlockWithChildren(this.view.state, ln, 4, true);
				for (let i = start; i <= end; i++) {
					if (i >= 1 && i <= doc.lines && doc.line(i).text.trim() !== "") {
						dragLines.add(i);
					}
				}
			}

			if (this.dragIsDeselecting) {
				for (const ln of dragLines) { newSet.delete(ln); }
			} else {
				for (const ln of dragLines) { newSet.add(ln); }
			}

			if (navigator.vibrate) navigator.vibrate(5);

			this.view.dispatch({
				effects: [setBlockSelection.of(newSet)],
			});
		}

		/**
		 * Compute the set of line numbers that should have a gutter circle.
		 * One circle per block at startLine for all content block types.
		 * blank / frontmatter: no circle.
		 */
		private getCircleLines(): Set<number> {
			const doc = this.view.state.doc;
			const blocks = parseDocument(doc);
			const circleLines = new Set<number>();
			for (const block of blocks) {
				if (block.type === "frontmatter" || block.type === "blank") continue;
				circleLines.add(block.startLine);
			}
			return circleLines;
		}

		private rebuildCirclePositions() {
			const doc = this.view.state.doc;
			const contentTop = this.view.contentDOM.getBoundingClientRect().top;
			const scrollerRect = this.view.scrollDOM.getBoundingClientRect();
			const circleLines = this.getCircleLines();

			this.circlePositions = [];
			const { from, to } = this.view.viewport;
			const startLine = doc.lineAt(from).number;
			const endLine = doc.lineAt(to).number;

			for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
				if (!circleLines.has(lineNum)) continue;

				const line = doc.line(lineNum);
				const block = this.view.lineBlockAt(line.from);
				const screenY = contentTop + block.top;
				if (screenY + block.height < scrollerRect.top) continue;
				if (screenY > scrollerRect.bottom) continue;

				const circleTop = screenY + (block.height - 28) / 2;
				this.circlePositions.push({ lineNum, centerY: circleTop + 14 });
			}
		}

		/**
		 * Start or update auto-scrolling based on pointer proximity to edges.
		 */
		private updateAutoScroll(clientY: number) {
			const scrollerRect = this.view.scrollDOM.getBoundingClientRect();
			// Desktop pointer-driven gestures (margin drag-select, content-source
			// reorder) use a tighter 100px zone since the mouse is precise.
			// Touch-based circle drag-select and circle-source reorder use the
			// wider 250px zone for fingers.
			const desktopGesture =
				this.marginDragActive ||
				(this.reorderActive && this.reorderSource === "content");
			const edgeZone = desktopGesture ? 70 : 250;
			const maxSpeed = 30; // px per frame

			if (clientY < scrollerRect.top + edgeZone) {
				// Near top edge — scroll up
				const proximity = (scrollerRect.top + edgeZone - clientY) / edgeZone;
				this.autoScrollSpeed = -maxSpeed * Math.min(proximity, 1);
			} else if (clientY > scrollerRect.bottom - edgeZone) {
				// Near bottom edge — scroll down
				const proximity = (clientY - (scrollerRect.bottom - edgeZone)) / edgeZone;
				this.autoScrollSpeed = maxSpeed * Math.min(proximity, 1);
			} else {
				this.stopAutoScroll();
				return;
			}

			// Start the scroll loop if not already running
			if (this.autoScrollRAF === null) {
				this.autoScrollLoop();
			}
		}

		private autoScrollLoop() {
			if (this.autoScrollSpeed === 0 ||
				(!this.reorderActive && this.dragAnchorLine === null && !this.marginDragActive)) {
				this.stopAutoScroll();
				return;
			}

			this.view.scrollDOM.scrollTop += this.autoScrollSpeed;
			this.buildGutter();

			if (this.reorderActive) {
				this.computeDropTargets();
				this.updateReorderDrag(this.lastDragClientY);
			} else if (this.marginDragActive) {
				this.refreshMarginDrag();
			} else {
				this.updateDragSelection(this.lastDragClientY);
			}

			this.autoScrollRAF = requestAnimationFrame(() => this.autoScrollLoop());
		}

		private stopAutoScroll() {
			this.autoScrollSpeed = 0;
			if (this.autoScrollRAF !== null) {
				cancelAnimationFrame(this.autoScrollRAF);
				this.autoScrollRAF = null;
			}
		}

		// ── Margin drag-to-select ─────────────────────────────────────────

		private updateMarginDrag(e: PointerEvent) {
			if (!this.marginDragStart) return;
			this.lastDragClientX = e.clientX;
			this.lastDragClientY = e.clientY;
			this.refreshMarginDrag();
			this.updateAutoScroll(e.clientY);
		}

		// Separated so autoScrollLoop can call it without a PointerEvent.
		private refreshMarginDrag() {
			if (!this.marginDragStart) return;

			const currentScrollTop = this.view.scrollDOM.scrollTop;
			// Translate origin from the client Y at drag-start into the current
			// client frame, compensating for any scrolling since then.
			const originClientY =
				this.marginDragStart.y + this.marginDragStart.scrollTop - currentScrollTop;

			const dy = Math.abs(this.lastDragClientY - originClientY);
			if (!this.marginDragActive && dy < 5) return;

			if (!this.marginDragActive) {
				this.marginDragActive = true;
				dragSelectActive = true;
				this.marginSelectBox = document.createElement("div");
				this.marginSelectBox.className = "block-editor-margin-select";
				document.body.appendChild(this.marginSelectBox);
			}

			const selTop = Math.min(originClientY, this.lastDragClientY);
			const selBottom = Math.max(originClientY, this.lastDragClientY);
			const x1 = Math.min(this.marginDragStart.x, this.lastDragClientX);
			const x2 = Math.max(this.marginDragStart.x, this.lastDragClientX);

			// Clip visible box to the scroller rect so it doesn't bleed past the editor.
			const scrollerRect = this.view.scrollDOM.getBoundingClientRect();
			const visTop = Math.max(selTop, scrollerRect.top);
			const visBottom = Math.min(selBottom, scrollerRect.bottom);

			this.marginSelectBox!.style.left = x1 + "px";
			this.marginSelectBox!.style.width = Math.max(0, x2 - x1) + "px";
			this.marginSelectBox!.style.top = visTop + "px";
			this.marginSelectBox!.style.height = Math.max(1, visBottom - visTop) + "px";

			this.updateMarginSelection(selTop, selBottom);
		}

		private updateMarginSelection(selTop: number, selBottom: number) {
			const doc = this.view.state.doc;
			const contentTop = this.view.contentDOM.getBoundingClientRect().top;
			const scrollerRect = this.view.scrollDOM.getBoundingClientRect();
			const allBlocks = parseDocument(doc);
			const newSelected = new Set<number>();

			for (const block of allBlocks) {
				if (block.type === "blank" || block.type === "frontmatter") continue;

				const startLB = this.view.lineBlockAt(doc.line(block.startLine).from);
				const endLB = this.view.lineBlockAt(doc.line(block.endLine).from);
				const blockTop = contentTop + startLB.top;
				const blockBottom = contentTop + endLB.top + endLB.height;

				if (blockBottom < scrollerRect.top || blockTop > scrollerRect.bottom) continue;
				if (blockBottom <= selTop || blockTop >= selBottom) continue;

				for (let i = block.startLine; i <= block.endLine; i++) {
					if (doc.line(i).text.trim() !== "") newSelected.add(i);
				}
				if (block.type === "list-item") {
					const [, childEnd] = getBlockWithChildren(this.view.state, block.startLine, 4, true);
					for (let i = block.endLine + 1; i <= childEnd; i++) {
						if (doc.line(i).text.trim() !== "") newSelected.add(i);
					}
				}
			}

			const state = this.view.state.field(blockSelectionState);
			if (!state.active) {
				if (newSelected.size > 0) {
					this.view.dispatch({
						effects: [toggleBlockMode.of(true), setBlockSelection.of(newSelected)],
					});
					this.view.contentDOM.blur();
				}
			} else {
				this.view.dispatch({ effects: [setBlockSelection.of(newSelected)] });
			}
		}

		private finalizeMarginDrag() {
			this.stopAutoScroll();
			if (this.marginSelectBox) {
				this.marginSelectBox.remove();
				this.marginSelectBox = null;
			}
			const wasClick = !this.marginDragActive;
			this.marginDragActive = false;
			this.marginDragStart = null;
			dragSelectActive = false;
			// Plain click (no drag) in the margin while block mode is active → deselect all.
			if (wasClick) {
				const state = this.view.state.field(blockSelectionState);
				if (state.active) {
					this.view.dispatch({ effects: [setBlockSelection.of(new Set())] });
				}
			}
		}

		// ── Reorder drag ──────────────────────────────────────────────────

		private enterReorderMode() {
			this.reorderActive = true;
			this.reorderIndicatorShown = false;
			this.dragAnchorLine = null;

			if (navigator.vibrate) navigator.vibrate(30);

			// Visual cue: selected blocks "lift" via a body-scoped class
			// (CSS handles the shadow / tint transition).
			document.body.classList.add("block-editor-reorder-active");

			// Don't show indicator yet — only show once user drags to a different slot
			this.computeDropTargets();
		}

		private computeDropTargets() {
			const state = this.view.state.field(blockSelectionState);
			const doc = this.view.state.doc;
			const allBlocks = parseDocument(doc, state.selectedBlocks);
			const nonBlank = allBlocks.filter(b => b.type !== "frontmatter" && b.type !== "blank");

			const remainingBlocks: Array<{ startLine: number; endLine: number }> = [];
			let firstSelectedStartLine = -1;
			let selStartIdx = -1;
			let countBefore = 0;

			for (let i = 0; i < nonBlank.length; i++) {
				if (nonBlank[i].selected) {
					if (selStartIdx < 0) {
						selStartIdx = i;
						firstSelectedStartLine = nonBlank[i].startLine;
					}
				} else {
					if (selStartIdx < 0) countBefore++;
					remainingBlocks.push({
						startLine: nonBlank[i].startLine,
						endLine: nonBlank[i].endLine,
					});
				}
			}

			this.reorderOriginalIdx = countBefore;

			if (remainingBlocks.length === 0) {
				this.reorderDropTargets = [];
				return;
			}

			const contentTop = this.view.contentDOM.getBoundingClientRect().top;
			this.reorderDropTargets = [];

			const screenTop = (lineNum: number) => {
				const lb = this.view.lineBlockAt(doc.line(lineNum).from);
				return contentTop + lb.top;
			};
			const screenBottom = (lineNum: number) => {
				const lb = this.view.lineBlockAt(doc.line(lineNum).from);
				return contentTop + lb.top + lb.height;
			};

			// Before first remaining block (insertIdx = 0)
			if (countBefore === 0 && firstSelectedStartLine > 0) {
				this.reorderDropTargets.push({
					insertIdx: 0,
					y: screenTop(firstSelectedStartLine),
				});
			} else {
				this.reorderDropTargets.push({
					insertIdx: 0,
					y: screenTop(remainingBlocks[0].startLine),
				});
			}

			// Between remaining blocks
			for (let i = 0; i < remainingBlocks.length - 1; i++) {
				const insertIdx = i + 1;
				const prevBottom = screenBottom(remainingBlocks[i].endLine);

				let nextTop: number;
				if (insertIdx === countBefore && firstSelectedStartLine > 0) {
					nextTop = screenTop(firstSelectedStartLine);
				} else {
					nextTop = screenTop(remainingBlocks[i + 1].startLine);
				}

				this.reorderDropTargets.push({
					insertIdx,
					y: (prevBottom + nextTop) / 2,
				});
			}

			// After last remaining block (insertIdx = remainingBlocks.length)
			if (countBefore === remainingBlocks.length && firstSelectedStartLine > 0) {
				const prevBottom = screenBottom(remainingBlocks[remainingBlocks.length - 1].endLine);
				this.reorderDropTargets.push({
					insertIdx: remainingBlocks.length,
					y: (prevBottom + screenTop(firstSelectedStartLine)) / 2,
				});
			} else {
				this.reorderDropTargets.push({
					insertIdx: remainingBlocks.length,
					y: screenBottom(remainingBlocks[remainingBlocks.length - 1].endLine),
				});
			}
		}

		private updateReorderDrag(clientY: number) {
			if (this.reorderDropTargets.length === 0) return;

			let bestIdx = 0;
			let bestDist = Infinity;
			for (let i = 0; i < this.reorderDropTargets.length; i++) {
				const dist = Math.abs(clientY - this.reorderDropTargets[i].y);
				if (dist < bestDist) {
					bestDist = dist;
					bestIdx = i;
				}
			}

			if (!this.reorderIndicatorShown) {
				// Only reveal indicator once user has moved at least one slot from home
				if (bestIdx === this.reorderOriginalIdx) return;
				this.reorderIndicatorShown = true;
				this.reorderCurrentTarget = bestIdx;
				this.reorderIndicator = document.createElement("div");
				this.reorderIndicator.className = "block-editor-drop-indicator";
				document.body.appendChild(this.reorderIndicator);
				if (navigator.vibrate) navigator.vibrate(5);
				this.reorderIndicator.style.top =
					this.reorderDropTargets[bestIdx].y - 1 + "px";
				return;
			}

			if (bestIdx !== this.reorderCurrentTarget) {
				this.reorderCurrentTarget = bestIdx;
				if (navigator.vibrate) navigator.vibrate(5);
				if (this.reorderIndicator) {
					this.reorderIndicator.style.top =
						this.reorderDropTargets[bestIdx].y - 1 + "px";
				}
			}
		}

		private finalizeReorder() {
			if (this.reorderIndicator) {
				this.reorderIndicator.remove();
				this.reorderIndicator = null;
			}

			this.stopAutoScroll();
			this.reorderActive = false;
			document.body.classList.remove("block-editor-reorder-active");

			// Only execute move if the indicator was ever shown (user actually dragged)
			if (
				this.reorderIndicatorShown &&
				this.reorderCurrentTarget >= 0 &&
				this.reorderCurrentTarget < this.reorderDropTargets.length
			) {
				const st = this.view.state.field(blockSelectionState);
				moveBlocksToPosition(
					this.view,
					st.selectedBlocks,
					this.reorderDropTargets[this.reorderCurrentTarget].insertIdx
				);
			}

			this.reorderIndicatorShown = false;
			this.reorderDropTargets = [];
			this.reorderCurrentTarget = -1;
			this.reorderOriginalIdx = -1;
			this.reorderStartPos = null;
			this.reorderStartLine = null;
			this.reorderSource = null;
		}

		private cancelReorderTimer() {
			if (this.reorderTimer) {
				clearTimeout(this.reorderTimer);
				this.reorderTimer = null;
			}
			this.reorderStartPos = null;
			this.reorderSource = null;
		}

		private cancelReorder() {
			if (this.reorderIndicator) {
				this.reorderIndicator.remove();
				this.reorderIndicator = null;
			}
			this.reorderActive = false;
			document.body.classList.remove("block-editor-reorder-active");
			this.reorderIndicatorShown = false;
			this.stopAutoScroll();
			this.reorderDropTargets = [];
			this.reorderCurrentTarget = -1;
			this.reorderOriginalIdx = -1;
			this.reorderStartPos = null;
			this.reorderStartLine = null;
			this.reorderSource = null;
		}

		/**
		 * Start drag-select from a circle. Called BEFORE toggleLineWithChildren
		 * so we can check if the line was already selected (deselect mode) or not.
		 */
		private startDragSelect(lineNum: number) {
			const state = this.view.state.field(blockSelectionState);
			// If line was selected before this tap, the tap will deselect it → drag deselects
			this.dragIsDeselecting = state.selectedBlocks.has(lineNum);
			// Don't set dragSelectActive here — only set it when pointer actually moves
			// (in dragMoveHandler). This allows auto-exit to work on simple taps.
			this.dragSelectionBefore = new Set(state.selectedBlocks);
			this.dragAnchorLine = lineNum;
			this.dragLastLine = lineNum;
		}

		toggleLineWithChildren(lineNum: number) {
			const state = this.view.state.field(blockSelectionState);
			const doc = this.view.state.doc;

			// Find the block containing lineNum using the parser
			const blocks = parseDocument(doc);
			const block = blocks.find(b => lineNum >= b.startLine && lineNum <= b.endLine);

			let start: number;
			let end: number;
			if (block && block.type !== "blank" && block.type !== "frontmatter") {
				start = block.startLine;
				if (block.type === "list-item") {
					// Expand to include indented children (nested list items below)
					const [, childEnd] = getBlockWithChildren(this.view.state, block.startLine, 4, true);
					end = Math.max(block.endLine, childEnd);
				} else {
					end = block.endLine;
				}
			} else {
				const [s, e] = getBlockWithChildren(this.view.state, lineNum, 4, true);
				start = s;
				end = e;
			}

			const newSet = new Set(state.selectedBlocks);
			let allSelected = true;
			for (let i = start; i <= end; i++) {
				const lineText = doc.line(i).text;
				if (lineText.trim() === "") continue;
				if (!newSet.has(i)) {
					allSelected = false;
					break;
				}
			}

			if (allSelected) {
				for (let i = start; i <= end; i++) {
					newSet.delete(i);
				}
			} else {
				for (let i = start; i <= end; i++) {
					const lineText = doc.line(i).text;
					if (lineText.trim() === "") continue;
					newSet.add(i);
				}
			}

			// Haptic feedback (works on Android; no-op where unsupported)
			if (navigator.vibrate) {
				navigator.vibrate(5);
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

			const { from, to } = this.view.viewport;
			const doc = this.view.state.doc;
			const startLine = doc.lineAt(from).number;
			const endLine = doc.lineAt(to).number;

			const contentTop = this.view.contentDOM.getBoundingClientRect().top;
			const scrollerRect = this.view.scrollDOM.getBoundingClientRect();
			const circleLeft = scrollerRect.right - 44;

			this.circlePositions = [];
			const circleLines = this.getCircleLines();

			for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
				if (!circleLines.has(lineNum)) continue;

				const line = doc.line(lineNum);
				const block = this.view.lineBlockAt(line.from);
				const screenY = contentTop + block.top;

				if (screenY + block.height < scrollerRect.top) continue;
				if (screenY > scrollerRect.bottom) continue;

				const circle = document.createElement("div");
				circle.className = "block-editor-gutter-circle";
				if (state.selectedBlocks.has(lineNum)) {
					circle.classList.add("selected");
				}

				const circleTop = screenY + (block.height - 28) / 2;
				circle.style.top = circleTop + "px";
				circle.style.left = circleLeft + "px";

				this.circlePositions.push({ lineNum, centerY: circleTop + 14 });

				circle.addEventListener("pointerdown", (e) => {
					e.preventDefault();
					e.stopPropagation();
					if (state.selectedBlocks.has(lineNum)) {
						this.reorderStartPos = { x: e.clientX, y: e.clientY };
						this.reorderStartLine = lineNum;
						this.reorderSource = "circle";
						this.reorderTimer = setTimeout(() => {
							this.reorderTimer = null;
							this.enterReorderMode();
						}, 300);
					} else {
						this.startDragSelect(lineNum);
						this.toggleLineWithChildren(lineNum);
					}
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
			this.cancelReorderTimer();
			this.cancelReorder();
			this.finalizeMarginDrag();
			this.stopAutoScroll();
			this.dragAnchorLine = null;
			this.container.remove();
			this.view.scrollDOM.removeEventListener("scroll", this.scrollHandler);
			this.view.scrollDOM.removeEventListener("pointerdown", this.scrollDOMPointerDownHandler);
			this.view.contentDOM.removeEventListener("focus", this.focusHandler);
			this.view.contentDOM.removeEventListener("pointerdown", this.contentPointerDownHandler);
			this.view.contentDOM.removeEventListener("pointerup", this.contentPointerUpHandler);
			this.view.contentDOM.removeEventListener("touchstart", this.touchStartHandler);
			this.view.contentDOM.removeEventListener("touchmove", this.touchMoveHandler);
			this.view.contentDOM.removeEventListener("touchend", this.touchEndHandler);
			this.view.contentDOM.removeEventListener("touchcancel", this.touchEndHandler);
			document.removeEventListener("pointermove", this.dragMoveHandler);
			document.removeEventListener("pointerup", this.dragEndHandler);
			document.removeEventListener("pointercancel", this.dragEndHandler);
		}
	}
);
