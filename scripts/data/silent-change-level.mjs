import { MODULE } from '../constants.mjs';

const fields = foundry.data.fields;

/**
 * Destination choices: the relative options, then the viewed scene's levels from the top down.
 * @returns {Object<string, string>} Value to label
 */
function destinationChoices() {
  const choices = {
    other: _loc('LEVELHEADED.Behavior.SilentChangeLevel.Destination.Other'),
    above: _loc('LEVELHEADED.Behavior.SilentChangeLevel.Destination.Above'),
    below: _loc('LEVELHEADED.Behavior.SilentChangeLevel.Destination.Below')
  };
  for (const level of canvas.scene?.levels.reverseSorted ?? []) choices[level.id] = level.name;
  return choices;
}

/** A Change Level variant that moves tokens without a prompt, with a landing offset and camera follow. */
export class SilentChangeLevelBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  /** @override */
  static LOCALIZATION_PREFIXES = ['LEVELHEADED.Behavior.SilentChangeLevel', 'BEHAVIOR.TYPES.base'];

  /** @override */
  static defineSchema() {
    const destination = new fields.StringField({ required: true, blank: false, initial: 'other' });
    destination.toInput = function (config = {}) {
      config.choices ??= destinationChoices();
      return Object.getPrototypeOf(this).toInput.call(this, config);
    };
    return {
      destination,
      offsetX: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
      offsetY: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
      cameraFollow: new fields.BooleanField({ initial: true }),
      movementActions: new fields.SetField(
        new fields.StringField({
          required: true,
          blank: false,
          nullable: false,
          initial: undefined,
          choices: () => {
            const actions = { ...CONFIG.Token.movement.actions };
            delete actions.displace;
            return actions;
          }
        })
      )
    };
  }

  /**
   * Resolve the level a token in this region moves to.
   * @param {TokenDocument} token The token
   * @returns {object|null} The destination level, or null when there is none
   */
  resolveDestination(token) {
    const scene = token.parent;
    const current = scene.levels.get(token._source.level);
    const ids = this.region._source.levels;
    const pool = (ids.length ? ids.map((id) => scene.levels.get(id)).filter(Boolean) : scene.levels.contents).filter((level) => level !== current);
    const base = current?.elevation.base ?? token.elevation;
    switch (this.destination) {
      case 'other':
        return pool.length === 1 ? pool[0] : null;
      case 'above':
        return pool.filter((level) => level.elevation.base > base).sort((a, b) => a.elevation.base - b.elevation.base)[0] ?? null;
      case 'below':
        return pool.filter((level) => level.elevation.base < base).sort((a, b) => b.elevation.base - a.elevation.base)[0] ?? null;
      default:
        return pool.find((level) => level.id === this.destination) ?? null;
    }
  }

  /**
   * Move a token that entered the region to the destination level, without a prompt.
   * @param {object} event The region event
   * @this {SilentChangeLevelBehaviorType}
   * @returns {Promise<void>}
   */
  static async #onTokenMoveIn(event) {
    if (!event.user.isSelf) return;
    const { token, movement } = event.data;
    const action = movement.passed.waypoints.at(-1).action;
    if (action === 'displace' || (this.movementActions.size && !this.movementActions.has(action))) return;
    const level = this.resolveDestination(token);
    if (!level) return;
    const scene = token.parent;
    const originLevelId = token._source.level;
    const followView = this.cameraFollow && scene.isView && canvas.level?.id === originLevelId;
    token.pauseMovement();
    if (token.rendered && token.object.movementAnimationPromise) await game.raceWithWindowHidden(token.object.movementAnimationPromise);
    if (!token.regions.has(this.region)) return;
    const { x, y, width, height, shape } = token._source;
    let landing = { x: x + this.offsetX * scene.grid.sizeX, y: y + this.offsetY * scene.grid.sizeY };
    if (!scene.grid.isGridless) landing = token.getSnappedPosition({ ...landing, width, height, shape });
    await token.move(
      { x: Math.round(landing.x), y: Math.round(landing.y), elevation: level.elevation.base, level: level.id, action: token.movementAction },
      { animate: false, constrainOptions: { ignoreWalls: true, ignoreCost: true } }
    );
    if (!followView) return;
    await scene.view({ level: level.id, controlledTokens: [token.id] });
    if (token.object) await canvas.animatePan(token.object.center);
  }

  /** @override */
  static events = { [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: this.#onTokenMoveIn };
}

/**
 * Register the behavior type, its label and icon.
 * @returns {void}
 */
export function registerSilentChangeLevel() {
  CONFIG.RegionBehavior.dataModels[MODULE.BEHAVIOR_TYPE] = SilentChangeLevelBehaviorType;
  CONFIG.RegionBehavior.typeLabels[MODULE.BEHAVIOR_TYPE] = `TYPES.RegionBehavior.${MODULE.BEHAVIOR_TYPE}`;
  CONFIG.RegionBehavior.typeIcons[MODULE.BEHAVIOR_TYPE] = 'fa-solid fa-stairs';
}
