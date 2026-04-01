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
		for (const effect of tr.effects) {
			if (effect.is(toggleBlockMode)) {
				if (effect.value) {
					return { active: true, selectedBlocks: new Set() };
				} else {
					return { active: false, selectedBlocks: new Set() };
				}
			}
			if (effect.is(toggleBlockSelection)) {
				const newSet = new Set(value.selectedBlocks);
				if (newSet.has(effect.value)) {
					newSet.delete(effect.value);
				} else {
					newSet.add(effect.value);
				}
				return { active: value.active, selectedBlocks: newSet };
			}
			if (effect.is(setBlockSelection)) {
				return { active: value.active, selectedBlocks: effect.value };
			}
			if (effect.is(clearBlockSelection)) {
				return { active: value.active, selectedBlocks: new Set() };
			}
		}
		return value;
	},
});
