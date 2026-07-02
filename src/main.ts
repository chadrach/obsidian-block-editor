import { Plugin, Platform, MarkdownView } from "obsidian";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { blockSelectionState, toggleBlockMode, setBlockSelection } from "./state";
import { blockSelectionGutter, blockModeTransactionFilter, setExitCooldown, isDragSelecting } from "./gutter";
import { blockHighlighter } from "./highlighter";
import { BlockEditorToolbar } from "./toolbar";
import { hoverHandleExtension } from "./hover-handle";
import { injectStyles, removeStyles } from "./styles";
import { parseDocument } from "./block-parser";
import { getBlockWithChildren } from "./block-utils";

export default class BlockEditorPlugin extends Plugin {
	private toolbar: BlockEditorToolbar | null = null;
	private styleEl: HTMLStyleElement | null = null;

	async onload() {
		this.styleEl = injectStyles();

		// CSS-side switch for desktop-specific affordances (left-gutter padding etc.).
		if (!Platform.isMobile) {
			document.body.classList.add("block-editor-desktop");
		}

		// Determine indent settings
		const useTab = (this.app.vault as any).getConfig?.("useTab") ?? true;
		const tabSize = (this.app.vault as any).getConfig?.("tabSize") ?? 4;
		const indentUnit = useTab ? "\t" : " ".repeat(tabSize);

		const extractText = () => {
			(this.app as any).commands.executeCommandById("note-composer:extract-current-selection");
		};

		// Mobile: bottom-drawer toolbar. Desktop: replaced by the hover-handle
		// context menu, so the toolbar is not constructed at all.
		if (Platform.isMobile) {
			this.toolbar = new BlockEditorToolbar(indentUnit, extractText);
			document.body.appendChild(this.toolbar.el);
		}

		const toolbar = this.toolbar;

		const connectorPlugin = ViewPlugin.fromClass(
			class {
				constructor(readonly view: EditorView) {
					if (toolbar) toolbar.setView(view);
					this.syncState();
				}

				update(update: ViewUpdate) {
					if (toolbar) toolbar.setView(this.view);
					this.syncState();
				}

				syncState() {
					const state = this.view.state.field(blockSelectionState);
					const hasSelection = state.selectedBlocks.size > 0;
					if (toolbar) toolbar.updateVisibility(state.active, hasSelection);

					// Toggle body class to hide Obsidian's native bottom toolbar
					if (state.active) {
						document.body.classList.add("block-editor-active");
					} else {
						document.body.classList.remove("block-editor-active");
					}

					// Auto-exit block mode when all blocks are deselected (but not during drag,
					// and not if no block was ever selected — allows entering with empty selection)
					if (state.active && !hasSelection && state.hadSelection && !isDragSelecting()) {
						setTimeout(() => {
							const current = this.view.state.field(blockSelectionState);
							if (current.active && current.selectedBlocks.size === 0 && !isDragSelecting()) {
								// Set cooldown to suppress focus for 300ms after exit
								setExitCooldown(this.view, Date.now() + 300);
								this.view.dispatch({
									effects: [toggleBlockMode.of(false)],
								});
							}
						}, 0);
					}
				}

				destroy() {
					if (toolbar) toolbar.hide();
					document.body.classList.remove("block-editor-active");
				}
			}
		);

		// Track setBlockSelection in CM6 history so undo/redo restores the correct selection
		const cmCommands = require("@codemirror/commands");
		const blockSelectionHistoryExt = cmCommands.invertedEffects.of((tr: any) => {
			const inverse: any[] = [];
			for (const effect of tr.effects) {
				if (effect.is(setBlockSelection)) {
					const prev = tr.startState.field(blockSelectionState).selectedBlocks;
					inverse.push(setBlockSelection.of(new Set(prev)));
				}
			}
			return inverse;
		});

		// Register all CM6 extensions
		const extensions: any[] = [
			blockSelectionState,
			blockModeTransactionFilter,
			blockSelectionGutter,
			blockHighlighter,
			connectorPlugin,
			blockSelectionHistoryExt,
		];
		if (!Platform.isMobile) {
			extensions.push(hoverHandleExtension(indentUnit, extractText));
		}
		this.registerEditorExtension(extensions);

		// Helper to toggle block mode.
		// - If editor has focus with a cursor/selection, pre-select those blocks.
		// - If editor doesn't have focus, enter with empty selection.
		// - Multi-line text selections select all spanned blocks.
		const toggleBlock = (editor: any) => {
			const cmEditor = (editor as any).cm as EditorView | undefined;
			if (!cmEditor) return;

			const state = cmEditor.state.field(blockSelectionState);
			const newActive = !state.active;

			if (newActive) {
				const selected = new Set<number>();

				if (cmEditor.hasFocus) {
					const sel = cmEditor.state.selection.main;
					const fromLine = cmEditor.state.doc.lineAt(sel.from).number;
					const toLine = cmEditor.state.doc.lineAt(sel.to).number;

					// Use parser so continuation lines expand to their full block
					const blocks = parseDocument(cmEditor.state.doc);
					const visitedStarts = new Set<number>();
					for (let ln = fromLine; ln <= toLine; ln++) {
						const block = blocks.find(b => ln >= b.startLine && ln <= b.endLine);
						if (!block || block.type === "blank" || block.type === "frontmatter") continue;
						if (visitedStarts.has(block.startLine)) continue;
						visitedStarts.add(block.startLine);
						let blockEnd = block.endLine;
						if (block.type === "list-item") {
							const [, childEnd] = getBlockWithChildren(cmEditor.state, block.startLine, 4, true);
							blockEnd = Math.max(blockEnd, childEnd);
						}
						for (let i = block.startLine; i <= blockEnd; i++) {
							if (cmEditor.state.doc.line(i).text.trim() !== "") {
								selected.add(i);
							}
						}
					}
				}

				const effects = selected.size > 0
					? [toggleBlockMode.of(true), setBlockSelection.of(selected)]
					: [toggleBlockMode.of(true)];

				cmEditor.dispatch({ effects });
				cmEditor.contentDOM.blur();
			} else {
				cmEditor.dispatch({
					effects: [toggleBlockMode.of(false)],
				});
			}
			// Do NOT focus on exit — prevents keyboard from appearing
		};

		// Command palette command
		this.addCommand({
			id: "toggle-block-mode",
			name: "Toggle Block Mode",
			icon: "layout-grid",
			editorCallback: toggleBlock,
		});

		// Ribbon icon (desktop + mobile)
		this.addRibbonIcon("layout-grid", "Toggle Block Mode", () => {
			const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (markdownView) {
				toggleBlock(markdownView.editor);
			}
		});

		// Exit block mode on all markdown views when switching tabs.
		// Without this, circles stay visible on the previous tab and can
		// appear on the new tab in the wrong position.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.app.workspace.iterateAllLeaves(leaf => {
					const view = leaf.view;
					if (!(view instanceof MarkdownView)) return;
					const cmEditor = (view.editor as any)?.cm as EditorView | undefined;
					if (!cmEditor) return;
					try {
						const s = cmEditor.state.field(blockSelectionState);
						if (s.active) {
							cmEditor.dispatch({ effects: [toggleBlockMode.of(false)] });
						}
					} catch (_) { /* view may be torn down */ }
				});
			})
		);

		// Exit block mode when switching to reading mode
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!markdownView || markdownView.getMode() !== "preview") return;
				const cmEditor = (markdownView.editor as any)?.cm as EditorView | undefined;
				if (cmEditor) {
					try {
						const s = cmEditor.state.field(blockSelectionState);
						if (s.active) {
							cmEditor.dispatch({ effects: [toggleBlockMode.of(false)] });
						}
					} catch (_) { /* view may be torn down */ }
				}
				if (toolbar) toolbar.hide();
				document.body.classList.remove("block-editor-active");
			})
		);
	}

	onunload() {
		this.toolbar?.destroy();
		document.body.classList.remove("block-editor-active");
		document.body.classList.remove("block-editor-desktop");
		removeStyles();
	}
}
