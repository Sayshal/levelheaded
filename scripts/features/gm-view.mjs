import { MODULE } from '../constants.mjs';
import { addTool, isMultiLevel } from '../utils.mjs';

/** Level hotkeys, a compact level navigation, a hide-above toggle, and no view jump when a GM selects a token on another level. */
export class GMView {
  /**
   * Register keybindings, hooks and the Token#_onControl override.
   * @returns {void}
   */
  static register() {
    GMView.#registerKeybindings();
    GMView.#overrideOnControl();
    Hooks.on('getSceneControlButtons', GMView.#onGetSceneControlButtons);
    Hooks.on('renderSceneNavigation', GMView.#onRenderSceneNavigation);
  }

  /**
   * Whether the GM is hiding levels above the viewed one.
   * @returns {boolean} True while hide-above is on
   */
  static get hideAbove() {
    return game.user.isGM && game.settings.get(MODULE.ID, MODULE.SETTINGS.HIDE_ABOVE);
  }

  /**
   * Register level up/down and the hide-above toggle.
   * @returns {void}
   */
  static #registerKeybindings() {
    const cycle = (direction) => () => {
      if (!isMultiLevel(canvas.scene)) return false;
      canvas.scene.cycleLevel(direction);
      return true;
    };
    game.keybindings.register(MODULE.ID, MODULE.KEYBINDINGS.LEVEL_UP, {
      name: 'LEVELHEADED.Keybindings.LevelUp.Name',
      hint: 'LEVELHEADED.Keybindings.LevelUp.Hint',
      editable: [{ key: 'Comma', modifiers: ['Shift'] }],
      onDown: cycle(1)
    });
    game.keybindings.register(MODULE.ID, MODULE.KEYBINDINGS.LEVEL_DOWN, {
      name: 'LEVELHEADED.Keybindings.LevelDown.Name',
      hint: 'LEVELHEADED.Keybindings.LevelDown.Hint',
      editable: [{ key: 'Period', modifiers: ['Shift'] }],
      onDown: cycle(-1)
    });
    game.keybindings.register(MODULE.ID, MODULE.KEYBINDINGS.HIDE_ABOVE, {
      name: 'LEVELHEADED.HideAbove.Title',
      hint: 'LEVELHEADED.Keybindings.HideAbove.Hint',
      restricted: true,
      onDown: () => {
        GMView.#setHideAbove(!GMView.hideAbove);
        return true;
      }
    });
  }

  /**
   * Store the hide-above state and keep the scene control button in step.
   * @param {boolean} active Whether to hide levels above
   * @returns {Promise<void>}
   */
  static async #setHideAbove(active) {
    await game.settings.set(MODULE.ID, MODULE.SETTINGS.HIDE_ABOVE, active);
    const tool = ui.controls.controls.tokens?.tools.levelheadedHideAbove;
    if (tool && tool.active !== active) {
      tool.active = active;
      ui.controls.render();
    }
  }

  /**
   * Skip core's view jump when a GM selects a single token on another level, if the GM keeps their view.
   * @returns {void}
   */
  static #overrideOnControl() {
    const Token = foundry.canvas.placeables.Token;
    const onControl = Token.prototype._onControl;
    Token.prototype._onControl = function (options = {}) {
      const keepView = game.user.isGM && game.settings.get(MODULE.ID, MODULE.SETTINGS.KEEP_VIEW_WHEN_SELECTING);
      return onControl.call(this, keepView ? { ...options, releaseOthers: false } : options);
    };
  }

  /**
   * Add the hide-above toggle to the token controls.
   * @param {object} controls Scene controls keyed by name
   * @returns {void}
   */
  static #onGetSceneControlButtons(controls) {
    if (!game.user.isGM || !controls.tokens) return;
    addTool(controls.tokens, {
      name: 'levelheadedHideAbove',
      title: 'LEVELHEADED.HideAbove.Title',
      icon: 'fa-solid fa-arrows-down-to-line',
      toggle: true,
      active: GMView.hideAbove,
      onChange: (_event, active) => GMView.#setHideAbove(active)
    });
  }

  /**
   * Scroll the level list one level per wheel tick, and add the compact toggle.
   * @param {foundry.applications.ui.SceneNavigation} _app The scene navigation
   * @param {HTMLElement} html Its element
   * @returns {void}
   */
  static #onRenderSceneNavigation(_app, html) {
    const menu = html.querySelector('#scene-navigation-levels');
    if (!menu) return;
    const compact = game.settings.get(MODULE.ID, MODULE.SETTINGS.COMPACT_LEVEL_NAV);
    menu.classList.toggle('levelheaded-compact', compact);
    menu.addEventListener(
      'wheel',
      (event) => {
        if (compact) return;
        event.preventDefault();
        const row = menu.querySelector('.level-row')?.offsetHeight ?? 0;
        menu.scrollBy({ top: Math.sign(event.deltaY) * row });
      },
      { passive: false }
    );
    const toggle = document.createElement('a');
    toggle.className = 'levelheaded-compact-toggle ui-control';
    toggle.innerHTML = '<i class="fa-solid fa-caret-up" inert></i>';
    toggle.ariaLabel = _loc(compact ? 'LEVELHEADED.CompactNav.Expand' : 'LEVELHEADED.CompactNav.Collapse');
    toggle.dataset.tooltip = '';
    toggle.addEventListener('click', () => game.settings.set(MODULE.ID, MODULE.SETTINGS.COMPACT_LEVEL_NAV, !compact));
    menu.before(toggle);
  }
}
