/** @type {string[]} Placeable document names that carry a `levels` set. */
export const LEVELED_DOCUMENTS = ['Wall', 'AmbientLight', 'AmbientSound', 'Tile', 'Drawing', 'Note', 'Region'];

/**
 * Whether a scene has more than one level, which is when level tooling matters.
 * @param {Scene|null|undefined} scene The scene
 * @returns {boolean} True when the scene has two or more levels
 */
export function isMultiLevel(scene) {
  return (scene?.levels?.size ?? 0) > 1;
}

/**
 * The levels whose half-open range [bottom, top) contains an elevation.
 * @param {object[]} levels Levels with prepared `elevation.bottom` / `elevation.top`
 * @param {number} elevation The elevation to test
 * @returns {object[]} Matching levels, in the given order
 */
export function levelsAtElevation(levels, elevation) {
  const matches = [];
  for (const level of levels) if (level.elevation.bottom <= elevation && elevation < level.elevation.top) matches.push(level);
  return matches;
}

/**
 * The elevation a token lands at when moved to another level.
 * @param {number} elevation The token's current elevation
 * @param {object} origin The level the token leaves, if any
 * @param {object} target The level the token arrives on
 * @param {string} mode "base", "relative" or "absolute"
 * @returns {number} The landing elevation
 */
export function landingElevation(elevation, origin, target, mode) {
  if (mode === 'absolute') return elevation;
  if (mode === 'relative' && origin) return target.elevation.base + (elevation - origin.elevation.base);
  return target.elevation.base;
}

/**
 * The default level for placeables: the viewed level, else the initial one.
 * @param {Scene} scene The scene
 * @returns {object|null} The level, or null for a scene without levels
 */
export function defaultLevel(scene) {
  if (scene.isView && canvas.level?.parent === scene) return canvas.level;
  return scene.initialLevel ?? scene.levels.sorted[0] ?? null;
}

/**
 * The level a placeable belongs on, from its elevation when it has one.
 * @param {foundry.abstract.Document} document A placeable document
 * @returns {object|null} The level, or null for a scene without levels
 */
export function homeLevel(document) {
  const scene = document.parent;
  const elevation = typeof document.elevation === 'number' ? document.elevation : document.elevation?.bottom;
  if (Number.isFinite(elevation)) return levelsAtElevation(scene.levels.sorted, elevation)[0] ?? defaultLevel(scene);
  return defaultLevel(scene);
}

/**
 * Move tokens to a level, setting level and elevation together in one movement.
 * @param {Scene} scene The scene holding the tokens
 * @param {TokenDocument[]} tokens Tokens to move
 * @param {object} level Destination level
 * @param {string} mode "base", "relative" or "absolute"
 * @returns {Promise<object>} The result of Scene#moveTokens
 */
export function moveTokensToLevel(scene, tokens, level, mode) {
  const instructions = {};
  for (const token of tokens) {
    if (token._source.level === level.id) continue;
    const origin = scene.levels.get(token._source.level);
    instructions[token.id] = { destination: { level: level.id, elevation: landingElevation(token.elevation, origin, level, mode) } };
  }
  return scene.moveTokens(instructions, { pan: { duration: 0 }, animate: false });
}

/**
 * A finite elevation, or null for the unbounded ±Infinity that elevation fields store as null.
 * @param {number} elevation The elevation
 * @returns {number|null} The storable value
 */
export function storable(elevation) {
  return Number.isFinite(elevation) ? elevation : null;
}

/**
 * Levels with a finite bottom, ordered by bottom elevation.
 * @param {Scene} scene The scene
 * @returns {object[]} Stacked levels, lowest first
 */
export function stackedLevels(scene) {
  return scene.levels.filter((level) => Number.isFinite(level.elevation.bottom)).sort((a, b) => a.elevation.bottom - b.elevation.bottom);
}

/**
 * The level directly below another: the highest level whose top is at or under its bottom.
 * @param {Scene} scene The scene
 * @param {object} level The upper level
 * @returns {object|null} The level below, or null
 */
export function levelBelow(scene, level) {
  return (
    stackedLevels(scene)
      .filter((other) => other !== level && other.elevation.top <= level.elevation.bottom)
      .at(-1) ?? null
  );
}

/**
 * Region data for a surface at the bottom of a level, included in that level and the one below it.
 * @param {object} upper The level whose floor this is
 * @param {object|null} lower The level below, if any
 * @param {object} options Region options
 * @param {string} options.name Region name
 * @param {object[]} options.shapes Region shapes
 * @param {object[]} options.behaviors defineSurface system data, one behavior each
 * @param {object} [options.flags] Region flags
 * @returns {object} Region creation data
 */
export function floorRegionData(upper, lower, { name, shapes, behaviors, flags = {} }) {
  return {
    name,
    shapes,
    flags,
    elevation: { bottom: storable(upper.elevation.bottom), top: storable(upper.elevation.top) },
    levels: lower ? [lower.id, upper.id] : [upper.id],
    behaviors: behaviors.map(({ name: behaviorName, ...system }) => ({ type: 'defineSurface', name: behaviorName, system: { placement: 'bottom', ...system } }))
  };
}

/**
 * Region data for a scene-wide culling floor surface at the bottom of a level.
 * @param {Scene} scene The scene
 * @param {object} upper The level whose floor this is
 * @param {object|null} lower The level below
 * @param {object} [system] Extra defineSurface data, such as exposure or culling
 * @returns {object} Region creation data
 */
export function sceneFloorData(scene, upper, lower, system = {}) {
  const { sceneX, sceneY, sceneWidth, sceneHeight } = scene.dimensions;
  return floorRegionData(upper, lower, {
    name: _loc('LEVELHEADED.Doctor.MissingSurface.RegionName', { level: upper.name }),
    shapes: [{ type: 'rectangle', x: sceneX, y: sceneY, width: sceneWidth, height: sceneHeight }],
    behaviors: [{ culling: true, ...system }]
  });
}

/**
 * Create a scene-wide culling floor surface for a level, shared by Level Doctor and level creation.
 * @param {Scene} scene The scene
 * @param {object} upper The level whose floor this is
 * @param {object|null} lower The level below
 * @param {object} [system] Extra defineSurface data, such as exposure or culling
 * @returns {Promise<RegionDocument[]>} The created region
 */
export function createFloorSurface(scene, upper, lower, system = {}) {
  return scene.createEmbeddedDocuments('Region', [sceneFloorData(scene, upper, lower, system)]);
}

/**
 * Add a tool to a scene control, keeping core's destructive "Clear" tool last.
 * @param {object} control The scene control
 * @param {object} tool The tool, keyed by its name
 * @returns {void}
 */
export function addTool(control, tool) {
  control.tools[tool.name] = { order: Object.keys(control.tools).length + 1, ...tool };
  const { clear } = control.tools;
  if (clear) clear.order = Math.max(...Object.values(control.tools).map((other) => other.order ?? 0)) + 1;
}

/**
 * Stack each source scene's levels above the previous one, starting at an elevation.
 * @param {{bottom: number, top: number}[][]} sources Each source scene's level ranges, sorted by bottom
 * @param {number} start Elevation the first source starts at
 * @param {number} height Height for levels without a finite top
 * @returns {{offset: number, ranges: {bottom: number, top: number}[]}[]} Each source's shift and ranges
 */
export function stackLevels(sources, start, height) {
  let floor = start;
  return sources.map((levels) => {
    if (levels.length === 1) {
      const range = { bottom: floor, top: floor + height };
      const base = Number.isFinite(levels[0].bottom) ? levels[0].bottom : 0;
      floor = range.top;
      return { offset: range.bottom - base, ranges: [range] };
    }
    const finite = levels.map((level) => level.bottom).filter(Number.isFinite);
    const base = finite.length ? Math.min(...finite) : 0;
    const offset = floor - base;
    const ranges = levels.map((level) => {
      const bottom = (Number.isFinite(level.bottom) ? level.bottom : base) + offset;
      const top = Number.isFinite(level.top) ? level.top + offset : bottom + height;
      return { bottom, top: Math.max(top, bottom + 1) };
    });
    floor = Math.max(floor, ...ranges.map((range) => range.top));
    return { offset, ranges };
  });
}
