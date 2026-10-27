import { MakeStairApp } from '../apps/make-stair.mjs';
import { MODULE } from '../constants.mjs';
import { registerSilentChangeLevel } from '../data/silent-change-level.mjs';
import { addTool, isMultiLevel, storable } from '../utils.mjs';

/**
 * The levels a connector spans and the region elevation that covers them, top inclusive.
 * @param {object[]} levels All scene levels
 * @param {object} from One end
 * @param {object} to The other end
 * @param {"stair"|"elevator"} type A stair links the two ends; an elevator stops at every level between
 * @returns {{levels: object[], elevation: {bottom: number|null, top: number|null, topInclusive: boolean}}} The span
 */
export function connectorSpan(levels, from, to, type) {
  const low = Math.min(from.elevation.base, to.elevation.base);
  const high = Math.max(from.elevation.base, to.elevation.base);
  const spanned = type === 'elevator' ? levels.filter((level) => level.elevation.base >= low && level.elevation.base <= high) : [from, to];
  return {
    levels: spanned,
    elevation: {
      bottom: storable(Math.min(...spanned.map((level) => level.elevation.bottom))),
      top: storable(Math.max(...spanned.map((level) => level.elevation.top))),
      topInclusive: true
    }
  };
}

/** Registers the silent Change Level behavior and the Make Stair tool. */
export class SilentStairs {
  /**
   * Register the behavior type, tailor its sheet, and add the Regions control button.
   * @returns {void}
   */
  static register() {
    registerSilentChangeLevel();
    Hooks.on('renderRegionBehaviorConfig', SilentStairs.#onRenderBehaviorConfig);
    Hooks.on('getSceneControlButtons', (controls) => {
      if (!game.user.isGM || !controls.regions) return;
      addTool(controls.regions, {
        name: 'levelheadedStair',
        title: 'LEVELHEADED.Stair.Title',
        icon: 'fa-solid fa-stairs',
        button: true,
        onChange: () => SilentStairs.#makeStair()
      });
    });
  }

  /**
   * Trim destinations to those the region supports and label the offsets in grid spaces.
   * @param {foundry.applications.sheets.RegionBehaviorConfig} app The behavior sheet
   * @param {HTMLElement} html Its element
   * @returns {void}
   */
  static #onRenderBehaviorConfig(app, html) {
    if (app.document.type !== MODULE.BEHAVIOR_TYPE) return;
    const region = app.document.parent;
    const levels = region.levels.size ? region.levels : new Set(region.parent.levels.keys());
    const applies = { other: levels.size === 2, above: levels.size > 1, below: levels.size > 1 };
    for (const option of html.querySelectorAll('[name="system.destination"] option')) {
      if (!option.selected && !(applies[option.value] ?? levels.has(option.value))) option.remove();
    }
    for (const name of ['offsetX', 'offsetY']) {
      const label = html.querySelector(`[name="system.${name}"]`)?.closest('.form-group')?.querySelector('label');
      label?.insertAdjacentHTML('beforeend', ` <span class="units">(${_loc('LEVELHEADED.Behavior.SilentChangeLevel.GridSpaces')})</span>`);
    }
  }

  /**
   * Open Make Stair for the controlled regions.
   * @returns {void}
   */
  static #makeStair() {
    const regions = canvas.regions.controlled.map((region) => region.document);
    if (!regions.length) return ui.notifications.warn('LEVELHEADED.Stair.NoSelection', { localize: true });
    if (!isMultiLevel(canvas.scene)) return ui.notifications.warn('LEVELHEADED.Stair.NeedLevels', { localize: true });
    MakeStairApp.open(canvas.scene, regions);
  }
}
