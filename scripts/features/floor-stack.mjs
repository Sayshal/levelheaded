import { FloorStackApp } from '../apps/floor-stack.mjs';
import { MODULE } from '../constants.mjs';
import { createFloorSurface, levelBelow, sceneFloorData, stackedLevels } from '../utils.mjs';

const { createFormGroup } = foundry.applications.fields;

/**
 * Data for a stack of floors with surfaces between them.
 * @param {Scene} scene The scene
 * @param {object} config Wizard values
 * @param {number} config.count Number of floors
 * @param {number} config.height Height of each floor
 * @param {number} config.base Elevation of the lowest floor's bottom
 * @param {string} config.name Floor name prefix
 * @param {boolean} config.surfaces Create floor surfaces
 * @param {boolean} config.visible Make adjacent floors visible to each other
 * @param {boolean} config.culling Cull tokens on the created surfaces
 * @returns {{levels: object[], regions: object[], below: object|null}} Creation data and the level below
 */
export function floorStackData(scene, { count, height, base, name, surfaces, visible, culling }) {
  const below = stackedLevels(scene).find((level) => level.elevation.top === base) ?? null;
  const sort = Math.max(0, ...scene.levels.map((level) => level.sort)) + 1;
  const levels = Array.from({ length: count }, (_, i) => ({
    _id: foundry.utils.randomID(),
    name: `${name} ${i + 1}`,
    elevation: { bottom: base + i * height, top: base + (i + 1) * height },
    sort: sort + i,
    visibility: { levels: [] }
  }));
  if (visible) {
    levels.forEach((level, i) => {
      level.visibility.levels = [levels[i - 1]?._id ?? below?.id, levels[i + 1]?._id].filter(Boolean);
    });
  }
  const regions = [];
  if (surfaces) {
    const prepared = levels.map((level) => ({ id: level._id, name: level.name, elevation: level.elevation }));
    prepared.forEach((upper, i) => {
      const lower = prepared[i - 1] ?? below;
      if (lower) regions.push(sceneFloorData(scene, upper, lower, { exposure: i === prepared.length - 1, culling }));
    });
  }
  return { levels, regions, below };
}

/** The Floor Stack wizard, and a floor surface added when a GM creates a level on top of another. */
export class FloorStack {
  /**
   * Add the wizard button to Scene Config and the level creation hook.
   * @returns {void}
   */
  static register() {
    Hooks.on('renderSceneConfig', FloorStack.#onRenderSceneConfig);
    Hooks.on('createLevel', FloorStack.#onCreateLevel);
  }

  /**
   * Add a Floor Stack button to the Levels tab.
   * @param {foundry.applications.sheets.SceneConfig} app The scene config
   * @param {HTMLElement} html The rendered element
   * @returns {void}
   */
  static #onRenderSceneConfig(app, html) {
    const tab = html.querySelector('.tab[data-tab="levels"]');
    if (!tab || tab.querySelector('[data-levelheaded-floor-stack]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `${app.id}-levelheaded-floor-stack`;
    button.dataset.levelheadedFloorStack = '';
    button.innerHTML = `<i class="fa-solid fa-building" inert></i> <span>${_loc('LEVELHEADED.FloorStack.Button')}</span>`;
    button.addEventListener('click', () => FloorStackApp.open(app.document));
    const group = createFormGroup({ classes: ['levelheaded-floor-stack'], label: _loc('LEVELHEADED.FloorStack.Label'), hint: _loc('LEVELHEADED.FloorStack.Hint'), input: button });
    group.querySelector('label').htmlFor = button.id;
    tab.querySelector('fieldset')?.after(group);
  }

  /**
   * When a GM creates a level whose bottom meets the top of another, give it a floor surface.
   * @param {object} level The created level
   * @param {object} options Creation options
   * @param {string} userId The creating user
   * @returns {Promise<void>}
   */
  static async #onCreateLevel(level, options, userId) {
    if (userId !== game.user.id || options.levelheadedStack || !game.settings.get(MODULE.ID, MODULE.SETTINGS.ADD_FLOORS_TO_NEW_LEVELS)) return;
    const scene = level.parent;
    const lower = levelBelow(scene, level);
    if (!lower || lower.elevation.top !== level.elevation.bottom) return;
    if (scene.getSurfaces().some((surface) => surface.elevation === level.elevation.bottom)) return;
    await createFloorSurface(scene, level, lower, { exposure: stackedLevels(scene).at(-1) === level });
  }
}
