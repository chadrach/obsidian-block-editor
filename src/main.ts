import { Plugin, Platform } from "obsidian";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { blockSelectionState, toggleBlockMode } from "./state";
import { blockSelectionGutter, blockModeFocusPrevention } from "./gutter";
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

		// Create a ViewPlugin that wires up the toolbar and FAB to each editor view
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
					// Re-bind view in case of multiple editors
					toolbar.setView(this.view);
					fab.setView(this.view);
					this.syncState();
				}

				syncState() {
					const state = this.view.state.field(blockSelectionState);
					toolbar.updateVisibility(state.active, state.selectedBlocks.size > 0);
					fab.updateAppearance(state.active);
				}

				destroy() {
					toolbar.hide();
				}
			}
		);

		// Register all CM6 extensions
		this.registerEditorExtension([
			blockSelectionState,
			blockSelectionGutter,
			blockHighlighter,
			blockModeFocusPrevention,
			connectorPlugin,
		]);

		// Add command to toggle block mode
		this.addCommand({
			id: "toggle-block-mode",
			name: "Toggle Block Mode",
			editorCallback: (editor) => {
				// Access the CM6 view from the Obsidian editor
				const cmEditor = (editor as any).cm as EditorView | undefined;
				if (!cmEditor) return;

				const state = cmEditor.state.field(blockSelectionState);
				const newActive = !state.active;

				cmEditor.dispatch({
					effects: [toggleBlockMode.of(newActive)],
				});

				if (!newActive) {
					cmEditor.focus();
				} else {
					cmEditor.contentDOM.blur();
				}
			},
		});

		// Add mobile toolbar button if on mobile
		if (Platform.isMobile) {
			this.addCommand({
				id: "toggle-block-mode-mobile",
				name: "Block Mode",
				icon: "layout-grid",
				editorCallback: (editor) => {
					const cmEditor = (editor as any).cm as EditorView | undefined;
					if (!cmEditor) return;

					const state = cmEditor.state.field(blockSelectionState);
					const newActive = !state.active;

					cmEditor.dispatch({
						effects: [toggleBlockMode.of(newActive)],
					});

					if (!newActive) {
						cmEditor.focus();
					} else {
						cmEditor.contentDOM.blur();
					}
				},
			});
		}
	}

	onunload() {
		this.toolbar?.destroy();
		this.fab?.destroy();
		removeStyles();
	}
}
