import { BulkToolsApp } from '../apps/bulk-tools.mjs';
import { LEVELED_DOCUMENTS, addTool, homeLevel } from '../utils.mjs';

/** @type {string[]} Scene control sets whose layer holds leveled placeables. */
const CONTROLS = ['walls', 'lighting', 'sounds', 'tiles', 'drawings', 'notes', 'regions'];

/**
 * Shift a placeable's elevation data by a delta, for numeric and ranged elevations alike.
 * @param {object} data Placeable source data, mutated in place
 * @param {number} delta Elevation change
 * @returns {object} The data
 */
function shiftElevation(data, delta) {
  if (!delta) return data;
  if (typeof data.elevation === 'number') data.elevation += delta;
  else if (data.elevation) {
    if (Number.isFinite(data.elevation.bottom)) data.elevation.bottom += delta;
    if (Number.isFinite(data.elevation.top)) data.elevation.top += delta;
  }
  return data;
}

/**
 * The elevation change that carries a placeable from its own level to the target level.
 * @param {foundry.abstract.Document} document The placeable
 * @param {object} target Target level
 * @returns {number} The delta, zero for placeables without elevation
 */
function levelDelta(document, target) {
  if (document.documentName === 'Wall') return 0;
  const home = homeLevel(document);
  return home ? target.elevation.base - home.elevation.base : 0;
}

/**
 * Source data for copies of placeables on another level.
 * @param {foundry.abstract.Document[]} documents Placeables to copy
 * @param {object} target Target level
 * @returns {object[]} Creation data
 */
export function copiesOnLevel(documents, target) {
  return documents.map((document) => {
    const data = document.toObject();
    delete data._id;
    data.levels = [target.id];
    return shiftElevation(data, levelDelta(document, target));
  });
}

/**
 * Update data that moves placeables to another level.
 * @param {foundry.abstract.Document[]} documents Placeables to move
 * @param {object} target Target level
 * @returns {object[]} Update data
 */
export function movesToLevel(documents, target) {
  return documents.map((document) => {
    const data = { _id: document.id, levels: [target.id], elevation: foundry.utils.deepClone(document._source.elevation) };
    if (data.elevation === undefined) delete data.elevation;
    return shiftElevation(data, levelDelta(document, target));
  });
}

/**
 * Update data that rewrites the level sets of placeables.
 * @param {foundry.abstract.Document[]} documents Placeables to edit
 * @param {"assign"|"include"|"exclude"} operation How the chosen levels combine with each current set
 * @param {string[]} levelIds Chosen level ids, empty meaning all levels
 * @returns {object[]} Update data
 */
export function levelSetUpdates(documents, operation, levelIds) {
  return documents.map((document) => {
    const current = document._source.levels;
    let levels = levelIds;
    if (operation === 'include') levels = levelIds.length && current.length ? [...new Set([...current, ...levelIds])] : [];
    else if (operation === 'exclude') levels = current.filter((id) => !levelIds.includes(id));
    return { _id: document.id, levels };
  });
}

/** Registers the Bulk Level Tools entry points. */
export class BulkTools {
  /**
   * Add the scene control buttons and keep the window in sync with the selection.
   * @returns {void}
   */
  static register() {
    Hooks.on('getSceneControlButtons', (controls) => {
      if (!game.user.isGM) return;
      for (const name of CONTROLS) {
        const control = controls[name];
        if (!control) continue;
        addTool(control, {
          name: 'levelheadedBulk',
          title: 'LEVELHEADED.Bulk.Title',
          icon: 'fa-solid fa-boxes-stacked',
          button: true,
          onChange: () => BulkToolsApp.open()
        });
      }
    });
    const refresh = foundry.utils.debounce(() => BulkToolsApp.instance?.render(), 100);
    for (const documentName of LEVELED_DOCUMENTS) Hooks.on(`control${documentName}`, refresh);
    Hooks.on('canvasReady', refresh);
  }
}
