import { LevelDoctorApp } from '../apps/level-doctor.mjs';
import { MODULE } from '../constants.mjs';
import { addTool, createFloorSurface, defaultLevel, homeLevel, isMultiLevel, levelsAtElevation, stackedLevels, storable } from '../utils.mjs';

/** @type {string[]} Behavior types that move tokens between the levels of their region. */
const LEVEL_CHANGE_BEHAVIORS = ['changeLevel', MODULE.BEHAVIOR_TYPE];

/**
 * @typedef {object} DoctorIssue
 * @property {string} check Check id, used for the localization keys
 * @property {"error"|"warning"|"info"} severity How serious the issue is
 * @property {object} [data] Format data for the title and hint
 * @property {Function} [fix] One-click repair, when one exists
 */

/**
 * Build an issue whose title and hint come from `LEVELHEADED.Doctor.<check>`.
 * @param {string} check Check id
 * @param {string} severity Issue severity
 * @param {object} [data] Format data
 * @param {Function} [fix] Repair callback
 * @returns {DoctorIssue} The issue
 */
function issue(check, severity, data = {}, fix = null) {
  return { check, severity, data, fix };
}

/**
 * Pairs of levels that sit directly on top of each other.
 * @param {Scene} scene The scene
 * @returns {Array<Array<object>>} [lower, upper] pairs
 */
function adjacentPairs(scene) {
  const stacked = stackedLevels(scene);
  return stacked.slice(1).map((upper, i) => [stacked[i], upper]);
}

/**
 * Elevations where one level ends and another starts.
 * @param {Scene} scene The scene
 * @returns {Set<number>} Boundary elevations
 */
function boundaries(scene) {
  return new Set(adjacentPairs(scene).flatMap(([lower, upper]) => (lower.elevation.top === upper.elevation.bottom ? [upper.elevation.bottom] : [])));
}

/**
 * The enabled behaviors of a region with one of the given types.
 * @param {RegionDocument} region The region
 * @param {string[]} types Behavior types
 * @returns {object[]} Matching behaviors
 */
function activeBehaviors(region, types) {
  return region.behaviors.filter((behavior) => !behavior.disabled && types.includes(behavior.type));
}

/** @type {Array<{id: string, run: function(Scene): (DoctorIssue[]|Promise<DoctorIssue[]>)}>} The checks, in display order. */
const CHECKS = [
  {
    id: 'NoLevels',
    /**
     * Flag scenes with no levels or a single level.
     * @param {Scene} scene The scene
     * @returns {DoctorIssue[]} Issues found
     */
    run(scene) {
      if (scene.levels.size > 1) return [];
      if (scene.levels.size === 1) return [issue('SingleLevel', 'info')];
      return [
        issue('NoLevels', 'error', {}, async () => {
          const id = Scene.metadata.defaultLevelId;
          await scene.createEmbeddedDocuments('Level', [{ _id: id, name: foundry.documents.Level.defaultName({ parent: scene }) }], { keepId: true });
          await scene.update({ initialLevel: id });
        })
      ];
    }
  },
  {
    id: 'Ranges',
    /**
     * Flag gaps and overlaps between stacked levels.
     * @param {Scene} scene The scene
     * @returns {DoctorIssue[]} Issues found
     */
    run(scene) {
      return adjacentPairs(scene).flatMap(([lower, upper]) => {
        const top = lower.elevation.top;
        const bottom = upper.elevation.bottom;
        if (!Number.isFinite(top) || top === bottom) return [];
        const data = { lower: lower.name, upper: upper.name, top, bottom };
        if (top < bottom) return [issue('RangeGap', 'error', data, () => upper.update({ 'elevation.bottom': top }))];
        return [issue('RangeOverlap', 'warning', data, () => lower.update({ 'elevation.top': bottom }))];
      });
    }
  },
  {
    id: 'GridBounds',
    /**
     * Flag level bounds that are not multiples of the grid distance.
     * @param {Scene} scene The scene
     * @returns {DoctorIssue[]} Issues found
     */
    run(scene) {
      const distance = scene.grid.distance;
      const offGrid = (value) => Number.isFinite(value) && !value.toNearest(distance).almostEqual(value);
      return scene.levels
        .filter((level) => offGrid(level.elevation.bottom) || offGrid(level.elevation.top))
        .map((level) =>
          issue('GridBounds', 'warning', { level: level.name, distance }, () => {
            const { bottom, top } = level.elevation;
            return level.update({ 'elevation.bottom': storable(bottom.toNearest(distance)), 'elevation.top': storable(top.toNearest(distance)) });
          })
        );
    }
  },
  {
    id: 'MissingSurface',
    /**
     * Flag level boundaries with no surface.
     * @param {Scene} scene The scene
     * @returns {DoctorIssue[]} Issues found
     */
    run(scene) {
      const surfaces = scene.getSurfaces();
      const top = stackedLevels(scene).at(-1);
      return adjacentPairs(scene).flatMap(([lower, upper]) => {
        const elevation = upper.elevation.bottom;
        if (lower.elevation.top !== elevation || surfaces.some((surface) => surface.elevation === elevation)) return [];
        return [issue('MissingSurface', 'error', { lower: lower.name, upper: upper.name }, () => createFloorSurface(scene, upper, lower, { exposure: upper === top }))];
      });
    }
  },
  {
    id: 'SurfaceLevels',
    /**
     * Flag surfaces and level changers missing levels they act on.
     * @param {Scene} scene The scene
     * @returns {DoctorIssue[]} Issues found
     */
    run(scene) {
      const issues = [];
      const surfaceElevations = new Map();
      for (const surface of scene.getSurfaces()) surfaceElevations.set(surface.region, [...(surfaceElevations.get(surface.region) ?? []), surface.elevation]);
      for (const [region, elevations] of surfaceElevations) {
        if (!region.levels.size || region.restriction.enabled) continue;
        const affected = scene.levels.filter((level) => elevations.some((elevation) => level.elevation.bottom <= elevation && elevation <= level.elevation.top));
        const missing = affected.filter((level) => !region.levels.has(level.id));
        if (!missing.length) continue;
        const names = missing.map((level) => level.name).join(', ');
        issues.push(issue('SurfaceLevels', 'warning', { region: region.name, levels: names }, () => region.update({ levels: [...region._source.levels, ...missing.map((level) => level.id)] })));
      }
      for (const region of scene.regions) {
        if (region.levels.size === 1 && activeBehaviors(region, LEVEL_CHANGE_BEHAVIORS).length) issues.push(issue('ChangeLevelSingle', 'error', { region: region.name }));
      }
      return issues;
    }
  },
  {
    id: 'FlatSurface',
    /**
     * Flag zero-height surface regions on a level boundary.
     * @param {Scene} scene The scene
     * @returns {DoctorIssue[]} Issues found
     */
    run(scene) {
      const edges = boundaries(scene);
      return scene.regions
        .filter((region) => region.elevation.bottom === region.elevation.top && edges.has(region.elevation.bottom) && activeBehaviors(region, ['defineSurface']).length)
        .map((region) =>
          issue('FlatSurface', 'warning', { region: region.name }, async () => {
            const upper = scene.levels.find((level) => level.elevation.bottom === region.elevation.bottom);
            await region.update({ 'elevation.top': storable(upper.elevation.top) });
            const updates = activeBehaviors(region, ['defineSurface']).map((behavior) => ({ _id: behavior.id, 'system.placement': 'bottom' }));
            await region.updateEmbeddedDocuments('RegionBehavior', updates);
          })
        );
    }
  },
  {
    id: 'VisibleLevels',
    /**
     * Flag one-sided Visible Levels.
     * @param {Scene} scene The scene
     * @returns {DoctorIssue[]} Issues found
     */
    run(scene) {
      const issues = [];
      for (const viewer of scene.levels) {
        for (const id of viewer.visibility.levels) {
          const seen = scene.levels.get(id);
          if (!seen || seen.visibility.levels.has(viewer.id)) continue;
          issues.push(issue('VisibleLevels', 'warning', { viewer: viewer.name, seen: seen.name }, () => seen.update({ 'visibility.levels': [...seen._source.visibility.levels, viewer.id] })));
        }
      }
      return issues;
    }
  },
  {
    id: 'NullLevels',
    /**
     * Flag walls, lights and tiles with no level.
     * @param {Scene} scene The scene
     * @returns {DoctorIssue[]} Issues found
     */
    run(scene) {
      if (!isMultiLevel(scene)) return [];
      return ['Wall', 'AmbientLight', 'Tile'].flatMap((documentName) => {
        const documents = scene.getEmbeddedCollection(documentName).filter((document) => !document._source.levels.length);
        if (!documents.length) return [];
        const type = _loc(getDocumentClass(documentName).metadata.labelPlural);
        return [issue('NullLevels', 'warning', { count: documents.length, type }, () => repairNullLevels(scene, documentName))];
      });
    }
  },
  {
    id: 'TeleportDestination',
    /**
     * Flag teleport destinations that are not on exactly one level.
     * @param {Scene} scene The scene
     * @returns {DoctorIssue[]} Issues found
     */
    run(scene) {
      const issues = [];
      for (const region of scene.regions) {
        for (const behavior of activeBehaviors(region, ['teleportToken'])) {
          for (const uuid of behavior.system.destinations) {
            const destination = foundry.utils.fromUuidSync(uuid, { relative: behavior });
            if (destination?.parent?.levels.size > 1 && destination.levels.size !== 1) issues.push(issue('TeleportDestination', 'error', { region: region.name, destination: destination.name }));
          }
        }
      }
      return issues;
    }
  },
  {
    id: 'Roof',
    /**
     * Flag roofs set up with Fade or without Reveal Elevated Surface.
     * @param {Scene} scene The scene
     * @returns {DoctorIssue[]} Issues found
     */
    run(scene) {
      const issues = scene.tiles.filter((tile) => tile.occlusion.modes.has(CONST.OCCLUSION_MODES.FADE)).map((tile) => issue('RoofFade', 'info', { tile: tile.name || tile.id }));
      const top = stackedLevels(scene).at(-1);
      if (!top || !isMultiLevel(scene)) return issues;
      for (const region of scene.regions) {
        if (!region.includedInLevel(top)) continue;
        for (const behavior of activeBehaviors(region, ['defineSurface'])) {
          if (behavior.system.occlusion && !behavior.system.exposure) {
            issues.push(issue('RoofExposure', 'info', { region: region.name }, () => behavior.update({ 'system.exposure': true })));
          }
        }
      }
      return issues;
    }
  },
  {
    id: 'RestrictLight',
    /**
     * Flag Restrict Light set on only the tile or only the surface.
     * @param {Scene} scene The scene
     * @returns {DoctorIssue[]} Issues found
     */
    run(scene) {
      const issues = [];
      const lightSurfaces = scene.getSurfaces({ type: 'light' });
      for (const tile of scene.tiles) {
        const surfaces = lightSurfaces.filter((surface) => surface.elevation === tile.elevation);
        const name = tile.name || tile.id;
        if (tile.restrictions.light && !surfaces.length) issues.push(issue('RestrictLightTile', 'warning', { tile: name }));
        else if (!tile.restrictions.light && surfaces.length && tile.texture.src) {
          issues.push(issue('RestrictLightRegion', 'warning', { tile: name, region: surfaces[0].region.name }, () => tile.update({ 'restrictions.light': true })));
        }
      }
      return issues;
    }
  },
  {
    id: 'LevelImages',
    /**
     * Flag level images that are mis-sized or opaque.
     * @param {Scene} scene The scene
     * @returns {Promise<DoctorIssue[]>} Issues found
     */
    async run(scene) {
      const issues = [];
      const { sceneWidth, sceneHeight } = scene.dimensions;
      const lowest = stackedLevels(scene)[0];
      const levels = scene.levels.filter((level) => level.background.src);
      const textures = await Promise.all(levels.map((level) => foundry.canvas.loadTexture(level.background.src)));
      for (const [i, level] of levels.entries()) {
        const texture = textures[i];
        if (!texture) continue;
        if (texture.width !== sceneWidth || texture.height !== sceneHeight) {
          issues.push(issue('ImageSize', 'warning', { level: level.name, width: texture.width, height: texture.height, sceneWidth, sceneHeight }));
        }
        const showsBelow = level !== lowest && level.visibility.levels.some((id) => scene.levels.get(id)?.elevation.top <= level.elevation.bottom);
        if (showsBelow && isOpaque(texture)) issues.push(issue('ImageOpaque', 'info', { level: level.name }));
      }
      return issues;
    }
  },
  {
    id: 'Foreground',
    /**
     * Flag levels whose art is in Foreground only.
     * @param {Scene} scene The scene
     * @returns {DoctorIssue[]} Issues found
     */
    run(scene) {
      return scene.levels
        .filter((level) => level.foreground.src && !level.background.src)
        .map((level) => issue('Foreground', 'warning', { level: level.name }, () => level.update({ 'background.src': level.foreground.src, 'foreground.src': null })));
    }
  },
  {
    id: 'TokenLevels',
    /**
     * Flag tokens on a missing level or outside their level.
     * @param {Scene} scene The scene
     * @returns {DoctorIssue[]} Issues found
     */
    run(scene) {
      const lost = [];
      const outside = [];
      for (const token of scene.tokens) {
        const level = scene.levels.get(token._source.level);
        if (!level) lost.push(token);
        else if (token.elevation < level.elevation.bottom || token.elevation > level.elevation.top) outside.push(token);
      }
      const issues = [];
      const names = (tokens) => tokens.map((token) => token.name).join(', ');
      if (lost.length) issues.push(issue('TokenMissingLevel', 'error', { count: lost.length, tokens: names(lost) }, () => rehomeTokens(scene, lost)));
      if (outside.length) issues.push(issue('TokenOutside', 'warning', { count: outside.length, tokens: names(outside) }, () => rehomeTokens(scene, outside)));
      return issues;
    }
  }
];

/**
 * Whether a texture has no transparent pixels, sampled at low resolution.
 * @param {PIXI.Texture} texture The loaded texture
 * @returns {boolean} True when every sampled pixel is fully opaque
 */
function isOpaque(texture) {
  const source = texture.baseTexture?.resource?.source;
  if (!source) return false;
  const size = 32;
  const sample = document.createElement('canvas');
  sample.width = sample.height = size;
  const context = sample.getContext('2d');
  context.drawImage(source, 0, 0, size, size);
  try {
    const pixels = context.getImageData(0, 0, size, size).data;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Put placeables with an empty level set on the level they belong to.
 * @param {Scene} scene The scene
 * @param {string} documentName Placeable document name
 * @returns {Promise<Document[]>} The updated documents
 */
export function repairNullLevels(scene, documentName) {
  const updates = [];
  for (const document of scene.getEmbeddedCollection(documentName)) {
    if (document._source.levels.length) continue;
    const level = documentName === 'Wall' ? defaultLevel(scene) : homeLevel(document);
    if (level) updates.push({ _id: document.id, levels: [level.id] });
  }
  return scene.updateEmbeddedDocuments(documentName, updates);
}

/**
 * Move tokens onto the level that contains their elevation, or clamp them into their own level.
 * @param {Scene} scene The scene
 * @param {TokenDocument[]} tokens Tokens to repair
 * @returns {Promise<object>} The result of Scene#moveTokens
 */
function rehomeTokens(scene, tokens) {
  const instructions = {};
  for (const token of tokens) {
    const current = scene.levels.get(token._source.level);
    const level = levelsAtElevation(scene.levels.sorted, token.elevation)[0] ?? current ?? defaultLevel(scene);
    instructions[token.id] = {
      destination: { level: level.id, elevation: level.clampElevation(token.elevation, token.depth) },
      constrainOptions: { ignoreWalls: true, ignoreCost: true }
    };
  }
  return scene.moveTokens(instructions, { animate: false });
}

/**
 * Run every check against a scene.
 * @param {Scene} scene The scene
 * @returns {Promise<DoctorIssue[]>} All issues found
 */
export async function runChecks(scene) {
  const issues = [];
  for (const check of CHECKS) {
    if (!scene.levels.size && check.id !== 'NoLevels') continue;
    issues.push(...(await check.run(scene)));
  }
  return issues;
}

/** Registers the Level Doctor entry points. */
export class LevelDoctor {
  /**
   * Add the scene control button and the Scene Directory context entry.
   * @returns {void}
   */
  static register() {
    Hooks.on('getSceneControlButtons', (controls) => {
      if (!game.user.isGM || !controls.tokens) return;
      addTool(controls.tokens, {
        name: 'levelheadedDoctor',
        title: 'LEVELHEADED.Doctor.Title',
        icon: 'fa-solid fa-stethoscope',
        button: true,
        onChange: () => canvas.scene && LevelDoctorApp.open(canvas.scene)
      });
    });
    Hooks.on('getSceneContextOptions', (_app, options) => {
      options.push({
        label: 'LEVELHEADED.Doctor.Title',
        icon: 'fa-solid fa-stethoscope',
        visible: () => game.user.isGM,
        onClick: (_event, li) => LevelDoctorApp.open(game.scenes.get(li.dataset.entryId ?? li.dataset.sceneId))
      });
    });
  }
}
