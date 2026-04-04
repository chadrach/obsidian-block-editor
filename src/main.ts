import { Plugin, Platform, MarkdownView } from "obsidian";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { blockSelectionState, toggleBlockMode } from "./state";
import { blockSelectionGutter, blockModeTransactionFilter } from "./gutter";
import { blockHighlighter } from "./highlighter";
import { BlockEditorToolbar } from "./toolbar";
import { BlockEditorFAB } from "./fab";
import { injectStyles, removeStyles } from "./styles";

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

		// Helper to toggle block mode without focusing editor on exit
		const toggleBlock = (editor: any) => {
			const cmEditor = (editor as any).cm as EditorView | undefined;
			if (!cmEditor) return;

			const state = cmEditor.state.field(blockSelectionState);
			const newActive = !state.active;

			cmEditor.dispatch({
				effects: [toggleBlockMode.of(newActive)],
			});

			if (newActive) {
				cmEditor.contentDOM.blur();
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
