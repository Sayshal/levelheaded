import { MODULE } from '../constants.mjs';
import { runChecks } from '../features/level-doctor.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** @type {string[]} Severity order and the fieldset each one renders in. */
const SEVERITIES = ['error', 'warning', 'info'];

/** Per-scene validator window: one fieldset per severity, one form group per issue. */
export class LevelDoctorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options Application options
   * @param {Scene} options.scene The scene to check
   */
  constructor({ scene, ...options } = {}) {
    super(options);
    this.scene = scene;
  }

  /** @type {object[]} Issues from the last run. */
  issues = [];

  static DEFAULT_OPTIONS = {
    id: 'levelheaded-doctor',
    classes: [MODULE.ID, 'level-doctor'],
    tag: 'form',
    window: { icon: 'fa-solid fa-stethoscope', resizable: true, contentClasses: ['standard-form'] },
    position: { width: 560, height: 'auto' },
    actions: {
      fix: LevelDoctorApp.#onFix,
      fixAll: LevelDoctorApp.#onFixAll,
      rerun: LevelDoctorApp.#onRerun
    }
  };

  static PARTS = {
    main: { template: MODULE.TEMPLATES.LEVEL_DOCTOR, classes: ['standard-form', 'scrollable'], scrollable: [''] },
    footer: { template: 'templates/generic/form-footer.hbs' }
  };

  /**
   * Open the doctor for a scene, reusing the open window.
   * @param {Scene} scene The scene to check
   * @returns {Promise<LevelDoctorApp>} The rendered application
   */
  static open(scene) {
    const app = foundry.applications.instances.get('levelheaded-doctor') ?? new LevelDoctorApp({ scene });
    app.scene = scene;
    return app.render({ force: true });
  }

  /** @inheritdoc */
  get title() {
    return _loc('LEVELHEADED.Doctor.WindowTitle', { scene: this.scene.name, count: this.issues.length });
  }

  /** @inheritdoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.issues = await runChecks(this.scene);
    const groups = SEVERITIES.map((severity) => ({
      severity,
      legend: _loc(`LEVELHEADED.Doctor.Severity.${severity}`),
      issues: this.issues.flatMap((issue, index) =>
        issue.severity === severity
          ? [
              {
                index,
                title: _loc(`LEVELHEADED.Doctor.${issue.check}.Title`, issue.data),
                hint: _loc(`LEVELHEADED.Doctor.${issue.check}.Hint`, issue.data),
                fixLabel: issue.fix ? _loc(`LEVELHEADED.Doctor.${issue.check}.Fix`) : null
              }
            ]
          : []
      )
    })).filter((group) => group.issues.length);
    const fixable = this.issues.filter((issue) => issue.fix).length;
    const buttons = [
      { type: 'button', action: 'rerun', icon: 'fa-solid fa-rotate', label: 'LEVELHEADED.Doctor.Rerun' },
      { type: 'button', action: 'fixAll', icon: 'fa-solid fa-wand-magic-sparkles', label: 'LEVELHEADED.Doctor.FixAll', disabled: !fixable }
    ];
    return Object.assign(context, { groups, buttons });
  }

  /** @inheritdoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.window.title.textContent = this.title;
  }

  /**
   * Apply one issue's fix, then re-run the checks.
   * @this {LevelDoctorApp}
   * @param {PointerEvent} _event The click
   * @param {HTMLElement} target The fix button
   * @returns {Promise<void>}
   */
  static async #onFix(_event, target) {
    target.disabled = true;
    await this.issues[Number(target.dataset.index)]?.fix?.();
    await this.render();
  }

  /**
   * Apply every available fix, re-checking between passes since one fix can surface another.
   * @this {LevelDoctorApp}
   * @param {PointerEvent} _event The click
   * @param {HTMLElement} target The button
   * @returns {Promise<void>}
   */
  static async #onFixAll(_event, target) {
    target.disabled = true;
    let issues = this.issues;
    // Cap the passes in case two fixes undo each other
    for (let pass = 0; pass < 3 && issues.some((issue) => issue.fix); pass++) {
      for (const issue of issues) if (issue.fix) await issue.fix();
      issues = await runChecks(this.scene);
    }
    await this.render();
  }

  /**
   * Re-run the checks.
   * @this {LevelDoctorApp}
   * @returns {Promise<void>}
   */
  static async #onRerun() {
    await this.render();
  }
}
