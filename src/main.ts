import { Plugin, Platform, MarkdownView } from "obsidian";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { blockSelectionState, toggleBlockMode, setBlockSelection } from "./state";
import { blockSelectionGutter, blockModeTransactionFilter, setExitCooldown, isDragSelecting } from "./gutter";
import { blockHighlighter } from "./highlighter";
import { BlockEditorToolbar } from "./toolbar";
import { injectStyles, removeStyles } from "./styles";
import { parseDocument } from "./block-parser";

export default class BlockEditorPlugin extends Plugin {
	private toolbar: BlockEditorToolbar | null = null;
	private styleEl: HTMLStyleElement | null = null;

	async onload() {
		this.styleEl = injectStyles();

		// Determine indent settings
		const useTab = (this.app.vault as any).getConfig?.("useTab") ?? true;
		const tabSize = (this.app.vault as any).getConfig?.("tabSize") ?? 4;
		const indentUnit = useTab ? "\t" : " ".repeat(tabSize);

		// Create toolbar
		this.toolbar = new BlockEditorToolbar(indentUnit);
		document.body.appendChild(this.toolbar.el);

		const toolbar = this.toolbar;

		const connectorPlugin = ViewPlugin.fromClass(
			class {
				constructor(readonly view: EditorView) {
					toolbar.setView(view);
					this.syncState();
				}

				update(update: ViewUpdate) {
					toolbar.setView(this.view);
					this.syncState();
				}

				syncState() {
					const state = this.view.state.field(blockSelectionState);
					const hasSelection = state.selectedBlocks.size > 0;
					toolbar.updateVisibility(state.active, hasSelection);

					// Toggle body class to hide Obsidian's native bottom toolbar
					if (state.active) {
						document.body.classList.add("block-editor-active");
					} else {
						document.body.classList.remove("block-editor-active");
					}

					// Auto-exit block mode when all blocks are deselected (but not during drag)
					if (state.active && !hasSelection && !isDragSelecting()) {
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
					toolbar.hide();
					document.body.classList.remove("block-editor-active");
				}
			}
		);

		// Register all CM6 extensions
		this.registerEditorExtension([
			blockSelectionState,
			blockModeTransactionFilter,
			blockSelectionGutter,
			blockHighlighter,
			connectorPlugin,
		]);

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
						for (let i = block.startLine; i <= block.endLine; i++) {
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
	}

	onunload() {
		this.toolbar?.destroy();
		document.body.classList.remove("block-editor-active");
		removeStyles();
	}
}
