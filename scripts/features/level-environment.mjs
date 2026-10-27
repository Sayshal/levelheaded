import { MODULE } from '../constants.mjs';

const { createFormGroup, createNumberInput, createSelectInput } = foundry.applications.fields;

/** Per-level darkness, global light and weather, stored in level flags and applied while that level is viewed. */
export class LevelEnvironment {
  /**
   * Wire the Level config fields and the canvas environment hooks.
   * @returns {void}
   */
  static register() {
    Hooks.on('renderLevelConfig', LevelEnvironment.#onRenderLevelConfig);
    Hooks.on('configureCanvasEnvironment', LevelEnvironment.#onConfigureEnvironment);
    Hooks.on('canvasReady', () => LevelEnvironment.#applyWeather());
    Hooks.on('updateLevel', LevelEnvironment.#onUpdateLevel);
  }

  /**
   * The viewed level's environment overrides.
   * @param {object} [level] The level, defaulting to the viewed one
   * @returns {{darkness: number|null, globalLight: string, weather: string}} The overrides
   */
  static overrides(level = canvas.level) {
    return { darkness: null, globalLight: '', weather: '', ...level?.getFlag(MODULE.ID, MODULE.FLAGS.ENVIRONMENT) };
  }

  /**
   * Add an Environment fieldset to the Level config.
   * @param {foundry.applications.sheets.LevelConfig} app The level sheet
   * @param {HTMLElement} html Its element
   * @returns {void}
   */
  static #onRenderLevelConfig(app, html) {
    const body = html.querySelector('[data-application-part="body"]');
    if (!body || body.querySelector('[data-levelheaded-environment]')) return;
    const { darkness, globalLight, weather } = LevelEnvironment.overrides(app.document);
    const path = `flags.${MODULE.ID}.${MODULE.FLAGS.ENVIRONMENT}`;
    const sceneDefault = _loc('LEVELHEADED.Environment.SceneDefault');
    const weatherOptions = Object.entries(CONFIG.weatherEffects).map(([value, effect]) => ({ value, label: _loc(effect.label) }));
    const fieldset = document.createElement('fieldset');
    fieldset.dataset.levelheadedEnvironment = '';
    fieldset.innerHTML = `<legend>${_loc('LEVELHEADED.Environment.Title')}</legend>`;
    fieldset.append(
      createFormGroup({
        rootId: app.id,
        label: _loc('SCENE.FIELDS.environment.darknessLevel.label'),
        hint: _loc('LEVELHEADED.Environment.DarknessHint'),
        input: createNumberInput({ name: `${path}.darkness`, value: darkness, min: 0, max: 1, step: 0.05, placeholder: sceneDefault })
      }),
      createFormGroup({
        rootId: app.id,
        label: _loc('SCENE.GlobalIllumination'),
        hint: _loc('LEVELHEADED.Environment.GlobalLightHint'),
        input: createSelectInput({
          name: `${path}.globalLight`,
          value: globalLight,
          blank: sceneDefault,
          options: [
            { value: 'on', label: _loc('LEVELHEADED.Environment.On') },
            { value: 'off', label: _loc('LEVELHEADED.Environment.Off') }
          ]
        })
      }),
      createFormGroup({
        rootId: app.id,
        label: _loc('SCENE.FIELDS.weather.label'),
        hint: _loc('LEVELHEADED.Environment.WeatherHint'),
        input: createSelectInput({ name: `${path}.weather`, value: weather, blank: sceneDefault, options: [{ value: 'none', label: _loc('COMMON.None') }, ...weatherOptions] })
      })
    );
    body.append(fieldset);
    app.setPosition({ height: 'auto' });
  }

  /**
   * Layer the viewed level's darkness and global light over the scene environment.
   * @param {object} config The canvas environment config, mutated in place
   * @returns {void}
   */
  static #onConfigureEnvironment(config) {
    if (!canvas.level) return;
    const { darkness, globalLight } = LevelEnvironment.overrides();
    config.environment ??= {};
    config.environment.darknessLevel ??= darkness ?? canvas.scene._source.environment.darknessLevel;
    if (globalLight) config.environment.globalLight = { ...config.environment.globalLight, enabled: globalLight === 'on' };
  }

  /**
   * Swap in the viewed level's weather, or restore the scene's.
   * @returns {void}
   */
  static #applyWeather() {
    if (!canvas.ready) return;
    const { weather } = LevelEnvironment.overrides();
    if (!weather) return;
    canvas.weather.initializeEffects(weather === 'none' ? null : CONFIG.weatherEffects[weather]);
  }

  /**
   * Re-apply the environment when the viewed level's overrides change.
   * @param {object} level The updated level
   * @param {object} changes The update delta
   * @returns {void}
   */
  static #onUpdateLevel(level, changes) {
    if (!level.isView || !foundry.utils.hasProperty(changes, `flags.${MODULE.ID}`)) return;
    canvas.environment.initialize();
    const { weather } = LevelEnvironment.overrides(level);
    canvas.weather.initializeEffects(weather === 'none' ? null : CONFIG.weatherEffects[weather || canvas.scene.weather]);
  }
}
