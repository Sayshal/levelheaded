import { MODULE } from '../constants.mjs';

/** @type {number} Label opacity for tokens on other levels in "dim" mode. */
const DIM_ALPHA = 0.5;

/** Absolute elevation readout, and dimmed or hidden labels for tokens on other levels. */
export class ElevationDisplay {
  /** @type {{mode: string, gmSeesAll: boolean, readout: string}|null} Label settings read on every token refresh, cleared when one changes. */
  static #settings = null;

  /**
   * Wrap the tooltip text and wire the token refresh hook.
   * @returns {void}
   */
  static register() {
    ElevationDisplay.#overrideTooltipText();
    Hooks.on('refreshToken', ElevationDisplay.#onRefreshToken);
  }

  /**
   * Cached label settings.
   * @returns {{mode: string, gmSeesAll: boolean, readout: string}} The settings
   */
  static get #config() {
    ElevationDisplay.#settings ??= {
      mode: game.settings.get(MODULE.ID, MODULE.SETTINGS.LABELS_ON_OTHER_LEVELS),
      gmSeesAll: game.settings.get(MODULE.ID, MODULE.SETTINGS.SHOW_GMS_EVERY_LABEL),
      readout: game.settings.get(MODULE.ID, MODULE.SETTINGS.ELEVATION_READOUT)
    };
    return ElevationDisplay.#settings;
  }

  /**
   * Forget the cached label settings after one changes.
   * @returns {void}
   */
  static resetSettings() {
    ElevationDisplay.#settings = null;
  }

  /**
   * Show the token's absolute elevation in its tooltip when the readout is set to absolute.
   * @returns {void}
   */
  static #overrideTooltipText() {
    const Token = foundry.canvas.placeables.Token;
    const getTooltipText = Token.prototype._getTooltipText;
    Token.prototype._getTooltipText = function () {
      if (ElevationDisplay.#config.readout !== 'absolute') return getTooltipText.call(this);
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
    const { mode, gmSeesAll } = ElevationDisplay.#config;
    const exempt = game.user.isGM && gmSeesAll;
    const applies = mode !== 'show' && !exempt && token.document.level !== canvas.level.id;
    const alpha = applies && mode === 'dim' ? DIM_ALPHA : 1;
    for (const label of [token.nameplate, token.tooltip, token.bars]) {
      if (!label) continue;
      label.alpha = alpha;
      if (applies && mode === 'hide') label.visible = false;
    }
  }
}
