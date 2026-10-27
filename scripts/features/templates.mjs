import { SurfaceTemplateApp } from '../apps/surface-template.mjs';
import { MODULE } from '../constants.mjs';
import { addTool, floorRegionData, levelBelow } from '../utils.mjs';

/** @type {Object<string, object[]>} defineSurface behaviors per template, each with a localized name key. */
export const SURFACES = {
  roof: [{ name: 'LEVELHEADED.Templates.Type.roof', occlusion: true, exposure: true, culling: true }],
  balcony: [{ name: 'LEVELHEADED.Templates.Type.balcony', occlusion: true, exposure: true }],
  trapdoor: [{ name: 'LEVELHEADED.Templates.Trapdoor.Lid', occlusion: true }],
  pair: [
    { name: 'LEVELHEADED.Templates.Pair.Vision', occlusion: false },
    { name: 'LEVELHEADED.Templates.Pair.Fade', light: false, move: false, sight: false, sound: false, occlusion: true }
  ]
};

/**
 * Region update data that turns a region into a template at a level's floor.
 * @param {RegionDocument} region The region
 * @param {string} type Template key
 * @param {object} level The level whose floor the template sits on
 * @param {object|null} below The level under it
 * @returns {object} Update data, plus the behaviors to create
 */
export function templateData(region, type, level, below) {
  const behaviors = SURFACES[type].map(({ name, ...system }) => ({ name: _loc(name), ...system }));
  const { elevation, levels, behaviors: surfaces } = floorRegionData(level, below, { name: region.name, shapes: [], behaviors });
  if (type === 'trapdoor') surfaces.push({ type: MODULE.BEHAVIOR_TYPE, name: _loc('LEVELHEADED.Templates.Trapdoor.Drop'), disabled: true, system: { destination: 'other' } });
  return { update: { elevation, levels, 'restriction.enabled': false, [`flags.${MODULE.ID}.${MODULE.FLAGS.TEMPLATE}`]: type }, behaviors: surfaces };
}

/**
 * Turn regions into a template at a level's floor.
 * @param {RegionDocument[]} regions The regions
 * @param {string} type Template key
 * @param {object} level The level whose floor the template sits on
 * @returns {Promise<void>}
 */
export async function applyTemplate(regions, type, level) {
  const below = levelBelow(level.parent, level);
  for (const region of regions) {
    const { update, behaviors } = templateData(region, type, level, below);
    await region.update(update);
    await region.createEmbeddedDocuments('RegionBehavior', behaviors);
    if (type === 'trapdoor') await cutHoles(region, level);
  }
}

/**
 * Cut the trapdoor's shape out of the other surfaces on its floor.
 * @param {RegionDocument} trapdoor The trapdoor region
 * @param {object} level The level whose floor it is in
 * @returns {Promise<void>}
 */
async function cutHoles(trapdoor, level) {
  const holes = trapdoor._source.shapes.map((shape) => ({ ...shape, hole: true }));
  const floors = new Set();
  for (const surface of trapdoor.parent.getSurfaces({ level: level.id })) {
    if (surface.region !== trapdoor && surface.elevation === level.elevation.bottom) floors.add(surface.region);
  }
  for (const floor of floors) await floor.update({ shapes: [...floor._source.shapes, ...holes] });
}

/** Surface templates applied to selected regions, and the trapdoor toggle. */
export class Templates {
  /**
   * Add the region control buttons.
   * @returns {void}
   */
  static register() {
    Hooks.on('getSceneControlButtons', (controls) => {
      if (!game.user.isGM || !controls.regions) return;
      addTool(controls.regions, {
        name: 'levelheadedTemplate',
        title: 'LEVELHEADED.Templates.Title',
        icon: 'fa-solid fa-shapes',
        button: true,
        onChange: () => Templates.#apply()
      });
      addTool(controls.regions, {
        name: 'levelheadedTrapdoor',
        title: 'LEVELHEADED.Templates.Trapdoor.Toggle',
        icon: 'fa-solid fa-door-open',
        button: true,
        onChange: () => Templates.#toggleTrapdoors()
      });
    });
  }

  /**
   * Open Surface Template for the controlled regions.
   * @returns {void}
   */
  static #apply() {
    const regions = canvas.regions.controlled.map((region) => region.document);
    if (!regions.length) return ui.notifications.warn('LEVELHEADED.Templates.NoSelection', { localize: true });
    SurfaceTemplateApp.open(canvas.scene, regions);
  }

  /**
   * Open or close the controlled trapdoors: the lid surface and the level change swap enabled states.
   * @returns {Promise<void>}
   */
  static async #toggleTrapdoors() {
    const trapdoors = canvas.regions.controlled.map((region) => region.document).filter((region) => region.getFlag(MODULE.ID, MODULE.FLAGS.TEMPLATE) === 'trapdoor');
    if (!trapdoors.length) return ui.notifications.warn('LEVELHEADED.Templates.Trapdoor.NoSelection', { localize: true });
    await Promise.all(
      trapdoors.map((trapdoor) =>
        trapdoor.updateEmbeddedDocuments(
          'RegionBehavior',
          trapdoor.behaviors.filter((behavior) => behavior.type === 'defineSurface' || behavior.type === MODULE.BEHAVIOR_TYPE).map((behavior) => ({ _id: behavior.id, disabled: !behavior.disabled }))
        )
      )
    );
  }
}
