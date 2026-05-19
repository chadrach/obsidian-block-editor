import { StateField, StateEffect } from "@codemirror/state";

export interface BlockSelectionState {
	active: boolean;
	selectedBlocks: Set<number>;
	hadSelection: boolean; // true once any block has been selected in this session
}

// Effects
export const toggleBlockMode = StateEffect.define<boolean>();
export const toggleBlockSelection = StateEffect.define<number>(); // line number
export const setBlockSelection = StateEffect.define<Set<number>>();
export const clearBlockSelection = StateEffect.define<void>();

export const blockSelectionState = StateField.define<BlockSelectionState>({
	create() {
		return { active: false, selectedBlocks: new Set(), hadSelection: false };
	},
	update(value, tr) {
		let result = value;
		for (const effect of tr.effects) {
			if (effect.is(toggleBlockMode)) {
				// Entering block mode preserves any selection that was already
				// staged (so a dispatch can batch toggleBlockMode + setBlockSelection
				// without the order mattering). Exiting clears.
				result = {
					active: effect.value,
					selectedBlocks: effect.value ? result.selectedBlocks : new Set(),
					hadSelection: effect.value ? result.hadSelection : false,
				};
			} else if (effect.is(toggleBlockSelection)) {
				const newSet = new Set(result.selectedBlocks);
				if (newSet.has(effect.value)) {
					newSet.delete(effect.value);
				} else {
					newSet.add(effect.value);
				}
				result = {
					active: result.active,
					selectedBlocks: newSet,
					hadSelection: result.hadSelection || newSet.size > 0,
				};
			} else if (effect.is(setBlockSelection)) {
				result = {
					active: result.active,
					selectedBlocks: effect.value,
					hadSelection: result.hadSelection || effect.value.size > 0,
				};
			} else if (effect.is(clearBlockSelection)) {
				result = { active: result.active, selectedBlocks: new Set(), hadSelection: result.hadSelection };
			}
		}
		return result;
	},
});
