import { StateField, StateEffect } from "@codemirror/state";

export interface BlockSelectionState {
	active: boolean;
	selectedBlocks: Set<number>; // Set of line numbers (0-based)
}

// Effects
export const toggleBlockMode = StateEffect.define<boolean>();
export const toggleBlockSelection = StateEffect.define<number>(); // line number
export const setBlockSelection = StateEffect.define<Set<number>>();
export const clearBlockSelection = StateEffect.define<void>();

export const blockSelectionState = StateField.define<BlockSelectionState>({
	create() {
		return { active: false, selectedBlocks: new Set() };
	},
	update(value, tr) {
		let result = value;
		for (const effect of tr.effects) {
			if (effect.is(toggleBlockMode)) {
				result = {
					active: effect.value,
					selectedBlocks: new Set(),
				};
			} else if (effect.is(toggleBlockSelection)) {
				const newSet = new Set(result.selectedBlocks);
				if (newSet.has(effect.value)) {
					newSet.delete(effect.value);
				} else {
					newSet.add(effect.value);
				}
				result = { active: result.active, selectedBlocks: newSet };
			} else if (effect.is(setBlockSelection)) {
				result = { active: result.active, selectedBlocks: effect.value };
			} else if (effect.is(clearBlockSelection)) {
				result = { active: result.active, selectedBlocks: new Set() };
			}
		}
		return result;
	},
});
