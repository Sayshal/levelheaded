import { MODULE } from '../constants.mjs';

/** @type {number} Label opacity for tokens on other levels in "dim" mode. */
const DIM_ALPHA = 0.5;

/** Absolute elevation readout, and dimmed or hidden labels for tokens on other levels. */
export class ElevationDisplay {
  /**
   * Wrap the tooltip text and wire the token refresh hook.
   * @returns {void}
   */
  static register() {
    ElevationDisplay.#overrideTooltipText();
    Hooks.on('refreshToken', ElevationDisplay.#onRefreshToken);
  }

  /**
   * Show the token's absolute elevation in its tooltip when the readout is set to absolute.
   * @returns {void}
   */
  static #overrideTooltipText() {
    const Token = foundry.canvas.placeables.Token;
    const getTooltipText = Token.prototype._getTooltipText;
    Token.prototype._getTooltipText = function () {
      if (game.settings.get(MODULE.ID, MODULE.SETTINGS.ELEVATION_READOUT) !== 'absolute') return getTooltipText.call(this);
      const elevation = this.document.elevation.toNearest(0.01);
      if (!Number.isFinite(elevation) || elevation === 0) return '';
      return `${elevation} ${canvas.grid.units}`.trim();
    };
  }

  /**
   * Dim or hide labels of tokens on other levels after core refreshes their visibility.
   * @param {foundry.canvas.placeables.Token} token The refreshed token
   * @param {object} flags The applied render flags
   * @returns {void}
   */
  static #onRefreshToken(token, flags) {
    if (!canvas.level || !(flags.refreshState || flags.refreshBars)) return;
    const mode = game.settings.get(MODULE.ID, MODULE.SETTINGS.LABELS_ON_OTHER_LEVELS);
    const exempt = game.user.isGM && game.settings.get(MODULE.ID, MODULE.SETTINGS.SHOW_GMS_EVERY_LABEL);
    const applies = mode !== 'show' && !exempt && token.document.level !== canvas.level.id;
    const alpha = applies && mode === 'dim' ? DIM_ALPHA : 1;
    for (const label of [token.nameplate, token.tooltip, token.bars]) {
      if (!label) continue;
      label.alpha = alpha;
      if (applies && mode === 'hide') label.visible = false;
    }
  }
}
