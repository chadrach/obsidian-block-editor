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
 */
export function moveBlocksUp(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;

	const expanded = expandWithChildren(view, selectedLines);
	const firstLine = expanded[0];
	const lastLine = expanded[expanded.length - 1];

	// Can't move up if already at top
	if (firstLine <= 1) return;

	const doc = view.state.doc;
	const lineAbove = doc.line(firstLine - 1);
	const firstSelectedLine = doc.line(firstLine);
	const lastSelectedLine = doc.line(lastLine);

	const aboveText = lineAbove.text;

	const blockTexts: string[] = [];
	for (let i = firstLine; i <= lastLine; i++) {
		blockTexts.push(doc.line(i).text);
	}

	const newText = [...blockTexts, aboveText].join("\n");

	// Shift the original selected lines (not expanded children) up by 1
	const newSelection = new Set(Array.from(selectedLines).map(l => l - 1));

	view.dispatch({
		changes: { from: lineAbove.from, to: lastSelectedLine.to, insert: newText },
		effects: [setBlockSelection.of(newSelection)],
		annotations: [blockEditorTransaction.of(true)],
	});
}

/**
 * Move selected blocks (with children) down by one line.
 */
export function moveBlocksDown(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;

	const expanded = expandWithChildren(view, selectedLines);
	const firstLine = expanded[0];
	const lastLine = expanded[expanded.length - 1];

	// Can't move down if already at bottom
	if (lastLine >= view.state.doc.lines) return;

	const doc = view.state.doc;
	const lineBelow = doc.line(lastLine + 1);
	const firstSelectedLine = doc.line(firstLine);

	const belowText = lineBelow.text;
	const blockTexts: string[] = [];
	for (let i = firstLine; i <= lastLine; i++) {
		blockTexts.push(doc.line(i).text);
	}

	const newText = [belowText, ...blockTexts].join("\n");

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

	const changes: { from: number; to: number; insert: string }[] = [];
	const doc = view.state.doc;

	for (const lineNum of selectedLines) {
		const line = doc.line(lineNum);
		const content = stripHeading(line.text);
		const prefix = level > 0 ? "#".repeat(level) + " " : "";
		changes.push({ from: line.from, to: line.to, insert: prefix + content });
	}

	view.dispatch({
		changes,
		annotations: [blockEditorTransaction.of(true)],
	});
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
 * Progressive Select All — Outliner-style:
 * 1. If selected blocks have children, select children too
 * 2. If children already selected, select the entire parent list
 * 3. If parent list already selected, select all non-frontmatter blocks
 */
export function progressiveSelectAll(view: EditorView, selectedLines: Set<number>): void {
	const doc = view.state.doc;
	const frontmatterEnd = getFrontmatterEndForOps(view);
	const useTab = true;
	const tabSize = 4;

	// If nothing selected, select all non-empty, non-frontmatter lines
	if (selectedLines.size === 0) {
		const allLines = new Set<number>();
		for (let i = frontmatterEnd + 1; i <= doc.lines; i++) {
			if (doc.line(i).text.trim() !== "") allLines.add(i);
		}
		view.dispatch({ effects: [setBlockSelection.of(allLines)] });
		return;
	}

	const sorted = Array.from(selectedLines).sort((a, b) => a - b);

	// Phase 1: expand selected blocks to include their children
	const withChildren = new Set<number>();
	for (const lineNum of sorted) {
		const [start, end] = getBlockWithChildren(view.state, lineNum, tabSize, useTab);
		for (let i = start; i <= end; i++) {
			if (doc.line(i).text.trim() !== "") withChildren.add(i);
		}
	}

	if (withChildren.size > selectedLines.size) {
		view.dispatch({ effects: [setBlockSelection.of(withChildren)] });
		return;
	}

	// Phase 2: find the containing list and select all items in it.
	// Walk up from the first selected line to find the list root,
	// then walk down to find all items at the same or deeper indent.
	const firstSelected = sorted[0];
	const firstText = doc.line(firstSelected).text;
	const firstIndent = getIndentLevel(firstText, tabSize, useTab);

	// Walk up to find the start of the list (first line at indent 0, or
	// a line that isn't a list item)
	let listStart = firstSelected;
	for (let i = firstSelected - 1; i > frontmatterEnd; i--) {
		const text = doc.line(i).text;
		if (text.trim() === "") {
			// Check if this empty line is within the list
			if (i > frontmatterEnd + 1) {
				const above = doc.line(i - 1).text;
				if (isBulletItem(above) || isNumberedItem(above) || isCheckboxItem(above)) {
					listStart = i;
					continue;
				}
			}
			break;
		}
		if (isBulletItem(text) || isNumberedItem(text) || isCheckboxItem(text)) {
			listStart = i;
		} else {
			// Non-list content — this is the boundary
			listStart = i;
			break;
		}
	}

	// Walk down to find the end of the list
	let listEnd = sorted[sorted.length - 1];
	for (let i = listEnd + 1; i <= doc.lines; i++) {
		const text = doc.line(i).text;
		if (text.trim() === "") {
			// Look ahead
			let nextNonEmpty = i + 1;
			while (nextNonEmpty <= doc.lines && doc.line(nextNonEmpty).text.trim() === "") {
				nextNonEmpty++;
			}
			if (nextNonEmpty <= doc.lines) {
				const nextText = doc.line(nextNonEmpty).text;
				if (isBulletItem(nextText) || isNumberedItem(nextText) || isCheckboxItem(nextText)) {
					listEnd = i;
					continue;
				}
			}
			break;
		}
		if (isBulletItem(text) || isNumberedItem(text) || isCheckboxItem(text) ||
			getIndentLevel(text, tabSize, useTab) > 0) {
			listEnd = i;
		} else {
			break;
		}
	}

	const listSelection = new Set<number>();
	for (let i = listStart; i <= listEnd; i++) {
		if (doc.line(i).text.trim() !== "") listSelection.add(i);
	}

	if (listSelection.size > selectedLines.size) {
		view.dispatch({ effects: [setBlockSelection.of(listSelection)] });
		return;
	}

	// Phase 3: select all non-empty, non-frontmatter lines
	const allLines = new Set<number>();
	for (let i = frontmatterEnd + 1; i <= doc.lines; i++) {
		if (doc.line(i).text.trim() !== "") allLines.add(i);
	}
	view.dispatch({ effects: [setBlockSelection.of(allLines)] });
}
