import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Menu, setIcon } from "obsidian";
import { blockSelectionState, setBlockSelection, toggleBlockMode } from "./state";
import { parseDocument, Block } from "./block-parser";
import { blockSelectionGutter } from "./gutter";
import {
	moveBlocksUp, moveBlocksDown,
	indentBlocks, outdentBlocks,
	setHeadingLevel,
	toggleBulletList, toggleNumberedList, toggleCheckbox,
	toggleQuote, toggleCodeFormat,
	toggleInlineFormat,
	cutBlocks, copyBlocks, deleteBlocks,
	insertAbove, insertBelow,
} from "./operations";

// Anchor line for shift+click range selection. Module-level so it persists
// across plugin instances (one per editor view).
let shiftAnchorLine: number | null = null;

const HANDLE_MOVE_THRESHOLD = 5; // px before a press is treated as drag
const WIDGET_GAP = 4;            // px from .cm-content's left edge to widget
const PROBE_X_OFFSET = 60;       // px into content for the posAtCoords probe
const HIDE_AFTER_LEAVE_MS = 100;

/**
 * Desktop-only ViewPlugin: renders a floating widget in `.cm-content`'s left
 * padding that holds an Insert (+) button and a Drag (⋮⋮) handle. The handle
 * opens a context menu on click and initiates block reorder on drag.
 */
export function hoverHandleExtension(indentUnit: string) {
	return ViewPlugin.fromClass(
		class {
			private widget: HTMLElement;
			private plusButton: HTMLButtonElement;
			private handleButton: HTMLButtonElement;
			private currentBlock: Block | null = null;
			private blocksCache: Block[] | null = null;
			private rafPending: boolean = false;
			private lastMouseX: number = 0;
			private lastMouseY: number = 0;
			private mouseMoveHandler: (e: MouseEvent) => void;
			private mouseLeaveHandler: (e: MouseEvent) => void;
			private scrollHandler: () => void;
			private hideTimer: ReturnType<typeof setTimeout> | null = null;
			private isHidden: boolean = true;
			// Drag-to-reorder tracking on the handle button.
			private dragStart: {
				x: number; y: number; startLine: number;
				modifiers: { shift: boolean; meta: boolean; ctrl: boolean };
			} | null = null;
			private dragMoveHandler: (e: PointerEvent) => void;
			private dragEndHandler: (e: PointerEvent) => void;
			// Clicking in the content text clears any block selection so the
			// user can immediately edit. (Desktop only — mobile keeps the
			// tap-to-toggle behavior in gutter.ts.)
			private contentPointerDownHandler: (e: PointerEvent) => void;

			constructor(readonly view: EditorView) {
				this.widget = document.createElement("div");
				this.widget.className = "block-editor-hover-handle";
				this.widget.style.display = "none";

				this.plusButton = document.createElement("button");
				this.plusButton.className = "block-editor-hover-plus";
				this.plusButton.setAttribute("aria-label", "Insert below (shift: above)");
				this.plusButton.type = "button";
				setIcon(this.plusButton, "plus");

				this.handleButton = document.createElement("button");
				this.handleButton.className = "block-editor-hover-grip";
				this.handleButton.setAttribute("aria-label", "Open block menu (drag to move)");
				this.handleButton.type = "button";
				setIcon(this.handleButton, "grip-vertical");

				this.widget.appendChild(this.plusButton);
				this.widget.appendChild(this.handleButton);
				document.body.appendChild(this.widget);

				// ── Hover detection ────────────────────────────────────────
				this.mouseMoveHandler = (e: MouseEvent) => {
					this.lastMouseX = e.clientX;
					this.lastMouseY = e.clientY;
					if (!this.rafPending) {
						this.rafPending = true;
						requestAnimationFrame(() => {
							this.rafPending = false;
							this.updateForMouse(this.lastMouseX, this.lastMouseY);
						});
					}
				};
				this.mouseLeaveHandler = (e: MouseEvent) => {
					// If the pointer is moving onto one of our buttons, don't hide.
					const related = e.relatedTarget as Node | null;
					if (related && this.widget.contains(related)) return;
					if (this.hideTimer) clearTimeout(this.hideTimer);
					this.hideTimer = setTimeout(() => this.hide(), HIDE_AFTER_LEAVE_MS);
				};
				// Buttons have pointer-events: auto, so they catch their own mouse
				// events. When the pointer leaves a button heading somewhere that
				// is *not* contentDOM (or our other button), schedule a hide.
				const onButtonLeave = (e: MouseEvent) => {
					const related = e.relatedTarget as Node | null;
					if (related && this.view.contentDOM.contains(related)) return;
					if (related && this.widget.contains(related)) return;
					if (this.hideTimer) clearTimeout(this.hideTimer);
					this.hideTimer = setTimeout(() => this.hide(), HIDE_AFTER_LEAVE_MS);
				};
				this.plusButton.addEventListener("mouseleave", onButtonLeave);
				this.handleButton.addEventListener("mouseleave", onButtonLeave);
				view.contentDOM.addEventListener("mousemove", this.mouseMoveHandler);
				view.contentDOM.addEventListener("mouseleave", this.mouseLeaveHandler);

				// ── Hide during scroll ─────────────────────────────────────
				this.scrollHandler = () => this.hide();
				view.scrollDOM.addEventListener("scroll", this.scrollHandler);

				// ── Plus button ───────────────────────────────────────────
				this.plusButton.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					if (!this.currentBlock) return;
					const lines = this.blockLineSet(this.currentBlock);
					if (e.shiftKey) insertAbove(view, lines);
					else insertBelow(view, lines);
				});
				this.plusButton.addEventListener("pointerdown", (e) => {
					e.stopPropagation();
				});

				// ── Handle button: track press for click vs drag ─────────
				this.handleButton.addEventListener("pointerdown", (e) => {
					if (e.button !== 0) return;
					if (!this.currentBlock) return;
					e.preventDefault();
					e.stopPropagation();
					this.dragStart = {
						x: e.clientX, y: e.clientY,
						startLine: this.currentBlock.startLine,
						modifiers: { shift: e.shiftKey, meta: e.metaKey, ctrl: e.ctrlKey },
					};
				});

				this.dragMoveHandler = (e: PointerEvent) => {
					if (!this.dragStart) return;
					const dx = e.clientX - this.dragStart.x;
					const dy = e.clientY - this.dragStart.y;
					if (Math.sqrt(dx * dx + dy * dy) <= HANDLE_MOVE_THRESHOLD) return;

					const startLine = this.dragStart.startLine;
					this.dragStart = null;
					this.beginDragReorder(startLine);
				};
				this.dragEndHandler = (e: PointerEvent) => {
					if (!this.dragStart) return;
					const start = this.dragStart;
					this.dragStart = null;
					// No movement → treat as click (plain / modified).
					this.handleClick(e, start);
				};
				document.addEventListener("pointermove", this.dragMoveHandler);
				document.addEventListener("pointerup", this.dragEndHandler);
				document.addEventListener("pointercancel", this.dragEndHandler);

				// ── Click in content text clears selection ────────────────
				this.contentPointerDownHandler = (e: PointerEvent) => {
					if ((e.target as HTMLElement).closest(".block-editor-hover-handle")) return;
					const state = view.state.field(blockSelectionState);
					if (!state.active) return;
					// Exit block mode entirely so editor regains focus naturally.
					view.dispatch({ effects: [toggleBlockMode.of(false)] });
				};
				view.contentDOM.addEventListener("pointerdown", this.contentPointerDownHandler);
			}

			update(update: ViewUpdate) {
				if (update.docChanged) {
					this.blocksCache = null;
				}
				if (update.docChanged || update.viewportChanged || update.geometryChanged) {
					this.hide();
				}
				const gutter = update.view.plugin(blockSelectionGutter) as any;
				if (gutter && gutter.reorderActive) {
					this.hide();
				}
			}

			destroy() {
				this.widget.remove();
				this.view.contentDOM.removeEventListener("mousemove", this.mouseMoveHandler);
				this.view.contentDOM.removeEventListener("mouseleave", this.mouseLeaveHandler);
				this.view.contentDOM.removeEventListener("pointerdown", this.contentPointerDownHandler);
				this.view.scrollDOM.removeEventListener("scroll", this.scrollHandler);
				document.removeEventListener("pointermove", this.dragMoveHandler);
				document.removeEventListener("pointerup", this.dragEndHandler);
				document.removeEventListener("pointercancel", this.dragEndHandler);
				if (this.hideTimer) clearTimeout(this.hideTimer);
			}

			// ── helpers ────────────────────────────────────────────────────

			private hide() {
				if (this.isHidden) return;
				this.widget.style.display = "none";
				this.isHidden = true;
				this.currentBlock = null;
			}

			private show() {
				this.widget.style.display = "";
				this.isHidden = false;
			}

			private getBlocks(): Block[] {
				if (!this.blocksCache) {
					this.blocksCache = parseDocument(this.view.state.doc);
				}
				return this.blocksCache;
			}

			private findBlockContainingLine(lineNum: number): Block | null {
				for (const b of this.getBlocks()) {
					if (lineNum >= b.startLine && lineNum <= b.endLine) return b;
				}
				return null;
			}

			private blockLineSet(block: Block): Set<number> {
				const lines = new Set<number>();
				for (let i = block.startLine; i <= block.endLine; i++) {
					if (this.view.state.doc.line(i).text.trim() !== "") {
						lines.add(i);
					}
				}
				if (lines.size === 0) lines.add(block.startLine);
				return lines;
			}

			private updateForMouse(mouseX: number, mouseY: number) {
				// Hide while a non-collapsed text selection is active in this editor.
				const sel = window.getSelection();
				if (sel && !sel.isCollapsed && sel.anchorNode && this.view.contentDOM.contains(sel.anchorNode)) {
					this.hide();
					return;
				}
				// Hide during reorder drag.
				const gutter = this.view.plugin(blockSelectionGutter) as any;
				if (gutter && gutter.reorderActive) {
					this.hide();
					return;
				}

				const contentRect = this.view.contentDOM.getBoundingClientRect();
				if (mouseY < contentRect.top || mouseY > contentRect.bottom) {
					this.hide();
					return;
				}

				const probeX = contentRect.left + PROBE_X_OFFSET;
				const pos = this.view.posAtCoords({ x: probeX, y: mouseY }, false);
				if (pos === null) {
					this.hide();
					return;
				}
				const line = this.view.state.doc.lineAt(pos);
				const block = this.findBlockContainingLine(line.number);
				if (!block || block.type === "frontmatter") {
					this.hide();
					return;
				}

				this.currentBlock = block;

				const lb = this.view.lineBlockAt(this.view.state.doc.line(block.startLine).from);
				const y = contentRect.top + lb.top;
				// Estimate first-line height for vertical centering.
				const firstLineH = Math.min(lb.height, this.view.defaultLineHeight || 24);
				const widgetH = 24;
				const widgetTop = y + Math.max(0, (firstLineH - widgetH) / 2);
				const widgetLeft = contentRect.left + WIDGET_GAP;

				this.widget.style.top = widgetTop + "px";
				this.widget.style.left = widgetLeft + "px";

				// On blank lines: show only "+" (no grip).
				if (block.type === "blank") {
					this.handleButton.style.display = "none";
				} else {
					this.handleButton.style.display = "";
				}

				if (this.isHidden) this.show();
				if (this.hideTimer) {
					clearTimeout(this.hideTimer);
					this.hideTimer = null;
				}
			}

			private beginDragReorder(startLine: number) {
				const view = this.view;
				const block = this.findBlockContainingLine(startLine);
				if (!block) return;
				const lines = this.blockLineSet(block);
				const state = view.state.field(blockSelectionState);
				const anySelected = Array.from(lines).some(l => state.selectedBlocks.has(l));

				const effects: any[] = [];
				if (!anySelected) {
					effects.push(setBlockSelection.of(lines));
				}
				if (!state.active) {
					effects.push(toggleBlockMode.of(true));
				}
				if (effects.length > 0) {
					view.dispatch({ effects });
				}

				this.hide();

				const gutter = view.plugin(blockSelectionGutter) as any;
				if (gutter && typeof gutter.startHandleReorder === "function") {
					gutter.startHandleReorder(block.startLine);
				}
			}

			private handleClick(
				e: PointerEvent,
				start: { startLine: number; modifiers: { shift: boolean; meta: boolean; ctrl: boolean } }
			) {
				const view = this.view;
				const block = this.findBlockContainingLine(start.startLine);
				if (!block) return;
				const lines = this.blockLineSet(block);
				const state = view.state.field(blockSelectionState);

				// Ctrl/Cmd-click: symmetric-difference toggle (no menu).
				if (start.modifiers.meta || start.modifiers.ctrl) {
					const sel = new Set(state.selectedBlocks);
					const anyMissing = Array.from(lines).some(l => !sel.has(l));
					if (anyMissing) {
						for (const l of lines) sel.add(l);
					} else {
						for (const l of lines) sel.delete(l);
					}
					const effects: any[] = [setBlockSelection.of(sel)];
					if (!state.active && sel.size > 0) effects.push(toggleBlockMode.of(true));
					view.dispatch({ effects });
					shiftAnchorLine = block.startLine;
					return;
				}

				// Shift-click: range select from anchor to this block (no menu).
				if (start.modifiers.shift && shiftAnchorLine !== null) {
					const blocks = this.getBlocks();
					const a = Math.min(shiftAnchorLine, block.startLine);
					const b = Math.max(shiftAnchorLine, block.startLine);
					const newSel = new Set<number>();
					for (const blk of blocks) {
						if (
							blk.startLine >= a && blk.startLine <= b &&
							blk.type !== "blank" && blk.type !== "frontmatter"
						) {
							for (const l of this.blockLineSet(blk)) newSel.add(l);
						}
					}
					const effects: any[] = [setBlockSelection.of(newSel)];
					if (!state.active && newSel.size > 0) effects.push(toggleBlockMode.of(true));
					view.dispatch({ effects });
					return;
				}

				// Plain click: replace selection with this block, then open menu.
				const effects: any[] = [setBlockSelection.of(lines)];
				if (!state.active) effects.push(toggleBlockMode.of(true));
				view.dispatch({ effects });
				shiftAnchorLine = block.startLine;
				this.openMenu(e);
			}

			private openMenu(evt: PointerEvent) {
				const view = this.view;
				const sel = () => view.state.field(blockSelectionState).selectedBlocks;
				const menu = new Menu();

				menu.addItem(item => {
					item.setTitle("Turn into").setIcon("text");
					const sub = (item as any).setSubmenu();
					const head = (title: string, level: number, icon: string) => {
						sub.addItem((s: any) =>
							s.setTitle(title).setIcon(icon).onClick(() =>
								setHeadingLevel(view, sel(), level)
							)
						);
					};
					head("Body", 0, "text");
					head("Heading 1", 1, "heading-1");
					head("Heading 2", 2, "heading-2");
					head("Heading 3", 3, "heading-3");
					head("Heading 4", 4, "heading-4");
					sub.addSeparator();
					sub.addItem((s: any) =>
						s.setTitle("Bullet list").setIcon("list").onClick(() => toggleBulletList(view, sel()))
					);
					sub.addItem((s: any) =>
						s.setTitle("Numbered list").setIcon("list-ordered").onClick(() => toggleNumberedList(view, sel()))
					);
					sub.addItem((s: any) =>
						s.setTitle("Checklist").setIcon("check-square").onClick(() => toggleCheckbox(view, sel()))
					);
					sub.addItem((s: any) =>
						s.setTitle("Quote").setIcon("text-quote").onClick(() => toggleQuote(view, sel()))
					);
					sub.addItem((s: any) =>
						s.setTitle("Code").setIcon("code").onClick(() => toggleCodeFormat(view, sel()))
					);
				});

				menu.addItem(item => {
					item.setTitle("Format").setIcon("type");
					const sub = (item as any).setSubmenu();
					sub.addItem((s: any) =>
						s.setTitle("Bold").setIcon("bold").onClick(() => toggleInlineFormat(view, sel(), "**"))
					);
					sub.addItem((s: any) =>
						s.setTitle("Italic").setIcon("italic").onClick(() => toggleInlineFormat(view, sel(), "*"))
					);
					sub.addItem((s: any) =>
						s.setTitle("Strikethrough").setIcon("strikethrough").onClick(() => toggleInlineFormat(view, sel(), "~~"))
					);
					sub.addItem((s: any) =>
						s.setTitle("Highlight").setIcon("highlighter").onClick(() => toggleInlineFormat(view, sel(), "=="))
					);
					sub.addItem((s: any) =>
						s.setTitle("Inline code").setIcon("code").onClick(() => toggleInlineFormat(view, sel(), "`"))
					);
				});

				menu.addSeparator();
				menu.addItem(i => i.setTitle("Move up").setIcon("arrow-up").onClick(() => moveBlocksUp(view, sel())));
				menu.addItem(i => i.setTitle("Move down").setIcon("arrow-down").onClick(() => moveBlocksDown(view, sel())));
				menu.addItem(i => i.setTitle("Indent").setIcon("indent").onClick(() => indentBlocks(view, sel(), indentUnit)));
				menu.addItem(i => i.setTitle("Outdent").setIcon("outdent").onClick(() => outdentBlocks(view, sel(), indentUnit)));
				menu.addSeparator();
				menu.addItem(i => i.setTitle("Cut").setIcon("scissors").onClick(() => cutBlocks(view, sel())));
				menu.addItem(i => i.setTitle("Copy").setIcon("copy").onClick(() => copyBlocks(view, sel())));
				menu.addSeparator();
				menu.addItem(i => i.setTitle("Delete").setIcon("trash-2").onClick(() => deleteBlocks(view, sel())));

				menu.showAtMouseEvent(evt);
			}
		}
	);
}
