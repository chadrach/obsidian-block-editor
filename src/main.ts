import { Plugin, Platform, MarkdownView } from "obsidian";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { blockSelectionState, toggleBlockMode, setBlockSelection } from "./state";
import { blockSelectionGutter, blockModeTransactionFilter } from "./gutter";
import { blockHighlighter } from "./highlighter";
import { BlockEditorToolbar } from "./toolbar";
import { BlockEditorFAB } from "./fab";
import { injectStyles, removeStyles } from "./styles";
import { getBlockWithChildren } from "./block-utils";

export default class BlockEditorPlugin extends Plugin {
	private toolbar: BlockEditorToolbar | null = null;
	private fab: BlockEditorFAB | null = null;
	private styleEl: HTMLStyleElement | null = null;

	async onload() {
		this.styleEl = injectStyles();

		// Determine indent settings
		const useTab = (this.app.vault as any).getConfig?.("useTab") ?? true;
		const tabSize = (this.app.vault as any).getConfig?.("tabSize") ?? 4;
		const indentUnit = useTab ? "\t" : " ".repeat(tabSize);

		// Create toolbar and FAB
		this.toolbar = new BlockEditorToolbar(indentUnit);
		this.fab = new BlockEditorFAB();

		document.body.appendChild(this.toolbar.el);
		document.body.appendChild(this.fab.el);

		const toolbar = this.toolbar;
		const fab = this.fab;

		const connectorPlugin = ViewPlugin.fromClass(
			class {
				constructor(readonly view: EditorView) {
					toolbar.setView(view);
					fab.setView(view);
					this.syncState();
				}

				update(update: ViewUpdate) {
					toolbar.setView(this.view);
					fab.setView(this.view);
					this.syncState();
				}

				syncState() {
					const state = this.view.state.field(blockSelectionState);
					const hasSelection = state.selectedBlocks.size > 0;
					toolbar.updateVisibility(state.active, hasSelection);
					fab.updateAppearance(state.active);
					// Raise FAB above toolbar when toolbar is visible
					if (state.active && hasSelection) {
						fab.el.classList.add("toolbar-visible");
					} else {
						fab.el.classList.remove("toolbar-visible");
					}
				}

				destroy() {
					toolbar.hide();
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
		// - Multi-line text selections select all spanned blocks + children.
		const toggleBlock = (editor: any) => {
			const cmEditor = (editor as any).cm as EditorView | undefined;
			if (!cmEditor) return;

			const state = cmEditor.state.field(blockSelectionState);
			const newActive = !state.active;

			if (newActive) {
				const selected = new Set<number>();
				const hasFocus = cmEditor.hasFocus;

				if (hasFocus) {
					const sel = cmEditor.state.selection.main;
					const fromLine = cmEditor.state.doc.lineAt(sel.from).number;
					const toLine = cmEditor.state.doc.lineAt(sel.to).number;

					// Collect all lines in the selection range, expanding each with children
					const visited = new Set<number>();
					for (let ln = fromLine; ln <= toLine; ln++) {
						if (visited.has(ln)) continue;
						const [start, end] = getBlockWithChildren(cmEditor.state, ln, 4, true);
						for (let i = start; i <= end; i++) {
							visited.add(i);
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
		this.fab?.destroy();
		removeStyles();
	}
}
