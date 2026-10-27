import { SceneMergeApp } from '../apps/scene-merge.mjs';
import { LEVELED_DOCUMENTS, sceneFloorData, stackLevels, storable } from '../utils.mjs';

/** @type {string[]} Embedded placeable documents copied from a merged scene. */
const PLACEABLES = [...LEVELED_DOCUMENTS, 'Token'];

/**
 * Whether two scenes share dimensions and grid, so merged content lines up.
 * @param {Scene} a One scene
 * @param {Scene} b The other
 * @returns {boolean} True when they match exactly
 */
export function sameDimensions(a, b) {
  return a.width === b.width && a.height === b.height && a.padding === b.padding && a.grid.size === b.grid.size && a.grid.type === b.grid.type;
}

/**
 * Copy a scene's placeables onto new levels, mapping level ids and shifting elevations.
 * @param {Scene} source The merged scene
 * @param {Map<string, object>} mapping Source level id to its new level's data
 * @param {number} offset Elevation shift
 * @returns {Object<string, object[]>} Creation data per document name
 */
function placeableData(source, mapping, offset) {
  const created = [...mapping.values()];
  const ids = created.map((level) => level._id);
  const span = { bottom: Math.min(...created.map((level) => level.elevation.bottom)), top: Math.max(...created.map((level) => level.elevation.top)) };
  const data = {};
  for (const documentName of PLACEABLES) {
    const collection = source.getEmbeddedCollection(documentName);
    data[documentName] = collection.map((document) => {
      const copy = document.toObject();
      delete copy._id;
      if (documentName === 'Token') {
        copy.level = mapping.get(copy.level)?._id ?? ids[0];
        copy.elevation += offset;
        return copy;
      }
      copy.levels = copy.levels.length ? copy.levels.map((id) => mapping.get(id)?._id).filter(Boolean) : ids;
      if (documentName === 'Region') {
        copy.elevation.bottom = Number.isFinite(copy.elevation.bottom) ? copy.elevation.bottom + offset : span.bottom;
        copy.elevation.top = Number.isFinite(copy.elevation.top) ? copy.elevation.top + offset : span.top;
      } else if (typeof copy.elevation === 'number') copy.elevation += offset;
      return copy;
    });
  }
  return data;
}

/**
 * Merge scenes into a target as new levels stacked above its top, copying every placeable.
 * @param {Scene} target The scene that receives the levels
 * @param {Scene[]} sources Scenes to merge, bottom first
 * @param {object} options Merge options
 * @param {number} options.height Height for levels without a finite top
 * @param {boolean} options.surfaces Add a floor surface under each new level
 * @param {boolean} options.visible Let each level see the levels directly above and below it
 * @param {boolean} options.culling Cull tokens on the added floor surfaces
 * @returns {Promise<void>}
 */
export async function mergeScenes(target, sources, { height, surfaces, visible, culling }) {
  const existing = target.levels.contents.sort((a, b) => a.elevation.bottom - b.elevation.bottom);
  const top = existing.at(-1);
  if (top && !Number.isFinite(top.elevation.top)) await top.update({ 'elevation.top': (Number.isFinite(top.elevation.bottom) ? top.elevation.bottom : 0) + height });
  const start = top ? top.elevation.top : 0;
  const sourceLevels = sources.map((source) => source.levels.contents.sort((a, b) => a.elevation.bottom - b.elevation.bottom));
  const stacks = stackLevels(
    sourceLevels.map((levels) => levels.map((level) => level.elevation)),
    start,
    height
  );
  let sort = Math.max(0, ...target.levels.map((level) => level.sort)) + 1;
  const created = [];
  const placeables = Object.fromEntries(PLACEABLES.map((documentName) => [documentName, []]));
  sources.forEach((source, i) => {
    const mapping = new Map();
    sourceLevels[i].forEach((level, j) => {
      const { _id, sort: _sort, visibility: _visibility, elevation: _elevation, name, ...look } = level.toObject();
      const range = stacks[i].ranges[j];
      const data = {
        ...look,
        _id: foundry.utils.randomID(),
        name: sourceLevels[i].length === 1 ? source.name : `${source.name}: ${name}`,
        elevation: { bottom: storable(range.bottom), top: storable(range.top) },
        sort: sort++,
        visibility: { levels: [] }
      };
      mapping.set(level.id, data);
      created.push(data);
    });
    for (const [documentName, documents] of Object.entries(placeableData(source, mapping, stacks[i].offset))) placeables[documentName].push(...documents);
  });
  const stack = [
    ...(top ? [{ id: top.id, name: top.name, elevation: { bottom: top.elevation.bottom, top: start } }] : []),
    ...created.map((level) => ({ id: level._id, name: level.name, elevation: level.elevation }))
  ];
  if (visible) {
    created.forEach((level) => {
      const index = stack.findIndex((entry) => entry.id === level._id);
      level.visibility.levels = [stack[index - 1]?.id, stack[index + 1]?.id].filter(Boolean);
    });
  }
  if (surfaces) {
    for (let i = 1; i < stack.length; i++) placeables.Region.push(sceneFloorData(target, stack[i], stack[i - 1], { exposure: i === stack.length - 1, culling }));
  }
  await target.createEmbeddedDocuments('Level', created, { keepId: true, levelheadedStack: true });
  await Promise.all([
    visible && top ? top.update({ 'visibility.levels': [...top._source.visibility.levels, created[0]._id] }) : null,
    ...Object.entries(placeables).map(([documentName, documents]) => documents.length && target.createEmbeddedDocuments(documentName, documents))
  ]);
}

/** Merge other scenes into a scene as levels, from the Scene Directory and navigation context menus. */
export class SceneMerge {
  /**
   * Add the context menu entry.
   * @returns {void}
   */
  static register() {
    Hooks.on('getSceneContextOptions', (_app, options) => {
      options.push({
        label: 'LEVELHEADED.Merge.Title',
        icon: 'fa-solid fa-layer-group',
        visible: () => game.user.isGM && game.scenes.size > 1,
        onClick: (_event, li) => SceneMergeApp.open(game.scenes.get(li.dataset.entryId ?? li.dataset.sceneId))
      });
    });
  }
}
