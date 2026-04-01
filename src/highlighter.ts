import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { blockSelectionState } from "./state";

/**
 * ViewPlugin that applies line decorations to selected blocks.
 */
export const blockHighlighter = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(readonly view: EditorView) {
			this.decorations = this.buildDecorations();
		}

		update(update: ViewUpdate) {
			const state = update.state.field(blockSelectionState);
			const prevState = update.startState.field(blockSelectionState);

			if (
				state.active !== prevState.active ||
				state.selectedBlocks !== prevState.selectedBlocks ||
				update.docChanged ||
				update.viewportChanged
			) {
				this.decorations = this.buildDecorations();
			}
		}

		buildDecorations(): DecorationSet {
			const state = this.view.state.field(blockSelectionState);

			if (!state.active || state.selectedBlocks.size === 0) {
				return Decoration.none;
			}

			const builder = new RangeSetBuilder<Decoration>();
			const lineDeco = Decoration.line({ class: "block-editor-selected-line" });

			// Must add decorations in document order
			const sorted = Array.from(state.selectedBlocks).sort((a, b) => a - b);
			const doc = this.view.state.doc;

			for (const lineNum of sorted) {
				if (lineNum >= 1 && lineNum <= doc.lines) {
					const line = doc.line(lineNum);
					builder.add(line.from, line.from, lineDeco);
				}
			}

			return builder.finish();
		}
	},
	{
		decorations: (v) => v.decorations,
	}
);
