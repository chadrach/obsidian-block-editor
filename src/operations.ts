import { EditorView } from "@codemirror/view";
import { TransactionSpec } from "@codemirror/state";
import { blockSelectionState, setBlockSelection } from "./state";
import {
	getLineText,
	getIndentLevel,
	getHeadingLevel,
	stripHeading,
	isBulletItem,
	isNumberedItem,
	isCheckboxItem,
	getLeadingWhitespace,
	getBlockWithChildren,
} from "./block-utils";

function getIndentConfig(view: EditorView): { useTab: boolean; tabSize: number; indentUnit: string } {
	const app = (view as any).state?.field?.(blockSelectionState) !== undefined
		? undefined : undefined;
	// Try to access Obsidian's vault config via the DOM
	const useTab = true;
	const tabSize = 4;
	const indentUnit = useTab ? "\t" : " ".repeat(tabSize);
	return { useTab, tabSize, indentUnit };
}

/**
 * Move selected blocks up by one line.
 */
export function moveBlocksUp(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;

	const sorted = Array.from(selectedLines).sort((a, b) => a - b);
	const firstLine = sorted[0];

	// Can't move up if already at top
	if (firstLine <= 1) return;

	const doc = view.state.doc;
	const lineAbove = doc.line(firstLine - 1);
	const lastSelected = sorted[sorted.length - 1];
	const firstSelectedLine = doc.line(firstLine);
	const lastSelectedLine = doc.line(lastSelected);

	// Get the text of the line above
	const aboveText = lineAbove.text;

	// Get all selected lines' text
	const selectedTexts: string[] = [];
	for (let i = firstLine; i <= lastSelected; i++) {
		selectedTexts.push(doc.line(i).text);
	}

	// Build replacement: selected lines, then the line that was above
	const newText = [...selectedTexts, aboveText].join("\n");

	const changes = {
		from: lineAbove.from,
		to: lastSelectedLine.to,
		insert: newText,
	};

	// Update selection: shift all selected lines up by 1
	const newSelection = new Set(sorted.map(l => l - 1));

	view.dispatch({
		changes,
		effects: [setBlockSelection.of(newSelection)],
	});
}

/**
 * Move selected blocks down by one line.
 */
export function moveBlocksDown(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;

	const sorted = Array.from(selectedLines).sort((a, b) => a - b);
	const lastLine = sorted[sorted.length - 1];

	// Can't move down if already at bottom
	if (lastLine >= view.state.doc.lines) return;

	const doc = view.state.doc;
	const lineBelow = doc.line(lastLine + 1);
	const firstLine = sorted[0];
	const firstSelectedLine = doc.line(firstLine);
	const lastSelectedLine = doc.line(lastLine);

	const belowText = lineBelow.text;
	const selectedTexts: string[] = [];
	for (let i = firstLine; i <= lastLine; i++) {
		selectedTexts.push(doc.line(i).text);
	}

	const newText = [belowText, ...selectedTexts].join("\n");

	const changes = {
		from: firstSelectedLine.from,
		to: lineBelow.to,
		insert: newText,
	};

	const newSelection = new Set(sorted.map(l => l + 1));

	view.dispatch({
		changes,
		effects: [setBlockSelection.of(newSelection)],
	});
}

/**
 * Indent selected blocks by one level.
 */
export function indentBlocks(view: EditorView, selectedLines: Set<number>, indentUnit: string): void {
	if (selectedLines.size === 0) return;

	const changes: { from: number; to: number; insert: string }[] = [];
	const doc = view.state.doc;

	for (const lineNum of selectedLines) {
		const line = doc.line(lineNum);
		changes.push({
			from: line.from,
			to: line.from,
			insert: indentUnit,
		});
	}

	view.dispatch({ changes });
}

/**
 * Outdent selected blocks by one level.
 */
export function outdentBlocks(view: EditorView, selectedLines: Set<number>, indentUnit: string): void {
	if (selectedLines.size === 0) return;

	const changes: { from: number; to: number; insert: string }[] = [];
	const doc = view.state.doc;

	for (const lineNum of selectedLines) {
		const line = doc.line(lineNum);
		const text = line.text;
		if (text.startsWith("\t")) {
			changes.push({ from: line.from, to: line.from + 1, insert: "" });
		} else {
			// Remove up to indentUnit.length spaces
			let spacesToRemove = 0;
			for (let i = 0; i < Math.min(indentUnit.length, text.length); i++) {
				if (text[i] === " ") {
					spacesToRemove++;
				} else {
					break;
				}
			}
			if (spacesToRemove > 0) {
				changes.push({ from: line.from, to: line.from + spacesToRemove, insert: "" });
			}
		}
	}

	if (changes.length > 0) {
		view.dispatch({ changes });
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
		const text = line.text;
		const content = stripHeading(text);
		const prefix = level > 0 ? "#".repeat(level) + " " : "";
		changes.push({ from: line.from, to: line.to, insert: prefix + content });
	}

	view.dispatch({ changes });
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

	// Check if all selected lines are already bullet items
	const allBullets = Array.from(selectedLines).every(l => isBulletItem(doc.line(l).text));

	for (const lineNum of selectedLines) {
		const line = doc.line(lineNum);
		const text = line.text;
		const ws = getLeadingWhitespace(text);

		if (allBullets) {
			// Remove bullet prefix
			const newText = text.replace(/^(\s*)([-*+])\s/, "$1");
			changes.push({ from: line.from, to: line.to, insert: newText });
		} else {
			// Strip any existing list marker first
			let content = text.replace(/^(\s*)([-*+]|\d+\.)\s(\[[ x]\]\s)?/, "$1");
			changes.push({ from: line.from, to: line.to, insert: ws + "- " + content.trimStart() });
		}
	}

	view.dispatch({ changes });
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

	view.dispatch({ changes });
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
			// Remove checkbox, keep as bullet
			const newText = text.replace(/^(\s*)([-*+])\s\[[ x]\]\s/, "$1$2 ");
			changes.push({ from: line.from, to: line.to, insert: newText });
		} else {
			// Strip any existing list marker
			let content = text.replace(/^(\s*)([-*+]|\d+\.)\s(\[[ x]\]\s)?/, "$1");
			changes.push({ from: line.from, to: line.to, insert: ws + "- [ ] " + content.trimStart() });
		}
	}

	view.dispatch({ changes });
}

/**
 * Delete selected blocks.
 */
export function deleteBlocks(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;

	const doc = view.state.doc;
	const sorted = Array.from(selectedLines).sort((a, b) => a - b);

	// Build ranges to delete (including newlines)
	const changes: { from: number; to: number; insert: string }[] = [];

	for (const lineNum of sorted) {
		const line = doc.line(lineNum);
		let from = line.from;
		let to = line.to;

		// Include the newline after the line if possible
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
	});
}
