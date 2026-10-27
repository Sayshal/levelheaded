import { MODULE } from '../constants.mjs';
import { isMultiLevel, levelsAtElevation, moveTokensToLevel } from '../utils.mjs';

const { DialogV2 } = foundry.applications.api;
const { createCheckboxInput, createFormGroup, createSelectInput } = foundry.applications.fields;

/** Keeps a token's level in step with its elevation, places new tokens on a sensible level, and gives HUD level changes a landing mode. */
export class ElevationSync {
  /**
   * Wire the creation, movement, HUD, context menu and Scene Config hooks.
   * @returns {void}
   */
  static register() {
    Hooks.on('preCreateToken', ElevationSync.#onPreCreateToken);
    Hooks.on('moveToken', ElevationSync.#onMoveToken);
    Hooks.on('renderTokenHUD', ElevationSync.#onRenderTokenHUD);
    Hooks.on('getTokenPlaceableContextOptions', ElevationSync.#onPlaceableContextOptions);
    Hooks.on('renderSceneConfig', ElevationSync.#onRenderSceneConfig);
  }

  /**
   * Whether elevation changes should change level on this scene.
   * @param {Scene} scene The scene
   * @returns {boolean} True when the world setting is on and the scene hasn't opted out
   */
  static isEnabled(scene) {
    return isMultiLevel(scene) && game.settings.get(MODULE.ID, MODULE.SETTINGS.LEVEL_WITH_ELEVATION) && scene.getFlag(MODULE.ID, MODULE.FLAGS.SYNC_ELEVATION) !== false;
  }

  /**
   * The landing mode for HUD and context menu level changes.
   * @returns {string} "base", "relative" or "absolute"
   */
  static get mode() {
    return game.settings.get(MODULE.ID, MODULE.SETTINGS.LAND_AT);
  }

  /**
   * Move a token left on core's default level to the level matching its elevation.
   * @param {TokenDocument} token The pending token
   * @param {object} data The creation data
   * @param {object} _options Creation options
   * @param {string} userId The creating user
   * @returns {void}
   */
  static #onPreCreateToken(token, data, _options, userId) {
    if (userId !== game.user.id) return;
    const scene = token.parent;
    if (!isMultiLevel(scene)) return;
    const viewed = scene.isView ? canvas.level : null;
    const elevation = Number.isFinite(data.elevation) && data.elevation !== 0 ? data.elevation : null;
    const initial = scene.initialLevel;
    const defaulted = data.level == null || (elevation === null && !!viewed && viewed !== initial && data.level === initial?.id);
    if (!defaulted) {
      const named = scene.levels.get(data.level);
      if (elevation === null && named && !levelsAtElevation([named], 0).length) token.updateSource({ elevation: named.elevation.base });
      return;
    }
    if (elevation !== null) {
      const candidates = levelsAtElevation(scene.levels.sorted, elevation);
      const level = candidates.includes(viewed) ? viewed : candidates[0];
      if (level) token.updateSource({ level: level.id });
      return;
    }
    if (viewed) token.updateSource({ level: viewed.id, elevation: viewed.elevation.base });
  }

  /**
   * After a movement that changed elevation but not level, move the token to the matching level.
   * @param {TokenDocument} token The moved token
   * @param {object} movement The movement operation
   * @param {object} _operation The update operation
   * @param {User} user The user that moved the token
   * @returns {Promise<void>}
   */
  static async #onMoveToken(token, movement, _operation, user) {
    if (!user.isSelf || movement.pending.waypoints.length) return;
    if (movement.origin.level !== movement.destination.level || movement.origin.elevation === movement.destination.elevation) return;
    const scene = token.parent;
    if (!ElevationSync.isEnabled(scene)) return;
    const elevation = token._source.elevation;
    const current = scene.levels.get(token._source.level);
    const candidates = levelsAtElevation(scene.levels.sorted, elevation);
    if (!candidates.length || candidates.includes(current)) return;
    const level = candidates.length === 1 ? candidates[0] : await ElevationSync.#chooseLevel(token, candidates);
    if (!level || token._source.level === level.id) return;
    const followView = scene.isView && canvas.level === current && !!token.object?.controlled;
    if (token.rendered) await token.object.movementAnimationPromise;
    // A newer movement supersedes this one; its own moveToken decides the level
    if (token.movement.id !== movement.id) return;
    await token.move({ level: level.id, elevation }, { animate: false, constrainOptions: { ignoreWalls: true, ignoreCost: true } });
    if (followView) await scene.view({ level: level.id, controlledTokens: [token.id] });
  }

  /**
   * Ask which overlapping level the token moves to.
   * @param {TokenDocument} token The token
   * @param {object[]} levels Candidate levels
   * @returns {Promise<object|null>} The chosen level, or null to stay
   */
  static async #chooseLevel(token, levels) {
    const content = document.createElement('div');
    const question = document.createElement('p');
    question.textContent = _loc('LEVELHEADED.ElevationSync.ChooseLevel', { token: token.name, elevation: token._source.elevation, units: token.parent.grid.units });
    const group = createFormGroup({
      rootId: 'levelheaded-choose-level',
      label: _loc('BEHAVIOR.TYPES.changeLevel.Level'),
      input: createSelectInput({ name: 'level', options: levels.toReversed().map((level) => ({ value: level.id, label: level.name })) })
    });
    content.append(question, group);
    const origin = token.parent.levels.get(token._source.level);
    const moveLabel = (levelId) => {
      const base = token.parent.levels.get(levelId)?.elevation.base;
      if (!origin || base === origin.elevation.base) return 'BEHAVIOR.TYPES.changeLevel.Move';
      return base > origin.elevation.base ? 'BEHAVIOR.TYPES.changeLevel.MoveUp' : 'BEHAVIOR.TYPES.changeLevel.MoveDown';
    };
    const select = group.querySelector('[name="level"]');
    const levelId = await DialogV2.confirm({
      window: { title: CONFIG.RegionBehavior.typeLabels.changeLevel, icon: CONFIG.RegionBehavior.typeIcons.changeLevel },
      classes: [MODULE.ID],
      content,
      yes: { label: moveLabel(select.value), callback: (_event, button) => button.form.elements.level.value },
      no: { label: 'BEHAVIOR.TYPES.changeLevel.DoNotMove' },
      render: (_event, dialog) => {
        const level = dialog.element.querySelector('[name="level"]');
        level.addEventListener('change', () => (dialog.element.querySelector('[data-action="yes"] > span').textContent = _loc(moveLabel(level.value))));
      },
      rejectClose: false
    });
    return token.parent.levels.get(levelId) ?? null;
  }

  /**
   * Add the landing mode select to the HUD level palette and route level clicks through it.
   * @param {foundry.applications.hud.TokenHUD} hud The HUD
   * @param {HTMLElement} html The HUD element
   * @returns {void}
   */
  static #onRenderTokenHUD(hud, html) {
    const palette = html.querySelector('.palette[data-palette="levels"]');
    if (!palette) return;
    const select = createSelectInput({
      value: ElevationSync.mode,
      options: ['base', 'relative', 'absolute'].map((mode) => ({ value: mode, label: _loc(`LEVELHEADED.LevelMode.${mode.capitalize()}`) }))
    });
    select.ariaLabel = _loc('LEVELHEADED.LevelMode.Label');
    select.dataset.tooltip = _loc(`LEVELHEADED.LevelMode.${select.value.capitalize()}Hint`);
    select.addEventListener('change', (event) => {
      event.stopPropagation();
      select.dataset.tooltip = _loc(`LEVELHEADED.LevelMode.${select.value.capitalize()}Hint`);
      game.settings.set(MODULE.ID, MODULE.SETTINGS.LAND_AT, select.value);
    });
    const row = document.createElement('label');
    row.className = 'levelheaded-hud-mode';
    const caption = document.createElement('span');
    caption.textContent = _loc('LEVELHEADED.LevelMode.Label');
    row.append(caption, select);
    palette.prepend(row);
    palette.addEventListener(
      'click',
      (event) => {
        const entry = event.target.closest('[data-action="level"]');
        if (!entry || ElevationSync.mode === 'absolute') return;
        event.stopPropagation();
        const level = canvas.scene.levels.get(entry.dataset.levelId);
        if (level)
          moveTokensToLevel(
            canvas.scene,
            hud.layer.controlled.map((token) => token.document),
            level,
            ElevationSync.mode
          );
      },
      { capture: true }
    );
  }

  /**
   * Route the Placeables "Change Level" entry through the landing mode.
   * @param {foundry.applications.sidebar.tabs.TokenTab} _app The token tab
   * @param {object[]} options Context menu entries
   * @returns {void}
   */
  static #onPlaceableContextOptions(_app, options) {
    const entry = options.find((option) => option.label === 'SIDEBAR.PLACEABLES.ACTIONS.ChangeLevel');
    if (!entry) return;
    const coreOnClick = entry.onClick;
    entry.onClick = (event, li) => {
      if (ElevationSync.mode === 'absolute' || !canvas.level) return coreOnClick(event, li);
      const token = canvas.scene.tokens.get(li.dataset.entryId);
      if (!token) return;
      const tokens = token.rendered && token.object.controlled ? canvas.tokens.controlled.map((controlled) => controlled.document) : [token];
      return moveTokensToLevel(canvas.scene, tokens, canvas.level, ElevationSync.mode);
    };
  }

  /**
   * Add the per-scene sync toggle to the Levels tab.
   * @param {foundry.applications.sheets.SceneConfig} app The scene config
   * @param {HTMLElement} html The rendered element
   * @returns {void}
   */
  static #onRenderSceneConfig(app, html) {
    const tab = html.querySelector('.tab[data-tab="levels"]');
    const name = `flags.${MODULE.ID}.${MODULE.FLAGS.SYNC_ELEVATION}`;
    if (!tab || tab.querySelector(`[name="${name}"]`)) return;
    const group = createFormGroup({
      label: _loc('LEVELHEADED.SceneConfig.SyncElevation.Name'),
      hint: _loc('LEVELHEADED.SceneConfig.SyncElevation.Hint'),
      input: createCheckboxInput({ name, value: app.document.getFlag(MODULE.ID, MODULE.FLAGS.SYNC_ELEVATION) !== false }),
      rootId: app.id
    });
    tab.append(group);
  }
}
