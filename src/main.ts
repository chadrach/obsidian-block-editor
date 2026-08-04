import { Plugin, Platform, MarkdownView, PluginSettingTab, App, Setting, Modal } from "obsidian";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { blockSelectionState, toggleBlockMode, setBlockSelection } from "./state";
import { blockSelectionGutter, blockModeTransactionFilter, setExitCooldown, isDragSelecting, setLongPressDuration } from "./gutter";
import { blockHighlighter } from "./highlighter";
import { BlockEditorToolbar } from "./toolbar";
import { hoverHandleExtension } from "./hover-handle";
import { injectStyles, removeStyles } from "./styles";
import { parseDocument } from "./block-parser";
import { getBlockWithChildren } from "./block-utils";

interface BlockEditorSettings {
	mobileRightPadding: boolean;
	confirmBeforeDelete: boolean;
	longPressDuration: number;
	showRibbonIcon: boolean;
}

const DEFAULT_SETTINGS: BlockEditorSettings = {
	mobileRightPadding: true,
	confirmBeforeDelete: false,
	longPressDuration: 800,
	showRibbonIcon: true,
};

class DeleteConfirmModal extends Modal {
	private onConfirm: () => void;

	constructor(app: App, onConfirm: () => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen() {
		this.titleEl.setText("Delete blocks");
		this.contentEl.createEl("p", { text: "Delete the selected blocks?" });
		const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
		btns.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => this.close());
		const delBtn = btns.createEl("button", { text: "Delete", cls: "mod-warning" });
		delBtn.addEventListener("click", () => { this.close(); this.onConfirm(); });
	}

	onClose() {
		this.contentEl.empty();
	}
}

class BlockEditorSettingsTab extends PluginSettingTab {
	plugin: BlockEditorPlugin;

	constructor(app: App, plugin: BlockEditorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h3", { text: "Mobile" });

		new Setting(containerEl)
			.setName("Reserve right margin for circles")
			.setDesc("Adds 40px padding to the right side of the editor so selection circles don't overlap text.")
			.addToggle(t => t
				.setValue(this.plugin.settings.mobileRightPadding)
				.onChange(async (v) => {
					this.plugin.settings.mobileRightPadding = v;
					if (Platform.isMobile) document.body.classList.toggle("block-editor-mobile-padding", v);
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Long-press duration")
			.setDesc("How long to hold before entering block mode (milliseconds).")
			.addSlider(s => s
				.setLimits(300, 1500, 100)
				.setValue(this.plugin.settings.longPressDuration)
				.setDynamicTooltip()
				.onChange(async (v) => {
					this.plugin.settings.longPressDuration = v;
					setLongPressDuration(v);
					await this.plugin.saveSettings();
				})
			);

		containerEl.createEl("h3", { text: "General" });

		new Setting(containerEl)
			.setName("Confirm before deleting blocks")
			.setDesc("Show a confirmation dialog before deleting selected blocks.")
			.addToggle(t => t
				.setValue(this.plugin.settings.confirmBeforeDelete)
				.onChange(async (v) => {
					this.plugin.settings.confirmBeforeDelete = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Show ribbon icon")
			.setDesc("Show the \"Toggle Block Mode\" icon in the left ribbon.")
			.addToggle(t => t
				.setValue(this.plugin.settings.showRibbonIcon)
				.onChange(async (v) => {
					this.plugin.settings.showRibbonIcon = v;
					if (this.plugin.ribbonIconEl) {
						this.plugin.ribbonIconEl.style.display = v ? "" : "none";
					}
					await this.plugin.saveSettings();
				})
			);
	}
}

export default class BlockEditorPlugin extends Plugin {
	private toolbar: BlockEditorToolbar | null = null;
	private styleEl: HTMLStyleElement | null = null;
	settings: BlockEditorSettings = DEFAULT_SETTINGS;
	ribbonIconEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		this.styleEl = injectStyles();

		// CSS-side switch for desktop-specific affordances (left-gutter margin etc.).
		if (!Platform.isMobile) {
			document.body.classList.add("block-editor-desktop");
		} else {
			if (this.settings.mobileRightPadding) {
				document.body.classList.add("block-editor-mobile-padding");
			}
		}

		// Apply saved long-press duration.
		setLongPressDuration(this.settings.longPressDuration);

		// Determine indent settings
		const useTab = (this.app.vault as any).getConfig?.("useTab") ?? true;
		const tabSize = (this.app.vault as any).getConfig?.("tabSize") ?? 4;
		const indentUnit = useTab ? "\t" : " ".repeat(tabSize);

		const extractText = () => {
			(this.app as any).commands.executeCommandById("note-composer:split-file");
		};

		// Wraps a delete action with an optional confirmation modal.
		// Closes over this.settings so the flag is always read at call time.
		const onDeleteBlocks = (fn: () => void) => {
			if (this.settings.confirmBeforeDelete) {
				new DeleteConfirmModal(this.app, fn).open();
			} else {
				fn();
			}
		};

		// Mobile: bottom-drawer toolbar. Desktop: replaced by the hover-handle
		// context menu, so the toolbar is not constructed at all.
		if (Platform.isMobile) {
			this.toolbar = new BlockEditorToolbar(indentUnit, extractText, onDeleteBlocks);
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
			extensions.push(hoverHandleExtension(indentUnit, extractText, onDeleteBlocks));
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
		this.ribbonIconEl = this.addRibbonIcon("layout-grid", "Toggle Block Mode", () => {
			const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (markdownView) {
				toggleBlock(markdownView.editor);
			}
		});
		if (!this.settings.showRibbonIcon) {
			this.ribbonIconEl.style.display = "none";
		}

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

		this.addSettingTab(new BlockEditorSettingsTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	onunload() {
		this.toolbar?.destroy();
		document.body.classList.remove(
			"block-editor-active",
			"block-editor-desktop",
			"block-editor-mobile-padding",
		);
		removeStyles();
	}
}
