import { Text } from "@codemirror/state";

export type BlockType =
	| "frontmatter"
	| "heading"
	| "paragraph"
	| "list-item"
	| "code-block"
	| "blockquote-line"
	| "table"
	| "blank"
	| "unknown";

export interface Block {
	type: BlockType;
	startLine: number; // 1-based, inclusive
	endLine: number;   // 1-based, inclusive
	lines: string[];
	selected: boolean;
	listGroup?: number;    // ID shared by contiguous list items
	indentLevel?: number;  // for list-item blocks
}

// ── Line classifiers ────────────────────────────────────────────────────────

export function lineIsBlank(text: string): boolean {
	return text.trim() === "";
}

export function lineIsHeading(text: string): boolean {
	return /^#{1,6} /.test(text);
}

export function lineIsListItem(text: string): boolean {
	return /^(\s*)([-*+]|\d+\.)\s/.test(text);
}

export function lineIsBlockquote(text: string): boolean {
	return /^>/.test(text);
}

export function lineIsCodeFence(text: string): boolean {
	return /^(`{3,}|~{3,})/.test(text);
}

export function lineIsTableRow(text: string): boolean {
	return /^\s*\|/.test(text);
}

/** Valid block reference: ^word with only alphanumeric chars, no trailing space */
export function lineIsBlockRef(text: string): boolean {
	return /^\^[a-zA-Z0-9]+$/.test(text.trimEnd()) && !/ $/.test(text);
}

export function getLineIndentLevel(text: string): number {
	let i = 0;
	while (i < text.length && text[i] === "\t") i++;
	if (i > 0) return i;
	let spaces = 0;
	while (spaces < text.length && text[spaces] === " ") spaces++;
	return Math.floor(spaces / 4);
}

// ── Block ref absorption ────────────────────────────────────────────────────

/**
 * If the lines after `endLine` form a valid block-ref attachment
 * (optional blank lines, then ^ref line, then blank line), extend endLine
 * to include the ^ref line. Returns new endLine.
 */
function absorbBlockRef(doc: Text, endLine: number): number {
	const total = doc.lines;
	let i = endLine + 1;
	while (i <= total && lineIsBlank(doc.line(i).text)) i++;
	if (i > total) return endLine;
	const refText = doc.line(i).text;
	if (!lineIsBlockRef(refText)) return endLine;
	// Must have a blank line immediately after the ^ref
	if (i + 1 > total || !lineIsBlank(doc.line(i + 1).text)) return endLine;
	return i;
}

// ── Main parser ─────────────────────────────────────────────────────────────

/**
 * Parse the full document into a flat array of Block objects.
 * selectedLines is optional; when provided, each block's `selected` field
 * is set to true if any of its lines are in the set.
 */
export function parseDocument(doc: Text, selectedLines?: Set<number>): Block[] {
	const blocks: Block[] = [];
	const total = doc.lines;
	let listGroupCounter = 0;
	let currentListGroup: number | null = null;
	let lastWasList = false;

	let ln = 1;

	const lt = (n: number) => doc.line(n).text;

	const markSelected = (start: number, end: number): boolean => {
		if (!selectedLines) return false;
		for (let i = start; i <= end; i++) {
			if (selectedLines.has(i)) return true;
		}
		return false;
	};

	const pushBlock = (type: BlockType, start: number, end: number, extra?: Partial<Block>) => {
		const lines: string[] = [];
		for (let i = start; i <= end; i++) lines.push(lt(i));
		blocks.push({
			type,
			startLine: start,
			endLine: end,
			lines,
			selected: markSelected(start, end),
			...extra,
		});
	};

	// ── 1. Frontmatter ──────────────────────────────────────────────────────
	if (total >= 1 && /^---\s*$/.test(lt(1))) {
		let fmEnd = -1;
		for (let i = 2; i <= total; i++) {
			if (/^---\s*$/.test(lt(i))) { fmEnd = i; break; }
		}
		if (fmEnd !== -1) {
			pushBlock("frontmatter", 1, fmEnd);
			ln = fmEnd + 1;
		}
	}

	while (ln <= total) {
		const text = lt(ln);

		// ── Blank line ───────────────────────────────────────────────────────
		if (lineIsBlank(text)) {
			pushBlock("blank", ln, ln);
			lastWasList = false;
			currentListGroup = null;
			ln++;
			continue;
		}

		// ── Fenced code block ────────────────────────────────────────────────
		if (lineIsCodeFence(text)) {
			const fenceMatch = text.match(/^(`{3,}|~{3,})/);
			const fence = fenceMatch ? fenceMatch[1] : "```";
			const closePat = new RegExp(`^${fence[0]}{${fence.length},}`);
			let end = ln + 1;
			while (end <= total && !closePat.test(lt(end))) end++;
			if (end <= total) {
				pushBlock("code-block", ln, end);
				ln = end + 1;
			} else {
				// Unclosed fence — treat as single line
				pushBlock("code-block", ln, ln);
				ln++;
			}
			lastWasList = false;
			currentListGroup = null;
			continue;
		}

		// ── Heading (single line) ─────────────────────────────────────────────
		if (lineIsHeading(text)) {
			let end = absorbBlockRef(doc, ln);
			pushBlock("heading", ln, end);
			lastWasList = false;
			currentListGroup = null;
			ln = end + 1;
			continue;
		}

		// ── Blockquote line ───────────────────────────────────────────────────
		if (lineIsBlockquote(text)) {
			pushBlock("blockquote-line", ln, ln);
			lastWasList = false;
			currentListGroup = null;
			ln++;
			continue;
		}

		// ── Table ─────────────────────────────────────────────────────────────
		if (lineIsTableRow(text)) {
			let end = ln;
			while (end + 1 <= total && lineIsTableRow(lt(end + 1))) end++;
			end = absorbBlockRef(doc, end);
			pushBlock("table", ln, end);
			lastWasList = false;
			currentListGroup = null;
			ln = end + 1;
			continue;
		}

		// ── List item ─────────────────────────────────────────────────────────
		if (lineIsListItem(text)) {
			if (!lastWasList) {
				listGroupCounter++;
				currentListGroup = listGroupCounter;
			}
			const group = currentListGroup!;
			const indent = getLineIndentLevel(text);
			let end = absorbBlockRef(doc, ln);
			pushBlock("list-item", ln, end, { listGroup: group, indentLevel: indent });
			lastWasList = true;
			ln = end + 1;
			continue;
		}

		// ── Paragraph (plain text) ────────────────────────────────────────────
		{
			let end = ln;
			while (
				end + 1 <= total &&
				!lineIsBlank(lt(end + 1)) &&
				!lineIsHeading(lt(end + 1)) &&
				!lineIsListItem(lt(end + 1)) &&
				!lineIsBlockquote(lt(end + 1)) &&
				!lineIsCodeFence(lt(end + 1)) &&
				!lineIsTableRow(lt(end + 1))
			) {
				end++;
			}
			end = absorbBlockRef(doc, end);
			pushBlock("paragraph", ln, end);
			lastWasList = false;
			currentListGroup = null;
			ln = end + 1;
		}
	}

	return blocks;
}

// ── Rendering ────────────────────────────────────────────────────────────────

function needsBlankBetween(a: Block, b: Block): boolean {
	if (a.type === "list-item" && b.type === "list-item" && a.listGroup === b.listGroup) {
		return false;
	}
	return true;
}

/**
 * Reassign listGroup IDs so that contiguous list-item blocks share the same
 * group. Call after reordering blocks.
 */
export function reassignListGroups(blocks: Block[]): void {
	let counter = 0;
	let prevWasList = false;
	let currentGroup = 0;

	for (const b of blocks) {
		if (b.type === "list-item") {
			if (!prevWasList) {
				counter++;
				currentGroup = counter;
			}
			b.listGroup = currentGroup;
			prevWasList = true;
		} else if (b.type === "blank") {
			prevWasList = false;
		} else {
			prevWasList = false;
		}
	}
}

/**
 * Render an ordered list of content blocks into a string, inserting blank line
 * separators where needed. Returns rendered text and set of output line numbers
 * (1-based from baseLineNum) that belong to selected blocks.
 */
export function renderBlocks(
	contentBlocks: Block[],
	baseLineNum: number
): { text: string; newSelectedLines: Set<number> } {
	const outputLines: string[] = [];
	const newSelectedLines = new Set<number>();

	for (let i = 0; i < contentBlocks.length; i++) {
		if (i > 0 && needsBlankBetween(contentBlocks[i - 1], contentBlocks[i])) {
			outputLines.push("");
		}
		const blockStart = outputLines.length;
		for (const line of contentBlocks[i].lines) {
			outputLines.push(line);
		}
		if (contentBlocks[i].selected) {
			for (let k = blockStart; k < outputLines.length; k++) {
				newSelectedLines.add(baseLineNum + k);
			}
		}
	}

	return { text: outputLines.join("\n"), newSelectedLines };
}
