import { EditorState } from "@codemirror/state";

/**
 * Get the total number of lines in the document.
 */
export function getLineCount(state: EditorState): number {
	return state.doc.lines;
}

/**
 * Get the indentation level of a line (number of leading tabs or tab-equivalent spaces).
 */
export function getIndentLevel(line: string, tabSize: number, useTab: boolean): number {
	let level = 0;
	let i = 0;
	if (useTab) {
		while (i < line.length && line[i] === "\t") {
			level++;
			i++;
		}
	} else {
		let spaces = 0;
		while (i < line.length && line[i] === " ") {
			spaces++;
			i++;
		}
		level = Math.floor(spaces / tabSize);
	}
	return level;
}

/**
 * Get the text content of a line (1-based line number in CM6).
 */
export function getLineText(state: EditorState, lineNumber: number): string {
	return state.doc.line(lineNumber).text;
}

/**
 * Parse the heading level of a line. Returns 0 if not a heading.
 */
export function getHeadingLevel(text: string): number {
	const match = text.match(/^(#{1,6})\s/);
	return match ? match[1].length : 0;
}

/**
 * Strip heading prefix from text.
 */
export function stripHeading(text: string): string {
	return text.replace(/^#{1,6}\s/, "");
}

/**
 * Check if a line is a bullet list item.
 */
export function isBulletItem(text: string): boolean {
	return /^(\s*)([-*+])\s/.test(text);
}

/**
 * Check if a line is a numbered list item.
 */
export function isNumberedItem(text: string): boolean {
	return /^(\s*)\d+\.\s/.test(text);
}

/**
 * Check if a line is a checkbox item.
 */
export function isCheckboxItem(text: string): boolean {
	return /^(\s*)([-*+])\s\[[ x]\]\s/.test(text);
}

/**
 * Get the leading whitespace of a line.
 */
export function getLeadingWhitespace(text: string): string {
	const match = text.match(/^(\s*)/);
	return match ? match[1] : "";
}

/**
 * Get the content of a line after stripping list markers, checkboxes, etc.
 */
export function getContentAfterMarker(text: string): string {
	// Strip leading whitespace + list marker + optional checkbox
	return text.replace(/^(\s*)([-*+]|\d+\.)\s(\[[ x]\]\s)?/, "");
}

/**
 * For a list item at a given line, find the range of lines that includes
 * its children (sub-items with greater indentation).
 * Returns [startLine, endLine] inclusive, 1-based.
 */
export function getBlockWithChildren(
	state: EditorState,
	lineNumber: number,
	tabSize: number,
	useTab: boolean
): [number, number] {
	const lineText = getLineText(state, lineNumber);
	const baseIndent = getIndentLevel(lineText, tabSize, useTab);
	const totalLines = state.doc.lines;

	let endLine = lineNumber;
	for (let i = lineNumber + 1; i <= totalLines; i++) {
		const text = getLineText(state, i);
		// Empty lines are included if followed by indented content
		if (text.trim() === "") {
			// Look ahead to see if the next non-empty line is still a child
			let nextNonEmpty = i + 1;
			while (nextNonEmpty <= totalLines && getLineText(state, nextNonEmpty).trim() === "") {
				nextNonEmpty++;
			}
			if (nextNonEmpty <= totalLines && getIndentLevel(getLineText(state, nextNonEmpty), tabSize, useTab) > baseIndent) {
				endLine = i;
				continue;
			}
			break;
		}
		const indent = getIndentLevel(text, tabSize, useTab);
		if (indent > baseIndent) {
			endLine = i;
		} else {
			break;
		}
	}

	return [lineNumber, endLine];
}
