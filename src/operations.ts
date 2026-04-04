import { EditorView } from "@codemirror/view";
import { Annotation } from "@codemirror/state";
import { blockSelectionState, setBlockSelection } from "./state";
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
