import { EditorView } from "@codemirror/view";
import { setIcon } from "obsidian";
import { blockSelectionState, toggleBlockMode, setBlockSelection } from "./state";
import {
	moveBlocksUp,
	moveBlocksDown,
	indentBlocks,
	outdentBlocks,
	setHeadingLevel,
	toggleBulletList,
	toggleNumberedList,
	toggleCheckbox,
	toggleQuote,
	toggleInlineFormat,
	toggleCodeFormat,
	deleteBlocks,
	undoAction,
	redoAction,
	copyBlocks,
	cutBlocks,
	progressiveSelectAll,
	insertAbove,
	insertBelow,
	editBlock,
} from "./operations";

export class BlockEditorToolbar {
	el: HTMLElement;
	private view: EditorView | null = null;
	private indentUnit: string;
	private primaryDrawer: HTMLElement;
	private formatDrawer: HTMLElement;
	private showingFormat: boolean = false;

	constructor(indentUnit: string) {
		this.indentUnit = indentUnit;
		this.el = document.createElement("div");
		this.el.className = "block-editor-toolbar";
		this.el.style.display = "none";

		this.primaryDrawer = this.buildPrimaryDrawer();
		this.formatDrawer = this.buildFormatDrawer();

		this.el.appendChild(this.primaryDrawer);
		this.el.appendChild(this.formatDrawer);
	}

	setView(view: EditorView) {
		this.view = view;
	}

	setIndentUnit(unit: string) {
		this.indentUnit = unit;
	}

	private buildPrimaryDrawer(): HTMLElement {
		const drawer = document.createElement("div");
		drawer.className = "block-editor-drawer block-editor-primary-drawer";
		drawer.style.display = "none";

		// Drag handle — swipe down exits block mode
		const handle = document.createElement("div");
		handle.className = "block-editor-drag-handle";
		handle.addEventListener("click", (e) => {
			e.preventDefault();
			this.exitBlockMode();
		});
		drawer.appendChild(handle);

		this.attachSwipeGesture(drawer, () => this.exitBlockMode());

		// ── Row 1: Aa | (Up|Down) | (InsertAbove|InsertBelow|Edit) ──────────
		const row1 = document.createElement("div");
		row1.className = "block-editor-drawer-row";

		row1.appendChild(this.makeButton("case-sensitive", "Format", () => this.openFormatDrawer()));

		const movePill = document.createElement("div");
		movePill.className = "block-editor-format-pill block-editor-format-pill-stretch";
		movePill.appendChild(this.makeButton("arrow-up", "Move Up", () => this.doAction(moveBlocksUp)));
		movePill.appendChild(this.makeButton("arrow-down", "Move Down", () => this.doAction(moveBlocksDown)));
		row1.appendChild(movePill);

		const insertPill = document.createElement("div");
		insertPill.className = "block-editor-format-pill block-editor-format-pill-stretch";
		insertPill.appendChild(this.makeButton("arrow-up-to-line", "Insert Above", () => this.doInsertAbove()));
		insertPill.appendChild(this.makeButton("arrow-down-to-line", "Insert Below", () => this.doInsertBelow()));
		insertPill.appendChild(this.makeButton("pencil", "Edit", () => this.doEditBlock()));
		row1.appendChild(insertPill);

		drawer.appendChild(row1);

		// ── Row 2: (Undo|Redo) | (SelectAll|Cut|Copy) | Delete ──────────────
		const row2 = document.createElement("div");
		row2.className = "block-editor-drawer-row";

		const undoPill = document.createElement("div");
		undoPill.className = "block-editor-format-pill block-editor-format-pill-stretch";
		undoPill.appendChild(this.makeButton("undo-2", "Undo", () => this.doUndo()));
		undoPill.appendChild(this.makeButton("redo-2", "Redo", () => this.doRedo()));
		row2.appendChild(undoPill);

		const clipPill = document.createElement("div");
		clipPill.className = "block-editor-format-pill block-editor-format-pill-stretch";
		clipPill.appendChild(this.makeButton("check-check", "Select All", () => this.doSelectAll()));
		clipPill.appendChild(this.makeButton("scissors", "Cut", () => this.doCut()));
		clipPill.appendChild(this.makeButton("copy", "Copy", () => this.doCopy()));
		row2.appendChild(clipPill);

		row2.appendChild(this.makeButton("trash-2", "Delete", () => this.doDelete(), "block-editor-btn-danger"));

		drawer.appendChild(row2);

		return drawer;
	}

	private buildFormatDrawer(): HTMLElement {
		const drawer = document.createElement("div");
		drawer.className = "block-editor-drawer block-editor-format-drawer";
		drawer.style.display = "none";

		// Drag handle — swipe down returns to primary drawer
		const handle = document.createElement("div");
		handle.className = "block-editor-drag-handle";
		handle.addEventListener("click", (e) => {
			e.preventDefault();
			this.closeFormatDrawer();
		});
		drawer.appendChild(handle);

		this.attachSwipeGesture(drawer, () => this.closeFormatDrawer());

		// "Format" label
		const label = document.createElement("div");
		label.className = "block-editor-format-label";
		label.textContent = "Format";
		drawer.appendChild(label);

		// ── Heading row ───────────────────────────────────────────────────────
		const headingRow = document.createElement("div");
		headingRow.className = "block-editor-format-headings";

		const headings = [
			{ label: "Title", level: 1 },
			{ label: "Subtitle", level: 2 },
			{ label: "Heading", level: 3 },
			{ label: "Strong", level: 4 },
			{ label: "Body", level: 0 },
		];

		for (const h of headings) {
			const btn = document.createElement("button");
			btn.className = `block-editor-heading-btn block-editor-heading-${h.level}`;
			btn.textContent = h.label;

			let downPos: { x: number; y: number } | null = null;
			btn.addEventListener("pointerdown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				downPos = { x: e.clientX, y: e.clientY };
			});
			btn.addEventListener("pointerup", (e) => {
				if (!downPos) return;
				const dx = e.clientX - downPos.x;
				const dy = e.clientY - downPos.y;
				downPos = null;
				if (Math.sqrt(dx * dx + dy * dy) > 10) return;
				e.preventDefault();
				e.stopPropagation();
				const selected = this.getSelectedLines();
				if (selected && this.view) {
					setHeadingLevel(this.view, selected, h.level);
				}
			});
			btn.addEventListener("pointercancel", () => { downPos = null; });
			headingRow.appendChild(btn);
		}

		drawer.appendChild(headingRow);

		// ── List/block row ────────────────────────────────────────────────────
		const listRow = document.createElement("div");
		listRow.className = "block-editor-format-row";

		const listPill = document.createElement("div");
		listPill.className = "block-editor-format-pill block-editor-format-pill-stretch";
		listPill.appendChild(this.makeButton("list", "Bullet List", () => this.doAction(toggleBulletList)));
		listPill.appendChild(this.makeButton("list-ordered", "Numbered List", () => this.doAction(toggleNumberedList)));
		listPill.appendChild(this.makeButton("check-square", "Checklist", () => this.doAction(toggleCheckbox)));
		listPill.appendChild(this.makeButton("text-quote", "Quote", () => this.doAction(toggleQuote)));
		listPill.appendChild(this.makeButton("code", "Code", () => this.doCodeFormat()));
		listRow.appendChild(listPill);
		drawer.appendChild(listRow);

		// ── Inline / indent row ───────────────────────────────────────────────
		const inlineRow = document.createElement("div");
		inlineRow.className = "block-editor-format-row";

		const inlinePill = document.createElement("div");
		inlinePill.className = "block-editor-format-pill block-editor-format-pill-left";
		inlinePill.appendChild(this.makeButton("bold", "Bold", () => this.doInlineFormat("**")));
		inlinePill.appendChild(this.makeButton("italic", "Italic", () => this.doInlineFormat("*")));
		inlinePill.appendChild(this.makeButton("strikethrough", "Strikethrough", () => this.doInlineFormat("~~")));
		inlinePill.appendChild(this.makeButton("highlighter", "Highlight", () => this.doInlineFormat("==")));
		inlineRow.appendChild(inlinePill);

		const indentPill = document.createElement("div");
		indentPill.className = "block-editor-format-pill block-editor-format-pill-right";
		indentPill.appendChild(this.makeButton("outdent", "Outdent", () => this.doOutdent()));
		indentPill.appendChild(this.makeButton("indent", "Indent", () => this.doIndent()));
		inlineRow.appendChild(indentPill);

		drawer.appendChild(inlineRow);

		return drawer;
	}

	/**
	 * Attach swipe-to-close gesture to a drawer.
	 * Tracks drag starting from the drag handle; if dy > 60px on release, calls onClose.
	 */
	private attachSwipeGesture(drawer: HTMLElement, onClose: () => void) {
		let startY = 0;
		let currentDy = 0;
		let swiping = false;

		const onDown = (e: PointerEvent) => {
			const target = e.target as HTMLElement;
			// Only initiate swipe from drag handle
			if (!target.closest(".block-editor-drag-handle")) return;
			swiping = true;
			startY = e.clientY;
			currentDy = 0;
			drawer.style.transition = "none";
			try { drawer.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
			e.preventDefault();
		};

		const onMove = (e: PointerEvent) => {
			if (!swiping) return;
			currentDy = Math.max(0, e.clientY - startY);
			drawer.style.transform = `translateY(${currentDy}px)`;
			e.preventDefault();
		};

		const onUp = (e: PointerEvent) => {
			if (!swiping) return;
			swiping = false;
			drawer.style.transition = "";
			if (currentDy > 60) {
				onClose();
			} else {
				// Spring back
				drawer.style.transform = "";
			}
			e.preventDefault();
		};

		drawer.addEventListener("pointerdown", onDown);
		drawer.addEventListener("pointermove", onMove);
		drawer.addEventListener("pointerup", onUp);
		drawer.addEventListener("pointercancel", onUp);
	}

	private makeButton(icon: string, title: string, action: () => void, className?: string): HTMLElement {
		const btn = document.createElement("button");
		btn.setAttribute("aria-label", title);
		btn.title = title;
		if (className) btn.classList.add(className);
		setIcon(btn, icon);

		let downPos: { x: number; y: number } | null = null;

		btn.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			downPos = { x: e.clientX, y: e.clientY };
		});

		btn.addEventListener("pointerup", (e) => {
			if (!downPos) return;
			const dx = e.clientX - downPos.x;
			const dy = e.clientY - downPos.y;
			downPos = null;
			if (Math.sqrt(dx * dx + dy * dy) > 10) return;
			e.preventDefault();
			e.stopPropagation();
			action();
		});

		btn.addEventListener("pointercancel", () => { downPos = null; });

		return btn;
	}

	// ── Drawer open/close ──────────────────────────────────────────────────

	private openFormatDrawer() {
		this.showingFormat = true;
		this.primaryDrawer.classList.remove("drawer-open");
		requestAnimationFrame(() => {
			this.primaryDrawer.style.display = "none";
			this.formatDrawer.style.display = "flex";
			requestAnimationFrame(() => this.formatDrawer.classList.add("drawer-open"));
		});
	}

	private closeFormatDrawer() {
		this.showingFormat = false;
		this.formatDrawer.classList.remove("drawer-open");
		this.formatDrawer.addEventListener("transitionend", () => {
			this.formatDrawer.style.display = "none";
			this.primaryDrawer.style.display = "flex";
			requestAnimationFrame(() => this.primaryDrawer.classList.add("drawer-open"));
		}, { once: true });
	}

	private exitBlockMode() {
		if (!this.view) return;
		// Start slide-down animation then dispatch exit
		this.primaryDrawer.classList.remove("drawer-open");
		this.formatDrawer.classList.remove("drawer-open");
		setTimeout(() => {
			if (this.view) {
				this.view.dispatch({ effects: [toggleBlockMode.of(false)] });
			}
		}, 0);
	}

	// ── Visibility ─────────────────────────────────────────────────────────

	show() {
		this.el.style.display = "flex";
		if (this.showingFormat) {
			this.primaryDrawer.style.display = "none";
			this.formatDrawer.style.display = "flex";
			requestAnimationFrame(() => this.formatDrawer.classList.add("drawer-open"));
		} else {
			this.primaryDrawer.style.display = "flex";
			this.formatDrawer.style.display = "none";
			requestAnimationFrame(() => this.primaryDrawer.classList.add("drawer-open"));
		}
	}

	hide() {
		this.primaryDrawer.classList.remove("drawer-open");
		this.formatDrawer.classList.remove("drawer-open");
		setTimeout(() => { this.el.style.display = "none"; }, 300);
		this.showingFormat = false;
	}

	destroy() {
		this.el.remove();
	}

	updateVisibility(active: boolean, hasSelection: boolean) {
		if (active && hasSelection) {
			this.show();
		} else {
			this.hide();
		}
	}

	// ── Action helpers ─────────────────────────────────────────────────────

	private getSelectedLines(): Set<number> | null {
		if (!this.view) return null;
		const state = this.view.state.field(blockSelectionState);
		if (!state.active || state.selectedBlocks.size === 0) return null;
		return state.selectedBlocks;
	}

	private doAction(fn: (view: EditorView, selected: Set<number>) => void) {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		fn(this.view, selected);
	}

	private doIndent() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		indentBlocks(this.view, selected, this.indentUnit);
	}

	private doOutdent() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		outdentBlocks(this.view, selected, this.indentUnit);
	}

	private doDelete() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		deleteBlocks(this.view, selected);
	}

	private doCopy() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		copyBlocks(this.view, selected);
	}

	private doCut() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		cutBlocks(this.view, selected);
	}

	private doSelectAll() {
		if (!this.view) return;
		const state = this.view.state.field(blockSelectionState);
		progressiveSelectAll(this.view, state.selectedBlocks);
	}

	private doInlineFormat(marker: string) {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		toggleInlineFormat(this.view, selected, marker);
	}

	private doCodeFormat() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		toggleCodeFormat(this.view, selected);
	}

	private doUndo() {
		if (!this.view) return;
		undoAction(this.view);
	}

	private doRedo() {
		if (!this.view) return;
		redoAction(this.view);
	}

	private doInsertAbove() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		insertAbove(this.view, selected);
	}

	private doInsertBelow() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		insertBelow(this.view, selected);
	}

	private doEditBlock() {
		const selected = this.getSelectedLines();
		if (!selected || !this.view) return;
		editBlock(this.view, selected);
	}
}
