import { EditorView } from "@codemirror/view";
import { Annotation } from "@codemirror/state";
import { blockSelectionState, setBlockSelection, toggleBlockSelection, toggleBlockMode } from "./state";
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
import { parseDocument, renderBlocks, reassignListGroups, Block } from "./block-parser";

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
 * Core block movement using the document parser.
 *
 * Correct reordering for non-contiguous selections:
 * - selBlocks: selected blocks in original order
 * - remainingBlocks: non-selected blocks in original order (preserves interleaved blocks)
 * - For "down": insert selBlocks after the first remaining block past the last selected
 * - For "up": insert selBlocks before the last remaining block before the first selected
 *
 * Falls through (returns false) for pure list-item selections so the
 * existing indent-aware swap logic handles those.
 */
function moveBlocksWithParser(
	view: EditorView,
	selectedLines: Set<number>,
	direction: "up" | "down"
): boolean {
	const doc = view.state.doc;
	const fmEnd = getFrontmatterEndForOps(view);

	const allBlocks = parseDocument(doc, selectedLines);
	const contentBlocks = allBlocks.filter(b => b.type !== "frontmatter");

	if (!contentBlocks.some(b => b.selected)) return false;

	// Fall through to indent-aware swap for pure list selections
	if (contentBlocks.filter(b => b.selected).every(b => b.type === "list-item")) return false;

	const nonBlankContent = contentBlocks.filter(b => b.type !== "blank");
	if (nonBlankContent.length === 0) return false;

	// Build selected and remaining arrays, both preserving original order.
	// Track each remaining block's original index so we can find the pivot.
	const selBlocks: Block[] = [];
	const remainingBlocks: Block[] = [];
	const remainingOrigIdx: number[] = [];

	nonBlankContent.forEach((b, i) => {
		if (b.selected) {
			selBlocks.push(b);
		} else {
			remainingBlocks.push(b);
			remainingOrigIdx.push(i);
		}
	});

	if (selBlocks.length === 0 || remainingBlocks.length === 0) return false;

	const firstSelIdx = nonBlankContent.findIndex(b => b.selected);
	const lastSelIdx = nonBlankContent.length - 1 -
		[...nonBlankContent].reverse().findIndex(b => b.selected);

	// Non-contiguous check: are there remaining blocks interleaved within the selection?
	const hasInterleaved = remainingOrigIdx.some(idx => idx > firstSelIdx && idx < lastSelIdx);

	let reordered: Block[];

	if (direction === "up") {
		// Pivot = last remaining block whose original index < firstSelIdx
		let pivotRemainingIdx = -1;
		for (let i = remainingOrigIdx.length - 1; i >= 0; i--) {
			if (remainingOrigIdx[i] < firstSelIdx) { pivotRemainingIdx = i; break; }
		}

		if (pivotRemainingIdx < 0) {
			// At top boundary — gather non-contiguous selection if applicable
			if (!hasInterleaved || selBlocks.length < 2) return false;
			reordered = [...selBlocks, ...remainingBlocks];
		} else {
			if (fmEnd > 0 && remainingBlocks[pivotRemainingIdx].endLine <= fmEnd) return false;

			// If pivot is a list-item, jump the entire list group: walk back to first block in group
			if (remainingBlocks[pivotRemainingIdx].type === "list-item") {
				const pivotGroup = remainingBlocks[pivotRemainingIdx].listGroup!;
				for (let i = pivotRemainingIdx - 1; i >= 0; i--) {
					const rb = remainingBlocks[i];
					if (rb.type === "list-item" && rb.listGroup === pivotGroup) {
						pivotRemainingIdx = i;
					} else {
						break;
					}
				}
			}

			// Insert selBlocks BEFORE the pivot in the remaining sequence
			reordered = [
				...remainingBlocks.slice(0, pivotRemainingIdx),
				...selBlocks,
				...remainingBlocks.slice(pivotRemainingIdx),
			];
		}

	} else {
		// Pivot = first remaining block whose original index > lastSelIdx
		let pivotRemainingIdx = -1;
		for (let i = 0; i < remainingOrigIdx.length; i++) {
			if (remainingOrigIdx[i] > lastSelIdx) { pivotRemainingIdx = i; break; }
		}

		if (pivotRemainingIdx < 0) {
			// At bottom boundary — gather non-contiguous selection if applicable
			if (!hasInterleaved || selBlocks.length < 2) return false;
			reordered = [...remainingBlocks, ...selBlocks];
		} else {
			// If pivot is a list-item, jump the entire list group: walk forward to last block in group
			if (remainingBlocks[pivotRemainingIdx].type === "list-item") {
				const pivotGroup = remainingBlocks[pivotRemainingIdx].listGroup!;
				for (let i = pivotRemainingIdx + 1; i < remainingBlocks.length; i++) {
					const rb = remainingBlocks[i];
					if (rb.type === "list-item" && rb.listGroup === pivotGroup) {
						pivotRemainingIdx = i;
					} else {
						break;
					}
				}
			}

			// Insert selBlocks AFTER the pivot in the remaining sequence
			reordered = [
				...remainingBlocks.slice(0, pivotRemainingIdx + 1),
				...selBlocks,
				...remainingBlocks.slice(pivotRemainingIdx + 1),
			];
		}
	}

	return dispatchReorder(view, doc, reordered, fmEnd);
}

function dispatchReorder(
	view: EditorView,
	doc: any,
	reorderedContent: Block[],
	fmEnd: number
): boolean {
	reassignListGroups(reorderedContent);

	const regionStart = fmEnd > 0 ? fmEnd + 1 : 1;
	const regionFrom = doc.line(regionStart).from;

	const { text, newSelectedLines } = renderBlocks(reorderedContent, regionStart);

	// Use a minimal change range (common prefix/suffix trimmed to line boundaries)
	// so CM6's cursor doesn't jump to position 0, preventing scroll-to-top.
	const origFull: string = doc.sliceString(regionFrom);

	let prefixLen = 0;
	while (prefixLen < Math.min(origFull.length, text.length) &&
		origFull[prefixLen] === text[prefixLen]) {
		prefixLen++;
	}
	while (prefixLen > 0 && origFull[prefixLen - 1] !== "\n") prefixLen--;

	let suffixLen = 0;
	const maxSuffix = Math.min(origFull.length - prefixLen, text.length - prefixLen);
	while (suffixLen < maxSuffix &&
		origFull[origFull.length - 1 - suffixLen] === text[text.length - 1 - suffixLen]) {
		suffixLen++;
	}
	while (suffixLen > 0 && origFull[origFull.length - suffixLen] !== "\n") suffixLen--;

	const changeFrom = regionFrom + prefixLen;
	const changeTo = regionFrom + origFull.length - suffixLen;
	const insertText = text.slice(prefixLen, text.length - suffixLen);

	view.dispatch({
		changes: { from: changeFrom, to: changeTo, insert: insertText },
		effects: [setBlockSelection.of(newSelectedLines)],
		annotations: [blockEditorTransaction.of(true)],
	});
	return true;
}

export function moveBlocksToPosition(
	view: EditorView,
	selectedLines: Set<number>,
	targetIdx: number
): void {
	const doc = view.state.doc;
	const fmEnd = getFrontmatterEndForOps(view);

	const allBlocks = parseDocument(doc, selectedLines);
	const nonBlank = allBlocks.filter(b => b.type !== "frontmatter" && b.type !== "blank");

	const selBlocks: Block[] = [];
	const remainingBlocks: Block[] = [];
	nonBlank.forEach(b => {
		if (b.selected) selBlocks.push(b);
		else remainingBlocks.push(b);
	});

	if (selBlocks.length === 0) return;
	const idx = Math.max(0, Math.min(targetIdx, remainingBlocks.length));

	const reordered = [
		...remainingBlocks.slice(0, idx),
		...selBlocks,
		...remainingBlocks.slice(idx),
	];

	dispatchReorder(view, doc, reordered, fmEnd);
}

/**
 * Move selected blocks up by one block.
 * Uses parser for non-pure-list selections; falls back to indent-aware swap.
 */
export function moveBlocksUp(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;
	if (moveBlocksWithParser(view, selectedLines, "up")) return;

	const expanded = expandWithChildren(view, selectedLines);
	const firstLine = expanded[0];
	const lastLine = expanded[expanded.length - 1];

	if (firstLine <= 1) return;

	const doc = view.state.doc;
	const lineAbove = doc.line(firstLine - 1);

	// Don't move into or past frontmatter
	const frontmatterEnd = getFrontmatterEndForOps(view);
	if (frontmatterEnd > 0 && firstLine - 1 <= frontmatterEnd) return;
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
 * Move selected blocks down by one block.
 * Uses parser for non-pure-list selections; falls back to indent-aware swap.
 */
export function moveBlocksDown(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;
	if (moveBlocksWithParser(view, selectedLines, "down")) return;

	const expanded = expandWithChildren(view, selectedLines);
	const firstLine = expanded[0];
	const lastLine = expanded[expanded.length - 1];

	if (lastLine >= view.state.doc.lines) return;

	const doc = view.state.doc;
	const lineBelow = doc.line(lastLine + 1);
	const firstSelectedLine = doc.line(firstLine);
	const lastSelectedLine = doc.line(lastLine);

	const useTab = true;
	const tabSize = 4;
	const indentStr = useTab ? "\t" : " ".repeat(tabSize);

	const belowIndent = getIndentLevel(lineBelow.text, tabSize, useTab);
	const currentIndent = getIndentLevel(firstSelectedLine.text, tabSize, useTab);

	if (currentIndent > belowIndent) {
		// Selected is deeper than line below — outdent by exactly 1, no swap
		const blockTexts: string[] = [];
		for (let i = firstLine; i <= lastLine; i++) {
			let text = doc.line(i).text;
			if (text.startsWith("\t")) {
				text = text.slice(1);
			} else if (text.startsWith(" ".repeat(tabSize))) {
				text = text.slice(tabSize);
			}
			blockTexts.push(text);
		}
		view.dispatch({
			changes: { from: firstSelectedLine.from, to: lastSelectedLine.to, insert: blockTexts.join("\n") },
			annotations: [blockEditorTransaction.of(true)],
		});
		return;
	}

	// currentIndent <= belowIndent — swap with line below
	// Check if line below has children (next non-empty line after it is more indented)
	let belowHasChildren = false;
	if (lastLine + 2 <= doc.lines) {
		const lineBelowNext = doc.line(lastLine + 2);
		if (lineBelowNext.text.trim() !== "" &&
			getIndentLevel(lineBelowNext.text, tabSize, useTab) > belowIndent) {
			belowHasChildren = true;
		}
	}

	const targetIndent = (belowHasChildren && currentIndent <= belowIndent)
		? belowIndent + 1
		: belowIndent;

	const indentDelta = targetIndent - currentIndent;

	const blockTexts: string[] = [];
	for (let i = firstLine; i <= lastLine; i++) {
		let text = doc.line(i).text;
		if (indentDelta > 0) {
			text = indentStr.repeat(indentDelta) + text;
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
 * Paste clipboard text over the selected blocks. The clipboard content
 * replaces the top-most selected block; any lower selected blocks are
 * deleted. Works for non-contiguous selections, preserving interleaved
 * unselected blocks.
 */
export async function pasteBlocks(view: EditorView, selectedLines: Set<number>): Promise<void> {
	if (selectedLines.size === 0) return;

	let text: string;
	try {
		text = await navigator.clipboard.readText();
	} catch (_) {
		return;
	}
	if (text === "") {
		deleteBlocks(view, selectedLines);
		return;
	}
	// Normalize trailing newline so the pasted text occupies whole lines.
	const insert = text.replace(/\n+$/, "");

	const expanded = expandWithChildren(view, selectedLines);
	if (expanded.length === 0) return;
	const doc = view.state.doc;

	const changes: { from: number; to: number; insert: string }[] = [];

	// Replace the top-most line's text with the clipboard content.
	const topLine = doc.line(expanded[0]);
	changes.push({ from: topLine.from, to: topLine.to, insert });

	// Delete every other selected line (including its newline).
	for (const lineNum of expanded.slice(1)) {
		const line = doc.line(lineNum);
		let from = line.from;
		let to = line.to;
		if (to < doc.length) {
			to += 1;
		} else if (from > 0) {
			from -= 1;
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
 * Toggle blockquote (> ) prefix on selected blocks.
 */
export function toggleQuote(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;

	const doc = view.state.doc;
	const changes: { from: number; to: number; insert: string }[] = [];
	const sorted = Array.from(selectedLines).sort((a, b) => a - b);
	const firstLine = sorted[0];
	const lastLine = sorted[sorted.length - 1];

	// Build full range including blank/quote-only lines between selected blocks
	const allLines: number[] = [];
	for (let i = firstLine; i <= lastLine; i++) {
		const text = doc.line(i).text;
		if (selectedLines.has(i) || text.trim() === "" || text.trim() === ">") {
			allLines.push(i);
		}
	}

	// Check if every selected (non-blank) line is already quoted
	// A line is "quoted" if it starts with "> " or is exactly ">"
	const allQuoted = sorted.every(l => {
		const text = doc.line(l).text;
		return text.startsWith("> ") || text === ">";
	});

	for (const lineNum of allLines) {
		const line = doc.line(lineNum);
		const text = line.text;

		if (allQuoted) {
			// Remove quote: handle "> text", "> ", and bare ">"
			changes.push({ from: line.from, to: line.to, insert: text.replace(/^> ?/, "") });
		} else {
			// Add quote: skip lines already quoted, handle blank gap lines
			if (text.startsWith("> ")) {
				// Already quoted — leave as-is
			} else if (text.trim() === "" || text.trim() === ">") {
				changes.push({ from: line.from, to: line.to, insert: ">" });
			} else {
				changes.push({ from: line.from, to: line.to, insert: "> " + text });
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
 * Toggle an inline markdown wrapper (e.g. ** for bold) on all selected lines.
 * Wraps/unwraps the text content (after any list/heading prefix) with the marker.
 */
export function toggleInlineFormat(view: EditorView, selectedLines: Set<number>, marker: string): void {
	if (selectedLines.size === 0) return;

	const doc = view.state.doc;
	const changes: { from: number; to: number; insert: string }[] = [];
	const sorted = Array.from(selectedLines).sort((a, b) => a - b);

	// Check if all selected lines already have the marker wrapping their content
	const allWrapped = sorted.every(ln => {
		const text = doc.line(ln).text;
		const content = getContentPart(text);
		return content.startsWith(marker) && content.endsWith(marker) && content.length >= marker.length * 2;
	});

	for (const lineNum of sorted) {
		if (lineNum < 1 || lineNum > doc.lines) continue;
		const line = doc.line(lineNum);
		const text = line.text;
		const prefixEnd = getContentStartIndex(text);
		const prefix = text.slice(0, prefixEnd);
		const content = text.slice(prefixEnd);

		let newContent: string;
		if (allWrapped) {
			// Remove markers
			newContent = content.slice(marker.length, content.length - marker.length);
		} else {
			// Add markers (remove existing first if present to avoid double-wrapping)
			let stripped = content;
			if (stripped.startsWith(marker) && stripped.endsWith(marker) && stripped.length >= marker.length * 2) {
				stripped = stripped.slice(marker.length, stripped.length - marker.length);
			}
			newContent = marker + stripped + marker;
		}

		const newText = prefix + newContent;
		if (newText !== text) {
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
 * Get the text content part of a line (after heading/list/quote prefixes).
 */
function getContentPart(text: string): string {
	return text.slice(getContentStartIndex(text));
}

/**
 * Get the index where actual text content starts (after markdown prefixes).
 */
function getContentStartIndex(text: string): number {
	// Strip leading whitespace
	const wsMatch = text.match(/^(\s*)/);
	let idx = wsMatch ? wsMatch[1].length : 0;
	const rest = text.slice(idx);

	// Strip heading prefix
	const headingMatch = rest.match(/^(#{1,6}\s+)/);
	if (headingMatch) {
		idx += headingMatch[1].length;
		return idx;
	}

	// Strip list prefix (bullet, numbered, checkbox)
	const listMatch = rest.match(/^((?:[-*+]|\d+\.)\s+(?:\[[ x]\]\s+)?)/);
	if (listMatch) {
		idx += listMatch[1].length;
		return idx;
	}

	// Strip quote prefix
	const quoteMatch = rest.match(/^(>\s+)/);
	if (quoteMatch) {
		idx += quoteMatch[1].length;
		return idx;
	}

	return idx;
}

/**
 * Toggle code block/inline code formatting on selected lines.
 * Single line: wraps content in backticks. Multiple lines: wraps in fenced code block.
 */
export function toggleCodeFormat(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;
	// For block selection, use inline code (backticks) per line
	toggleInlineFormat(view, selectedLines, "`");
}

/**
 * Get the frontmatter end line (0 if none).
 */
function getFrontmatterEndForOps(view: EditorView): number {
	const doc = view.state.doc;
	if (doc.lines < 1) return 0;
	// Match --- with possible trailing whitespace
	if (!/^---\s*$/.test(doc.line(1).text)) return 0;
	for (let i = 2; i <= doc.lines; i++) {
		if (/^---\s*$/.test(doc.line(i).text)) return i;
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

/**
 * Extract the list/quote/indent prefix from a line of text.
 * Returns the leading whitespace + list marker (or just whitespace) so
 * a newly inserted sibling line will match the same formatting.
 *
 * Examples:
 *   "  - [ ] foo"  →  "  - [ ] "
 *   "  - foo"      →  "  - "
 *   "  1. foo"     →  "  1. "
 *   "> foo"        →  "> "
 *   "  foo"        →  "  "
 */
function getLinePrefix(text: string): string {
	// Leading whitespace
	const wsMatch = text.match(/^(\s*)/);
	const ws = wsMatch ? wsMatch[1] : "";
	const rest = text.slice(ws.length);

	// Checkbox list item: "- [ ] " or "- [x] "
	const checkboxMatch = rest.match(/^([-*+]\s+\[[ x]\]\s+)/);
	if (checkboxMatch) return ws + checkboxMatch[1];

	// Bullet list item: "- " or "* " or "+ "
	const bulletMatch = rest.match(/^([-*+]\s+)/);
	if (bulletMatch) return ws + bulletMatch[1];

	// Numbered list item: "1. " etc — always use "1. " for new items
	const numberedMatch = rest.match(/^(\d+\.\s+)/);
	if (numberedMatch) return ws + "1. ";

	// Block quote: "> "
	const quoteMatch = rest.match(/^(>\s+)/);
	if (quoteMatch) return ws + quoteMatch[1];

	// Indentation only
	return ws;
}

/**
 * Detect whether a line prefix represents list formatting.
 * Returns true for bullets, numbered lists, checkboxes.
 */
function isListPrefix(prefix: string): boolean {
	const trimmed = prefix.trimStart();
	return /^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed);
}

/**
 * Insert a new empty line above the top-most selected block, matching its
 * list/indent prefix. Exits block mode and places cursor at start of new line.
 * For non-list blocks (paragraphs, headings, quotes), adds an extra blank line
 * between the new line and the selected block.
 */
export function insertAbove(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;
	const doc = view.state.doc;
	const sorted = Array.from(selectedLines).sort((a, b) => a - b);

	// Resolve the full block containing the top-most selected line so we insert
	// above the block as Obsidian defines it (multi-line bodies, list children).
	const blocks = parseDocument(doc);
	const topBlock = blocks.find(b => sorted[0] >= b.startLine && sorted[0] <= b.endLine);
	const startLineNum = topBlock ? topBlock.startLine : sorted[0];

	const topLine = doc.line(startLineNum);
	// Continue list formatting, but a new line above a blockquote should be
	// plain body text — drop the "> " prefix.
	const isQuote = topBlock ? topBlock.type === "blockquote" : false;
	const prefix = isQuote ? "" : getLinePrefix(topLine.text);
	const isList = isListPrefix(prefix);
	const insertPos = topLine.from;
	const insertText = isList ? prefix + "\n" : prefix + "\n\n";
	view.dispatch({
		changes: { from: insertPos, to: insertPos, insert: insertText },
		selection: { anchor: insertPos + prefix.length },
		annotations: [blockEditorTransaction.of(true)],
		effects: [toggleBlockMode.of(false)],
	});
	view.focus();
}

/**
 * Insert a new empty line below the bottom-most selected block, matching its
 * list/indent prefix. Exits block mode and places cursor at start of new line.
 * For non-list blocks, adds an extra blank line between the selected block and
 * the new line.
 */
export function insertBelow(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;
	const doc = view.state.doc;
	const sorted = Array.from(selectedLines).sort((a, b) => a - b);
	const bottomSel = sorted[sorted.length - 1];

	// Resolve the full block containing the bottom-most selected line so we
	// insert below the entire block (multi-line bodies, absorbed ^ref lines,
	// and nested list children) rather than just the next physical line.
	const blocks = parseDocument(doc);
	const block = blocks.find(b => bottomSel >= b.startLine && bottomSel <= b.endLine);
	let endLineNum = bottomSel;
	let prefixLineNum = bottomSel;
	if (block) {
		endLineNum = block.endLine;
		prefixLineNum = block.startLine;
		if (block.type === "list-item") {
			const [, childEnd] = getBlockWithChildren(view.state, block.startLine, 4, true);
			endLineNum = Math.max(endLineNum, childEnd);
		}
	}

	const bottomLine = doc.line(endLineNum);
	// Continue list formatting, but a new line below a blockquote should be
	// plain body text — drop the "> " prefix.
	const isQuote = block ? block.type === "blockquote" : false;
	const prefix = isQuote ? "" : getLinePrefix(doc.line(prefixLineNum).text);
	const isList = isListPrefix(prefix);
	const insertPos = bottomLine.to;
	const insertText = isList ? "\n" + prefix : "\n\n" + prefix;
	const cursorOffset = isList ? 1 + prefix.length : 2 + prefix.length;
	view.dispatch({
		changes: { from: insertPos, to: insertPos, insert: insertText },
		selection: { anchor: insertPos + cursorOffset },
		annotations: [blockEditorTransaction.of(true)],
		effects: [toggleBlockMode.of(false)],
	});
	view.focus();
}

/**
 * Place cursor at the end of the top-most selected block and exit block mode.
 */
export function editBlock(view: EditorView, selectedLines: Set<number>): void {
	if (selectedLines.size === 0) return;
	const sorted = Array.from(selectedLines).sort((a, b) => a - b);
	const topLine = view.state.doc.line(sorted[0]);
	view.dispatch({
		selection: { anchor: topLine.to },
		annotations: [blockEditorTransaction.of(true)],
		effects: [toggleBlockMode.of(false)],
	});
	view.focus();
}
