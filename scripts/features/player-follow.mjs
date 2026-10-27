import { MODULE } from '../constants.mjs';
import { isMultiLevel } from '../utils.mjs';

/** Keeps each player's view on their own token's level, and lets the GM pull one user to a level. */
export class PlayerFollow {
  /**
   * Wire the movement and players list hooks.
   * @returns {void}
   */
  static register() {
    Hooks.on('moveToken', PlayerFollow.#onMoveToken);
    Hooks.on('getUserContextOptions', PlayerFollow.#onUserContextOptions);
  }

  /**
   * Whether this player's view follows a token: their character, or their only token.
   * @param {TokenDocument} token The token
   * @returns {boolean} True when the view should follow it
   */
  static #isFollowed(token) {
    if (game.user.isGM || !token.isOwner) return false;
    if (game.user.character && token.actorId === game.user.character.id) return true;
    return token.parent.tokens.filter((other) => other.isOwner).length === 1;
  }

  /**
   * Switch this player's view after their followed token finishes a level change made by anyone.
   * @param {TokenDocument} token The moved token
   * @param {object} movement The movement operation
   * @returns {Promise<void>}
   */
  static async #onMoveToken(token, movement) {
    if (!game.settings.get(MODULE.ID, MODULE.SETTINGS.PLAYER_VIEW_FOLLOWS) || movement.pending.waypoints.length) return;
    if (movement.origin.level === movement.destination.level || !token.parent.isView) return;
    if (!PlayerFollow.#isFollowed(token)) return;
    const level = token._source.level;
    if (canvas.level?.id === level || canvas.loading) return;
    if (token.rendered) await token.object.movementAnimationPromise;
    if (canvas.level?.id !== level) await token.parent.view({ level, controlledTokens: [token.id] });
  }

  /**
   * Add "Pull To Level" to the player list, sending a user to the GM's viewed level.
   * @param {foundry.applications.ui.Players} _app The players list
   * @param {object[]} options Context menu entries
   * @returns {void}
   */
  static #onUserContextOptions(_app, options) {
    const pullToScene = options.findIndex((option) => option.label === 'PLAYERS.PullToScene');
    options.splice(pullToScene + 1 || options.length, 0, {
      label: 'LEVELHEADED.PullToLevel.Title',
      icon: 'fa-solid fa-layer-group',
      visible: (li) => {
        const user = game.users.get(li.dataset.userId);
        return game.user.isGM && !!user?.active && !user.isSelf && isMultiLevel(canvas.scene);
      },
      onClick: (_event, li) => canvas.scene.pullUsers([game.users.get(li.dataset.userId)], { level: canvas.level.id })
    });
  }
}
