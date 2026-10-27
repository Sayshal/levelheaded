import { MODULE } from '../constants.mjs';
import { GMView } from './gm-view.mjs';

/**
 * Surfaces occluded at a point, lowest first. Copy of core's private #getOccludedSurfaces.
 * @param {{x: number, y: number}} point The tested point
 * @param {number} elevation The point's elevation
 * @param {object[]} [surfaces] Occludable surfaces, ascending by elevation
 * @yields {object} Occluded surfaces
 */
function* occludedSurfacesAt(point, elevation, surfaces) {
  let lowest;
  for (const surface of surfaces ?? canvas.scene.getSurfaces({ level: canvas.level.id, occlusion: true })) {
    if (surface.elevation <= elevation) continue;
    const region = surface.region;
    const enveloped = region.elevation.bottom <= elevation;
    if (!enveloped && surface.elevation > lowest?.elevation) continue;
    const ceiling = surface.elevation > region.elevation.bottom;
    if (!((enveloped || !ceiling) && region.polygonTree.testPoint(point))) continue;
    lowest ??= surface;
    yield surface;
  }
}

/**
 * The elevation under the mouse: the hovered placeable's, else the viewed level's base.
 * @returns {number} The elevation
 */
function mouseElevation() {
  const hovered = canvas.activeLayer?.hover;
  if (!hovered) return canvas.level.elevation.base;
  const { Drawing, Tile, Token, Region } = foundry.canvas.placeables;
  if (hovered instanceof Token || hovered instanceof Tile) return hovered.mesh?.elevation ?? canvas.level.elevation.base;
  if (hovered instanceof Drawing) return hovered.shape?.elevation ?? canvas.level.elevation.base;
  if (hovered instanceof Region) return hovered.document.elevation.top;
  return hovered.document.schema.has('elevation') ? hovered.document.elevation : canvas.level.elevation.base;
}

/** Which tokens cause occlusion, per role; a hover delay for surfaces and tiles; and the surface half of hide-above. */
export class Occlusion {
  /** @type {Set<string>} Keys of surfaces hovered for longer than the delay. */
  static #hovered = new Set();

  /** @type {Map<string, number>} Keys of hovered surfaces still waiting out the delay, to their timeout. */
  static #pending = new Map();

  /**
   * Install the two overrides and the canvas hooks.
   * @returns {void}
   */
  static register() {
    Occlusion.#overrideOccludableTokens();
    Occlusion.#overrideOccludedSurfaces();
    Hooks.once('ready', () => (CONFIG.Canvas.hoverFade.delay = game.settings.get(MODULE.ID, MODULE.SETTINGS.TILE_FADE_DELAY)));
    Hooks.on('canvasReady', () => {
      Occlusion.applyMode();
      canvas.registerMouseMoveHandler(Occlusion.#onMouseMove, foundry.canvas.Canvas.MOUSE_MOVE_HANDLER_PRIORITIES.LOW, Occlusion);
    });
    Hooks.on('canvasTearDown', () => Occlusion.#clearHover());
  }

  /**
   * The token groups that cause occlusion for this user.
   * @returns {Set<string>} Group names
   */
  static get groups() {
    return game.settings.get(MODULE.ID, game.user.isGM ? MODULE.SETTINGS.ROOF_FADE_TOKENS_GM : MODULE.SETTINGS.ROOF_FADE_TOKENS_PLAYER);
  }

  /**
   * Set core's occlusion mode bits to match the groups, so core refreshes occlusion on the right events.
   * @returns {void}
   */
  static applyMode() {
    if (!canvas.ready) return;
    const M = CONST.TOKEN_OCCLUSION_MODES;
    canvas.tokens.occlusionMode = [...Occlusion.groups].reduce((mode, group) => mode | M[group.toUpperCase()], 0);
  }

  /**
   * Replace core's mutually exclusive occlusion modes with a union of the chosen groups.
   * @returns {void}
   */
  static #overrideOccludableTokens() {
    const TokenLayer = foundry.canvas.layers.TokenLayer;
    TokenLayer.prototype._getOccludableTokens = function () {
      const groups = Occlusion.groups;
      const tokens = new Set();
      const visible = () => this.placeables.filter((token) => token.visible && token.interactive);
      if (groups.has('highlighted') && this.highlightObjects) visible().forEach((token) => tokens.add(token));
      if (groups.has('visible') && canvas.effects.visionSources.some((source) => source.active)) {
        for (const token of visible()) {
          if (token.controlled || token.vision?.active || token.document.disposition !== CONST.TOKEN_DISPOSITIONS.SECRET) tokens.add(token);
        }
      }
      if (groups.has('hovered') && this.hover) tokens.add(this.hover);
      if (groups.has('controlled')) this.controlled.forEach((token) => tokens.add(token));
      if (groups.has('owned')) this.ownedTokens.filter((token) => !token.document.hidden).forEach((token) => tokens.add(token));
      return (this._levelheadedOccludable = Array.from(tokens));
    };
  }

  /**
   * Replace core's surface occlusion pass so hide-above acts like the highlight key and hover uses the fade delay.
   * @returns {void}
   */
  static #overrideOccludedSurfaces() {
    const CanvasOcclusionMask = foundry.canvas.layers.CanvasOcclusionMask;
    CanvasOcclusionMask.prototype._updateOccludedSurfaces = function (flags) {
      const occluded = this.occludedSurfaces;
      const exposed = canvas.scene.getSurfaces({ level: canvas.level.id, exposure: true }).length;
      const prior = !(flags.initializeLightSources && flags.initializeVision) && exposed ? occluded.map((surface) => surface.key) : undefined;
      occluded.clear();
      const occludable = canvas.scene.getSurfaces({ level: canvas.level.id, occlusion: true });
      if (occludable.length) {
        if (!canvas.tokens.active || canvas.tokens.highlightObjects || GMView.hideAbove) {
          for (let i = occludable.length - 1; i >= 0; i--) {
            if (occludable[i].elevation < canvas.level.elevation.top) break;
            occluded.add(occludable[i]);
          }
        }
        for (const surface of occludable) if (Occlusion.#hovered.has(surface.key)) occluded.add(surface);
        const candidates = [];
        for (const token of canvas.tokens._levelheadedOccludable ?? []) {
          const tokenElevation = token.document.elevation;
          let bounds;
          for (let i = occludable.length - 1; i >= 0; i--) {
            const surface = occludable[i];
            if (tokenElevation >= surface.elevation) break;
            bounds ??= token.bounds;
            if (bounds.intersects(surface.region.bounds)) candidates.push(surface);
          }
          if (!candidates.length) continue;
          for (const point of token.document.getOcclusionTestPoints()) {
            for (const surface of occludedSurfacesAt(point, tokenElevation, candidates)) occluded.add(surface);
          }
          candidates.length = 0;
        }
      }
      if (prior?.equals(occluded.map((surface) => surface.key)) === false) {
        flags.initializeLightSources = flags.refreshLighting = flags.initializeVision = flags.refreshVision = true;
      }
    };
  }

  /**
   * Track hovered surfaces, adding each only after it has been hovered for the delay.
   * @param {PIXI.Point} position The mouse position
   * @returns {void}
   */
  static #onMouseMove(position) {
    const keys = new Set();
    if (canvas.mousePositionVisible || canvas.mousePositionExplored) {
      for (const surface of occludedSurfacesAt(position, mouseElevation())) keys.add(surface.key);
    }
    let changed = false;
    for (const key of Occlusion.#hovered) {
      if (keys.has(key)) continue;
      Occlusion.#hovered.delete(key);
      changed = true;
    }
    for (const [key, timeout] of Occlusion.#pending) {
      if (keys.has(key)) continue;
      clearTimeout(timeout);
      Occlusion.#pending.delete(key);
    }
    let delay;
    for (const key of keys) {
      if (Occlusion.#hovered.has(key) || Occlusion.#pending.has(key)) continue;
      delay ??= game.settings.get(MODULE.ID, MODULE.SETTINGS.ROOF_FADE_DELAY);
      if (!delay) {
        Occlusion.#hovered.add(key);
        changed = true;
        continue;
      }
      const timeout = setTimeout(() => {
        Occlusion.#pending.delete(key);
        Occlusion.#hovered.add(key);
        canvas.perception.update({ refreshOccludedSurfaces: true });
      }, delay);
      Occlusion.#pending.set(key, timeout);
    }
    if (changed) canvas.perception.update({ refreshOccludedSurfaces: true });
  }

  /**
   * Forget hover state when the canvas is torn down.
   * @returns {void}
   */
  static #clearHover() {
    for (const timeout of Occlusion.#pending.values()) clearTimeout(timeout);
    Occlusion.#pending.clear();
    Occlusion.#hovered.clear();
  }
}
