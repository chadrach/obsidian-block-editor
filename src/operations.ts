import { EditorView } from "@codemirror/view";
import { Annotation } from "@codemirror/state";
import { blockSelectionState, setBlockSelection, toggleBlockSelection } from "./state";
import {
	getIndentLevel,
	getHeadingLevel,
	stripHeading,
	isBulletItem,
	isNumberedItem,
	isCheckboxItem,
	getLeadingWhitespace,
	getBlockWithChildren,
} from "./block-utils";

/**
 * Annotation marking a transaction as initiated by the block editor toolbar.
 * The transaction filter checks for this to allow doc changes in block mode.
 */
export const blockEditorTransaction = Annotation.define<boolean>();

/**
 * Expand selected lines to include their nested children.
 * Returns a sorted array of all line numbers in the expanded selection.
 */
function expandWithChildren(view: EditorView, selectedLines: Set<number>): number[] {
	const doc = view.state.doc;
	const allLines = new Set<number>();
	const useTab = true;
	const tabSize = 4;

	const sorted = Array.from(selectedLines).sort((a, b) => a - b);

	for (const lineNum of sorted) {
		if (allLines.has(lineNum)) continue; // already covered by a parent
		const [start, end] = getBlockWithChildren(view.state, lineNum, tabSize, useTab);
		for (let i = start; i <= end; i++) {
			allLines.add(i);
		}
	}

	return Array.from(allLines).sort((a, b) => a - b);
}

/**
 * Move selected blocks (with children) up by one line.
 * - Line above deeper indented: indent selected to match (no swap)
 * - Line above same indent: swap lines
 * - Line above shallower: swap + outdent selected to match
 */
export function moveBlocksUp(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;

	const expanded = expandWithChildren(view, selectedLines);
	const firstLine = expanded[0];
	const lastLine = expanded[expanded.length - 1];

	if (firstLine <= 1) return;

	const doc = view.state.doc;
	const lineAbove = doc.line(firstLine - 1);
	const firstSelectedLine = doc.line(firstLine);
	const lastSelectedLine = doc.line(lastLine);

	const useTab = true;
	const tabSize = 4;
	const indentStr = useTab ? "\t" : " ".repeat(tabSize);

	const targetIndent = getIndentLevel(lineAbove.text, tabSize, useTab);
	const currentIndent = getIndentLevel(firstSelectedLine.text, tabSize, useTab);

	if (targetIndent > currentIndent) {
		// Line above is deeper — just indent selected to match (no swap)
		const indentDelta = targetIndent - currentIndent;
		const blockTexts: string[] = [];
		for (let i = firstLine; i <= lastLine; i++) {
			blockTexts.push(indentStr.repeat(indentDelta) + doc.line(i).text);
		}
		const newText = blockTexts.join("\n");
		view.dispatch({
			changes: { from: firstSelectedLine.from, to: lastSelectedLine.to, insert: newText },
			annotations: [blockEditorTransaction.of(true)],
		});
		return;
	}

	// Same or shallower indent — swap lines, adjusting indent to match
	const indentDelta = targetIndent - currentIndent;
	const blockTexts: string[] = [];
	for (let i = firstLine; i <= lastLine; i++) {
		let text = doc.line(i).text;
		if (indentDelta < 0) {
			for (let d = 0; d < -indentDelta; d++) {
				if (text.startsWith("\t")) {
					text = text.slice(1);
				} else if (text.startsWith(" ".repeat(tabSize))) {
					text = text.slice(tabSize);
				}
			}
		}
		blockTexts.push(text);
	}

	const newText = [...blockTexts, lineAbove.text].join("\n");
	const newSelection = new Set(Array.from(selectedLines).map(l => l - 1));

	view.dispatch({
		changes: { from: lineAbove.from, to: lastSelectedLine.to, insert: newText },
		effects: [setBlockSelection.of(newSelection)],
		annotations: [blockEditorTransaction.of(true)],
	});
}

/**
 * Move selected blocks (with children) down by one line.
 * - Line below has children: swap + indent to become first child
 * - Line below same indent: swap lines
 * - Line below shallower: swap + outdent selected to match
 */
export function moveBlocksDown(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;

	const expanded = expandWithChildren(view, selectedLines);
	const firstLine = expanded[0];
	const lastLine = expanded[expanded.length - 1];

	if (lastLine >= view.state.doc.lines) return;

	const doc = view.state.doc;
	const lineBelow = doc.line(lastLine + 1);
	const firstSelectedLine = doc.line(firstLine);

	const useTab = true;
	const tabSize = 4;
	const indentStr = useTab ? "\t" : " ".repeat(tabSize);

	const belowIndent = getIndentLevel(lineBelow.text, tabSize, useTab);
	const currentIndent = getIndentLevel(firstSelectedLine.text, tabSize, useTab);

	// Check if line below has children (next line is more deeply indented)
	let belowHasChildren = false;
	if (lastLine + 2 <= doc.lines) {
		const lineBelowNext = doc.line(lastLine + 2);
		if (lineBelowNext.text.trim() !== "" &&
			getIndentLevel(lineBelowNext.text, tabSize, useTab) > belowIndent) {
			belowHasChildren = true;
		}
	}

	let targetIndent: number;
	if (belowHasChildren && currentIndent <= belowIndent) {
		// Line below has children — selected becomes first child
		targetIndent = belowIndent + 1;
	} else {
		targetIndent = belowIndent;
	}

	const indentDelta = targetIndent - currentIndent;

	const blockTexts: string[] = [];
	for (let i = firstLine; i <= lastLine; i++) {
		let text = doc.line(i).text;
		if (indentDelta > 0) {
			text = indentStr.repeat(indentDelta) + text;
		} else if (indentDelta < 0) {
			for (let d = 0; d < -indentDelta; d++) {
				if (text.startsWith("\t")) {
					text = text.slice(1);
				} else if (text.startsWith(" ".repeat(tabSize))) {
					text = text.slice(tabSize);
				}
			}
		}
		blockTexts.push(text);
	}

	const newText = [lineBelow.text, ...blockTexts].join("\n");
	const newSelection = new Set(Array.from(selectedLines).map(l => l + 1));

	view.dispatch({
		changes: { from: firstSelectedLine.from, to: lineBelow.to, insert: newText },
		effects: [setBlockSelection.of(newSelection)],
		annotations: [blockEditorTransaction.of(true)],
	});
}


/**
 * Indent selected blocks (with children) by one level.
 */
export function indentBlocks(view: EditorView, selectedLines: Set<number>, indentUnit: string): void {
	if (selectedLines.size === 0) return;

	const expanded = expandWithChildren(view, selectedLines);
	const changes: { from: number; to: number; insert: string }[] = [];
	const doc = view.state.doc;

	for (const lineNum of expanded) {
		const line = doc.line(lineNum);
		changes.push({ from: line.from, to: line.from, insert: indentUnit });
	}

	view.dispatch({
		changes,
		annotations: [blockEditorTransaction.of(true)],
	});
}

/**
 * Outdent selected blocks (with children) by one level.
 */
export function outdentBlocks(view: EditorView, selectedLines: Set<number>, indentUnit: string): void {
	if (selectedLines.size === 0) return;

	const expanded = expandWithChildren(view, selectedLines);
	const changes: { from: number; to: number; insert: string }[] = [];
	const doc = view.state.doc;

	for (const lineNum of expanded) {
		const line = doc.line(lineNum);
		const text = line.text;
		if (text.startsWith("\t")) {
			changes.push({ from: line.from, to: line.from + 1, insert: "" });
		} else {
			let spacesToRemove = 0;
			for (let i = 0; i < Math.min(indentUnit.length, text.length); i++) {
				if (text[i] === " ") spacesToRemove++;
				else break;
			}
			if (spacesToRemove > 0) {
				changes.push({ from: line.from, to: line.from + spacesToRemove, insert: "" });
			}
		}
	}

	if (changes.length > 0) {
		view.dispatch({
			changes,
			annotations: [blockEditorTransaction.of(true)],
		});
	}
}

/**
 * Set heading level for selected blocks. level=0 removes heading.
 */
export function setHeadingLevel(view: EditorView, selectedLines: Set<number>, level: number): void {
	if (selectedLines.size === 0) return;

	const doc = view.state.doc;
	const changes: { from: number; to: number; insert: string }[] = [];

	// Sort to process in document order
	const sorted = Array.from(selectedLines).sort((a, b) => a - b);

	for (const lineNum of sorted) {
		if (lineNum < 1 || lineNum > doc.lines) continue;
		const line = doc.line(lineNum);
		// Strip any existing heading prefix (greedy: handles extra spaces)
		const content = line.text.replace(/^#{1,6}\s+/, "");
		const prefix = level > 0 ? "#".repeat(level) + " " : "";
		const newText = prefix + content;
		// Only change if actually different
		if (newText !== line.text) {
			changes.push({ from: line.from, to: line.to, insert: newText });
		}
	}

	if (changes.length > 0) {
		view.dispatch({
			changes,
			annotations: [blockEditorTransaction.of(true)],
		});
	}
}

/**
 * Cycle heading level: none -> H1 -> H2 -> ... -> H6 -> none
 */
export function cycleHeading(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;

	const sorted = Array.from(selectedLines).sort((a, b) => a - b);
	const firstText = view.state.doc.line(sorted[0]).text;
	const currentLevel = getHeadingLevel(firstText);
	const nextLevel = currentLevel >= 6 ? 0 : currentLevel + 1;

	setHeadingLevel(view, selectedLines, nextLevel);
}

/**
 * Toggle bullet list prefix on selected blocks.
 */
export function toggleBulletList(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;

	const doc = view.state.doc;
	const changes: { from: number; to: number; insert: string }[] = [];

	const allBullets = Array.from(selectedLines).every(l => isBulletItem(doc.line(l).text));

	for (const lineNum of selectedLines) {
		const line = doc.line(lineNum);
		const text = line.text;
		const ws = getLeadingWhitespace(text);

		if (allBullets) {
			const newText = text.replace(/^(\s*)([-*+])\s/, "$1");
			changes.push({ from: line.from, to: line.to, insert: newText });
		} else {
			let content = text.replace(/^(\s*)([-*+]|\d+\.)\s(\[[ x]\]\s)?/, "$1");
			changes.push({ from: line.from, to: line.to, insert: ws + "- " + content.trimStart() });
		}
	}

	view.dispatch({
		changes,
		annotations: [blockEditorTransaction.of(true)],
	});
}

/**
 * Toggle numbered list prefix on selected blocks.
 */
export function toggleNumberedList(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;

	const doc = view.state.doc;
	const changes: { from: number; to: number; insert: string }[] = [];

	const allNumbered = Array.from(selectedLines).every(l => isNumberedItem(doc.line(l).text));

	let counter = 1;
	const sorted = Array.from(selectedLines).sort((a, b) => a - b);

	for (const lineNum of sorted) {
		const line = doc.line(lineNum);
		const text = line.text;
		const ws = getLeadingWhitespace(text);

		if (allNumbered) {
			const newText = text.replace(/^(\s*)\d+\.\s/, "$1");
			changes.push({ from: line.from, to: line.to, insert: newText });
		} else {
			let content = text.replace(/^(\s*)([-*+]|\d+\.)\s(\[[ x]\]\s)?/, "$1");
			changes.push({ from: line.from, to: line.to, insert: ws + counter + ". " + content.trimStart() });
			counter++;
		}
	}

	view.dispatch({
		changes,
		annotations: [blockEditorTransaction.of(true)],
	});
}

/**
 * Toggle checkbox prefix on selected blocks.
 */
export function toggleCheckbox(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;

	const doc = view.state.doc;
	const changes: { from: number; to: number; insert: string }[] = [];

	const allCheckbox = Array.from(selectedLines).every(l => isCheckboxItem(doc.line(l).text));

	for (const lineNum of selectedLines) {
		const line = doc.line(lineNum);
		const text = line.text;
		const ws = getLeadingWhitespace(text);

		if (allCheckbox) {
			const newText = text.replace(/^(\s*)([-*+])\s\[[ x]\]\s/, "$1$2 ");
			changes.push({ from: line.from, to: line.to, insert: newText });
		} else {
			let content = text.replace(/^(\s*)([-*+]|\d+\.)\s(\[[ x]\]\s)?/, "$1");
			changes.push({ from: line.from, to: line.to, insert: ws + "- [ ] " + content.trimStart() });
		}
	}

	view.dispatch({
		changes,
		annotations: [blockEditorTransaction.of(true)],
	});
}

/**
 * Delete selected blocks (with children).
 */
export function deleteBlocks(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;

	const expanded = expandWithChildren(view, selectedLines);
	const doc = view.state.doc;

	const changes: { from: number; to: number; insert: string }[] = [];

	for (const lineNum of expanded) {
		const line = doc.line(lineNum);
		let from = line.from;
		let to = line.to;

		if (to < doc.length) {
			to += 1; // include \n
		} else if (from > 0) {
			from -= 1; // include \n before if it's the last line
		}

		changes.push({ from, to, insert: "" });
	}

	view.dispatch({
		changes,
		effects: [setBlockSelection.of(new Set())],
		annotations: [blockEditorTransaction.of(true)],
	});
}

/**
 * Undo the last change. Uses CM6's built-in undo.
 */
export function undoAction(view: EditorView): void {
	// Access undo from @codemirror/commands via Obsidian's runtime
	const commands = require("@codemirror/commands");
	commands.undo(view);
}

/**
 * Redo the last undone change. Uses CM6's built-in redo.
 */
export function redoAction(view: EditorView): void {
	const commands = require("@codemirror/commands");
	commands.redo(view);
}

/**
 * Copy selected blocks' text to clipboard.
 */
export function copyBlocks(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;

	const expanded = expandWithChildren(view, selectedLines);
	const doc = view.state.doc;
	const lines = expanded.map(l => doc.line(l).text);
	const text = lines.join("\n");

	navigator.clipboard.writeText(text);
}

/**
 * Cut selected blocks' text to clipboard and delete them.
 */
export function cutBlocks(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;
	copyBlocks(view, selectedLines);
	deleteBlocks(view, selectedLines);
}

/**
 * Toggle blockquote (> ) prefix on selected blocks.
 */
export function toggleQuote(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;

	const doc = view.state.doc;
	const changes: { from: number; to: number; insert: string }[] = [];

	const allQuoted = Array.from(selectedLines).every(l =>
		doc.line(l).text.startsWith("> ")
	);

	for (const lineNum of selectedLines) {
		const line = doc.line(lineNum);
		const text = line.text;

		if (allQuoted) {
			changes.push({ from: line.from, to: line.to, insert: text.replace(/^> /, "") });
		} else {
			changes.push({ from: line.from, to: line.to, insert: "> " + text });
		}
	}

	view.dispatch({
		changes,
		annotations: [blockEditorTransaction.of(true)],
	});
}

/**
 * Get the frontmatter end line (0 if none).
 */
function getFrontmatterEndForOps(view: EditorView): number {
	const doc = view.state.doc;
	if (doc.lines < 1) return 0;
	if (doc.line(1).text.trim() !== "---") return 0;
	for (let i = 2; i <= doc.lines; i++) {
		if (doc.line(i).text.trim() === "---") return i;
	}
	return 0;
}

/**
 * Progressive Select All — level-by-level expansion:
 *
 * Starting from a block + its children:
 * 1. All siblings at min indent selected? → go up: select parent + all children
 * 2. Not all siblings selected? → expand to all siblings at that level + children
 * 3. Repeat until entire list region is selected
 * 4. Final press: select all blocks in document
 */
export function progressiveSelectAll(view: EditorView, selectedLines: Set<number>): void {
	const doc = view.state.doc;
	const frontmatterEnd = getFrontmatterEndForOps(view);
	const useTab = true;
	const tabSize = 4;

	// Nothing selected → select all
	if (selectedLines.size === 0) {
		const allLines = new Set<number>();
		for (let i = frontmatterEnd + 1; i <= doc.lines; i++) {
			if (doc.line(i).text.trim() !== "") allLines.add(i);
		}
		view.dispatch({ effects: [setBlockSelection.of(allLines)] });
		return;
	}

	const sorted = Array.from(selectedLines).sort((a, b) => a - b);

	// Find minimum indent level among selected lines
	let minIndent = Infinity;
	for (const ln of sorted) {
		const indent = getIndentLevel(doc.line(ln).text, tabSize, useTab);
		if (indent < minIndent) minIndent = indent;
	}

	if (minIndent > 0) {
		// Find the parent: nearest non-empty line above selection with indent < minIndent
		let parentLine = -1;
		for (let i = sorted[0] - 1; i > frontmatterEnd; i--) {
			const text = doc.line(i).text;
			if (text.trim() === "") continue;
			const indent = getIndentLevel(text, tabSize, useTab);
			if (indent < minIndent) {
				parentLine = i;
				break;
			}
		}

		if (parentLine !== -1) {
			const [scopeStart, scopeEnd] = getBlockWithChildren(view.state, parentLine, tabSize, useTab);

			// Check if all lines at minIndent within this scope are already selected
			let allSiblingsSelected = true;
			for (let i = scopeStart; i <= scopeEnd; i++) {
				const text = doc.line(i).text;
				if (text.trim() === "") continue;
				const indent = getIndentLevel(text, tabSize, useTab);
				if (indent === minIndent && !selectedLines.has(i)) {
					allSiblingsSelected = false;
					break;
				}
			}

			if (!allSiblingsSelected) {
				// Expand to all siblings at minIndent + their children (within parent scope)
				const newSelection = new Set<number>();
				for (let i = scopeStart; i <= scopeEnd; i++) {
					const text = doc.line(i).text;
					if (text.trim() === "") continue;
					if (getIndentLevel(text, tabSize, useTab) >= minIndent) {
						newSelection.add(i);
					}
				}
				view.dispatch({ effects: [setBlockSelection.of(newSelection)] });
				return;
			} else {
				// All siblings selected → go up: select parent + all its children
				const newSelection = new Set<number>();
				for (let i = scopeStart; i <= scopeEnd; i++) {
					if (doc.line(i).text.trim() !== "") newSelection.add(i);
				}
				view.dispatch({ effects: [setBlockSelection.of(newSelection)] });
				return;
			}
		}
		// No parent found for indented content — fall through to indent-0 logic
	}

	// minIndent === 0 (or fell through): expand to full contiguous list region,
	// then to everything. A "list region" is bounded by empty lines that aren't
	// followed by more list/indented content, or by non-list content (headings,
	// plain paragraphs).

	const isListContent = (text: string): boolean => {
		return isBulletItem(text) || isNumberedItem(text) || isCheckboxItem(text) ||
			getIndentLevel(text, tabSize, useTab) > 0;
	};

	// Walk up to find region start
	let regionStart = sorted[0];
	for (let i = sorted[0] - 1; i > frontmatterEnd; i--) {
		const text = doc.line(i).text;
		if (text.trim() === "") break; // Empty line = list boundary
		if (!isListContent(text) && !selectedLines.has(i)) break;
		regionStart = i;
	}

	// Walk down to find region end (include children of last selected)
	const [, lastChildEnd] = getBlockWithChildren(view.state, sorted[sorted.length - 1], tabSize, useTab);
	let regionEnd = Math.max(sorted[sorted.length - 1], lastChildEnd);
	for (let i = regionEnd + 1; i <= doc.lines; i++) {
		const text = doc.line(i).text;
		if (text.trim() === "") break; // Empty line = list boundary
		if (!isListContent(text)) break;
		regionEnd = i;
	}

	const regionSelection = new Set<number>();
	for (let i = regionStart; i <= regionEnd; i++) {
		if (doc.line(i).text.trim() !== "") regionSelection.add(i);
	}

	if (regionSelection.size > selectedLines.size) {
		view.dispatch({ effects: [setBlockSelection.of(regionSelection)] });
		return;
	}

	// Full region already selected → select all blocks in document
	const allLines = new Set<number>();
	for (let i = frontmatterEnd + 1; i <= doc.lines; i++) {
		if (doc.line(i).text.trim() !== "") allLines.add(i);
	}
	view.dispatch({ effects: [setBlockSelection.of(allLines)] });
}
