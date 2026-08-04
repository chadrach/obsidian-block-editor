import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Menu, setIcon } from "obsidian";

// @codemirror/commands is bundled by Obsidian but not installed locally.
const cmCommands = require("@codemirror/commands") as { undo: (view: EditorView) => boolean; redo: (view: EditorView) => boolean };
const { undo, redo } = cmCommands;
import { blockSelectionState, setBlockSelection, toggleBlockMode, BlockSelectionState } from "./state";
import { parseDocument, Block } from "./block-parser";
import { getBlockWithChildren } from "./block-utils";
import { blockSelectionGutter } from "./gutter";
import {
	moveBlocksUp, moveBlocksDown,
	indentBlocks, outdentBlocks,
	setHeadingLevel,
	toggleBulletList, toggleNumberedList, toggleCheckbox,
	toggleQuote, toggleCodeFormat,
	toggleInlineFormat,
	cutBlocks, copyBlocks, deleteBlocks, pasteBlocks,
	insertAbove, insertBelow,
} from "./operations";

// Anchor line for shift+click range selection.
let shiftAnchorLine: number | null = null;

const HANDLE_MOVE_THRESHOLD = 5; // px before a press is treated as drag
const WIDGET_GAP = 4;            // px from .cm-content's left edge to widget
const HIDE_AFTER_LEAVE_MS = 100;

export function hoverHandleExtension(indentUnit: string, onExtractText?: () => void, onDeleteBlocks?: (fn: () => void) => void) {
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
			private dragStart: {
				x: number; y: number; startLine: number;
				isModified: boolean; // ctrl/shift held at pointerdown
			} | null = null;
			private dragMoveHandler: (e: PointerEvent) => void;
			private dragEndHandler: (e: PointerEvent) => void;
			private contentPointerDownHandler: (e: PointerEvent) => void;
			// Intercept Ctrl/Cmd shortcuts (undo/redo/cut/copy/paste) while in
			// block mode since contentDOM is blurred and won't receive them.
			private keyDownHandler: (e: KeyboardEvent) => void;
			// Track the open context menu so a second click on the same handle
			// closes it and exits block mode.
			private openMenuRef: Menu | null = null;
			private menuBlockLine: number | null = null;

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
					const related = e.relatedTarget as Node | null;
					if (related && this.widget.contains(related)) return;
					if (this.hideTimer) clearTimeout(this.hideTimer);
					this.hideTimer = setTimeout(() => this.hide(), HIDE_AFTER_LEAVE_MS);
				};
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
					const lines = this.blockLineSetWithChildren(this.currentBlock);
					if (e.shiftKey) insertAbove(view, lines);
					else insertBelow(view, lines);
				});
				this.plusButton.addEventListener("pointerdown", (e) => {
					e.stopPropagation();
				});

				// ── Handle button ─────────────────────────────────────────
				// Selection happens immediately on pointerdown for instant feedback.
				// The distinction between click and drag is resolved on pointermove/up.
				this.handleButton.addEventListener("pointerdown", (e) => {
					if (e.button !== 0) return;
					if (!this.currentBlock) return;
					e.preventDefault();
					e.stopPropagation();

					const block = this.currentBlock;

					const state = view.state.field(blockSelectionState);
					const isCtrl = e.ctrlKey || e.metaKey;
					const isShift = e.shiftKey;
					const isModified = isCtrl || isShift;

					if (isCtrl) {
						// Ctrl/Cmd: symmetric-difference toggle
						this.applyCtrlClick(block, state);
					} else if (isShift) {
						// Shift: range select from anchor
						this.applyShiftClick(block, state);
					} else {
						// Plain press: if the block is already selected keep the
						// existing multi-selection; otherwise select only this block.
						const lines = this.blockLineSetWithChildren(block);
						const alreadySelected = Array.from(lines).some(l => state.selectedBlocks.has(l));
						if (!alreadySelected) {
							const effects: any[] = [setBlockSelection.of(lines)];
							if (!state.active) effects.push(toggleBlockMode.of(true));
							view.dispatch({ effects });
						} else if (!state.active) {
							view.dispatch({ effects: [toggleBlockMode.of(true)] });
						}
						shiftAnchorLine = block.startLine;
					}

					this.dragStart = {
						x: e.clientX, y: e.clientY,
						startLine: block.startLine,
						isModified,
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
				// On pointerup with no movement: open menu only on plain click.
				this.dragEndHandler = (e: PointerEvent) => {
					if (!this.dragStart) return;
					const { isModified, startLine } = this.dragStart;
					this.dragStart = null;
					if (isModified) return;
					// Plain click (no drag, no modifier). If the menu is already
					// open for this block, toggle it off and exit block mode.
					// Drags skip this branch so they always proceed to reorder.
					if (this.openMenuRef && this.menuBlockLine === startLine) {
						this.openMenuRef.hide();
						this.openMenuRef = null;
						this.menuBlockLine = null;
						view.dispatch({ effects: [toggleBlockMode.of(false)] });
						return;
					}
					this.openMenu(startLine);
				};
				document.addEventListener("pointermove", this.dragMoveHandler);
				document.addEventListener("pointerup", this.dragEndHandler);
				document.addEventListener("pointercancel", this.dragEndHandler);

				// ── Click anywhere in block content while in block mode ─────
				// Plain click exits block mode; ctrl/shift click adds/ranges.
				this.contentPointerDownHandler = (e: PointerEvent) => {
					if ((e.target as HTMLElement).closest(".block-editor-hover-handle")) return;
					const state = view.state.field(blockSelectionState);
					if (!state.active) return;

					const isCtrl = e.ctrlKey || e.metaKey;
					const isShift = e.shiftKey;

					if (isCtrl || isShift) {
						// Modified click: update selection without exiting block mode
						const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
						if (pos === null) return;
						const lineNum = view.state.doc.lineAt(pos).number;
						const block = this.findBlockContainingLine(lineNum);
						if (!block || block.type === "frontmatter" || block.type === "blank") return;
						e.preventDefault(); // don't place a text caret
						if (isCtrl) {
							this.applyCtrlClick(block, state);
						} else {
							this.applyShiftClick(block, state);
						}
						return;
					}

					// Plain click: exit block mode and let editor regain focus
					view.dispatch({ effects: [toggleBlockMode.of(false)] });
				};
				view.contentDOM.addEventListener("pointerdown", this.contentPointerDownHandler);

				// ── Keyboard shortcuts while in block mode ────────────────
				// Registered on window (capture) so it fires before most other
				// listeners. When the context menu is open we also attach this
				// handler to the menu's DOM in capture (see openMenu) because
				// Obsidian's menu uses keymap Scopes that bypass DOM events.
				this.keyDownHandler = (e: KeyboardEvent) => {
					const state = view.state.field(blockSelectionState);
					if (!state.active) return;
					const isMod = e.ctrlKey || e.metaKey;
					const key = e.key.toLowerCase();
					const sel = state.selectedBlocks;
					const act = (fn: () => void) => {
						e.preventDefault();
						e.stopPropagation();
						(e as any).stopImmediatePropagation?.();
						fn();
						if (this.openMenuRef) this.openMenuRef.hide();
					};
					if (isMod) {
						if (key === "z") act(() => { if (e.shiftKey) redo(view); else undo(view); });
						else if (key === "y") act(() => redo(view));
						else if (key === "c") act(() => copyBlocks(view, sel));
						else if (key === "x") act(() => cutBlocks(view, sel));
						else if (key === "v") act(() => pasteBlocks(view, sel));
					} else if (e.key === "Delete" || e.key === "Backspace") {
						act(() => deleteBlocks(view, sel));
					}
				};
				window.addEventListener("keydown", this.keyDownHandler, true);
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
				window.removeEventListener("keydown", this.keyDownHandler, true);
				if (this.hideTimer) clearTimeout(this.hideTimer);
			}

			// ── private helpers ────────────────────────────────────────────

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

			/** Lines for a block including child list items and continuation lines. */
			private blockLineSetWithChildren(block: Block): Set<number> {
				const [, childEnd] = getBlockWithChildren(
					this.view.state, block.startLine, 4, true
				);
				// Use the larger of the parser's endLine and the child-walk endLine so
				// that multi-line blocks (paragraphs with continuation lines, ^ref IDs)
				// are fully captured even when they have no indented children.
				const endLine = Math.max(block.endLine, childEnd);
				const lines = new Set<number>();
				for (let i = block.startLine; i <= endLine; i++) {
					if (this.view.state.doc.line(i).text.trim() !== "") {
						lines.add(i);
					}
				}
				if (lines.size === 0) lines.add(block.startLine);
				return lines;
			}

			private applyCtrlClick(block: Block, state: BlockSelectionState) {
				const lines = this.blockLineSetWithChildren(block);
				const sel = new Set(state.selectedBlocks);
				const anyMissing = Array.from(lines).some(l => !sel.has(l));
				if (anyMissing) { for (const l of lines) sel.add(l); }
				else { for (const l of lines) sel.delete(l); }
				const effects: any[] = [setBlockSelection.of(sel)];
				if (!state.active && sel.size > 0) effects.push(toggleBlockMode.of(true));
				this.view.dispatch({ effects });
				shiftAnchorLine = block.startLine;
			}

			private applyShiftClick(block: Block, state: BlockSelectionState) {
				if (shiftAnchorLine === null) {
					// No anchor yet — treat as a plain selection
					const lines = this.blockLineSetWithChildren(block);
					const effects: any[] = [setBlockSelection.of(lines)];
					if (!state.active) effects.push(toggleBlockMode.of(true));
					this.view.dispatch({ effects });
					shiftAnchorLine = block.startLine;
					return;
				}
				const blocks = this.getBlocks();
				const a = Math.min(shiftAnchorLine, block.startLine);
				const b = Math.max(shiftAnchorLine, block.startLine);
				const newSel = new Set<number>();
				for (const blk of blocks) {
					if (blk.startLine >= a && blk.startLine <= b &&
						blk.type !== "blank" && blk.type !== "frontmatter") {
						for (const l of this.blockLineSetWithChildren(blk)) newSel.add(l);
					}
				}
				const effects: any[] = [setBlockSelection.of(newSel)];
				if (!state.active && newSel.size > 0) effects.push(toggleBlockMode.of(true));
				this.view.dispatch({ effects });
			}

			private updateForMouse(mouseX: number, mouseY: number) {
				const sel = window.getSelection();
				if (sel && !sel.isCollapsed && sel.anchorNode &&
					this.view.contentDOM.contains(sel.anchorNode)) {
					this.hide();
					return;
				}
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

				// Resolve the line block by vertical position rather than
				// posAtCoords. In Live Preview, tables and math blocks render as
				// replaced widgets where posAtCoords returns null over the widget
				// body; lineBlockAtHeight still maps the height to the source line.
				const docHeight = mouseY - contentRect.top;
				const lineBlock = this.view.lineBlockAtHeight(docHeight);
				if (!lineBlock) { this.hide(); return; }

				const line = this.view.state.doc.lineAt(lineBlock.from);
				const block = this.findBlockContainingLine(line.number);
				// Hide the whole widget on blank lines and frontmatter — the
				// + button only appears alongside the drag handle.
				if (!block || block.type === "frontmatter" || block.type === "blank") { this.hide(); return; }

				this.currentBlock = block;

				const lb = this.view.lineBlockAt(
					this.view.state.doc.line(block.startLine).from
				);
				const y = contentRect.top + lb.top;
				const firstLineH = Math.min(lb.height, this.view.defaultLineHeight || 24);
				const widgetH = 24;
				const widgetTop = y + Math.max(0, (firstLineH - widgetH) / 2);

				this.widget.style.top = widgetTop + "px";
				this.widget.style.left = (contentRect.left + WIDGET_GAP) + "px";

				if (this.isHidden) this.show();
				if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
			}

			private beginDragReorder(startLine: number) {
				const view = this.view;
				const block = this.findBlockContainingLine(startLine);
				if (!block) return;

				// If the dragged block isn't in the current selection, replace selection.
				const lines = this.blockLineSetWithChildren(block);
				const state = view.state.field(blockSelectionState);
				const anySelected = Array.from(lines).some(l => state.selectedBlocks.has(l));
				const effects: any[] = [];
				if (!anySelected) effects.push(setBlockSelection.of(lines));
				if (!state.active) effects.push(toggleBlockMode.of(true));
				if (effects.length > 0) view.dispatch({ effects });

				this.hide();

				const gutter = view.plugin(blockSelectionGutter) as any;
				if (gutter && typeof gutter.startHandleReorder === "function") {
					gutter.startHandleReorder(block.startLine);
				}
			}

			private openMenu(blockLine: number) {
				const view = this.view;
				const sel = () => view.state.field(blockSelectionState).selectedBlocks;
				const menu = new Menu();
				this.openMenuRef = menu;
				this.menuBlockLine = blockLine;
				menu.onHide(() => {
					if (this.openMenuRef === menu) {
						this.openMenuRef = null;
						this.menuBlockLine = null;
					}
				});

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
						s.setTitle("Bullet list").setIcon("list")
							.onClick(() => toggleBulletList(view, sel()))
					);
					sub.addItem((s: any) =>
						s.setTitle("Numbered list").setIcon("list-ordered")
							.onClick(() => toggleNumberedList(view, sel()))
					);
					sub.addItem((s: any) =>
						s.setTitle("Checklist").setIcon("check-square")
							.onClick(() => toggleCheckbox(view, sel()))
					);
					sub.addItem((s: any) =>
						s.setTitle("Quote").setIcon("text-quote")
							.onClick(() => toggleQuote(view, sel()))
					);
					sub.addItem((s: any) =>
						s.setTitle("Code").setIcon("code")
							.onClick(() => toggleCodeFormat(view, sel()))
					);
				});

				menu.addItem(item => {
					item.setTitle("Format").setIcon("type");
					const sub = (item as any).setSubmenu();
					sub.addItem((s: any) =>
						s.setTitle("Bold").setIcon("bold")
							.onClick(() => toggleInlineFormat(view, sel(), "**"))
					);
					sub.addItem((s: any) =>
						s.setTitle("Italic").setIcon("italic")
							.onClick(() => toggleInlineFormat(view, sel(), "*"))
					);
					sub.addItem((s: any) =>
						s.setTitle("Strikethrough").setIcon("strikethrough")
							.onClick(() => toggleInlineFormat(view, sel(), "~~"))
					);
					sub.addItem((s: any) =>
						s.setTitle("Highlight").setIcon("highlighter")
							.onClick(() => toggleInlineFormat(view, sel(), "=="))
					);
					sub.addItem((s: any) =>
						s.setTitle("Inline code").setIcon("code")
							.onClick(() => toggleInlineFormat(view, sel(), "`"))
					);
				});

				menu.addSeparator();
				menu.addItem(i =>
					i.setTitle("Move up").setIcon("arrow-up")
						.onClick(() => moveBlocksUp(view, sel()))
				);
				menu.addItem(i =>
					i.setTitle("Move down").setIcon("arrow-down")
						.onClick(() => moveBlocksDown(view, sel()))
				);
				menu.addItem(i =>
					i.setTitle("Indent").setIcon("indent")
						.onClick(() => indentBlocks(view, sel(), indentUnit))
				);
				menu.addItem(i =>
					i.setTitle("Outdent").setIcon("outdent")
						.onClick(() => outdentBlocks(view, sel(), indentUnit))
				);
				menu.addSeparator();
				menu.addItem(i =>
					i.setTitle("Cut").setIcon("scissors").onClick(() => cutBlocks(view, sel()))
				);
				menu.addItem(i =>
					i.setTitle("Copy").setIcon("copy").onClick(() => copyBlocks(view, sel()))
				);
				if (onExtractText) {
					menu.addItem(i =>
						i.setTitle("Extract text…").setIcon("file-output").onClick(() => {
							const selected = sel();
							if (selected.size === 0) return;
							const sorted = Array.from(selected).sort((a, b) => a - b);
							const first = view.state.doc.line(sorted[0]);
							const last = view.state.doc.line(sorted[sorted.length - 1]);
							view.dispatch({
								selection: { anchor: first.from, head: last.to },
								effects: [toggleBlockMode.of(false)],
							});
							view.focus();
							setTimeout(() => onExtractText(), 0);
						})
					);
				}
				menu.addSeparator();
				menu.addItem(i =>
					i.setTitle("Delete").setIcon("trash-2")
						.onClick(() => {
							const capturedSel = new Set(sel());
							const exec = () => deleteBlocks(view, capturedSel);
							if (onDeleteBlocks) onDeleteBlocks(exec);
							else exec();
						})
				);

				// Position the menu relative to the handle button itself, not the
				// mouse, so it opens consistently in the left margin and never
				// covers blocks regardless of where the cursor ended up.
				const handleRect = this.handleButton.getBoundingClientRect();
				menu.showAtPosition({ x: handleRect.left, y: handleRect.bottom + 4 });
				requestAnimationFrame(() => {
					const menuEl = (menu as any).dom as HTMLElement | null;
					if (!menuEl) return;
					// Capture clipboard / undo / delete shortcuts directly on the
					// menu DOM so Obsidian's menu Scope can't swallow them.
					menuEl.addEventListener("keydown", this.keyDownHandler, true);
					const menuWidth = menuEl.offsetWidth;
					const menuHeight = menuEl.offsetHeight;
					// Right-align menu against the handle's left edge so it
					// extends leftward into the margin/pane.
					let left = handleRect.left - menuWidth - 4;
					if (left < 4) left = handleRect.right + 4; // fall back to right
					// Keep vertical position within viewport.
					let top = handleRect.bottom + 4;
					if (top + menuHeight > window.innerHeight - 4) {
						top = Math.max(4, handleRect.top - menuHeight - 4);
					}
					menuEl.style.left = left + "px";
					menuEl.style.top = top + "px";
				});
			}
		}
	);
}
