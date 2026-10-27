import { MODULE } from '../constants.mjs';
import { connectorSpan } from '../features/silent-stairs.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { BooleanField, NumberField, SchemaField, StringField } = foundry.data.fields;

/** Connect Levels: turn the selected regions into a stair or an elevator between two levels. */
export class MakeStairApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options Application options
   * @param {Scene} options.scene The scene
   * @param {RegionDocument[]} options.regions The regions to convert
   */
  constructor({ scene, regions, ...options } = {}) {
    super(options);
    this.scene = scene;
    this.regions = regions;
  }

  static DEFAULT_OPTIONS = {
    id: 'levelheaded-make-stair',
    classes: [MODULE.ID, 'make-stair'],
    tag: 'form',
    window: { title: 'LEVELHEADED.Stair.Title', icon: 'fa-solid fa-stairs', resizable: true, contentClasses: ['standard-form'] },
    position: { width: 600, height: 'auto' },
    form: { handler: MakeStairApp.#onSubmit, closeOnSubmit: true }
  };

  /** @type {SchemaField} The form's fields, rendered with core's formGroup helper. */
  static SCHEMA = new SchemaField({
    type: new StringField({
      required: true,
      blank: false,
      initial: 'stair',
      choices: { stair: 'LEVELHEADED.Stair.Type.stair', elevator: 'LEVELHEADED.Stair.Type.elevator' },
      label: 'LEVELHEADED.Stair.TypeLabel',
      hint: 'LEVELHEADED.Stair.TypeHint.stair'
    }),
    lower: new StringField({ required: true, blank: false, label: 'LEVELHEADED.Stair.Lower', hint: 'LEVELHEADED.Stair.LowerHint' }),
    upper: new StringField({ required: true, blank: false, label: 'LEVELHEADED.Stair.Upper', hint: 'LEVELHEADED.Stair.UpperHint' }),
    offsetX: new NumberField({
      initial: 0,
      integer: true,
      label: 'LEVELHEADED.Behavior.SilentChangeLevel.FIELDS.offsetX.label',
      hint: 'LEVELHEADED.Behavior.SilentChangeLevel.FIELDS.offsetX.hint'
    }),
    offsetY: new NumberField({
      initial: 0,
      integer: true,
      label: 'LEVELHEADED.Behavior.SilentChangeLevel.FIELDS.offsetY.label',
      hint: 'LEVELHEADED.Behavior.SilentChangeLevel.FIELDS.offsetY.hint'
    }),
    cameraFollow: new BooleanField({
      initial: true,
      label: 'LEVELHEADED.Behavior.SilentChangeLevel.FIELDS.cameraFollow.label',
      hint: 'LEVELHEADED.Behavior.SilentChangeLevel.FIELDS.cameraFollow.hint'
    })
  });

  static PARTS = {
    main: { template: MODULE.TEMPLATES.FORM_FIELDS, classes: ['standard-form', 'scrollable'], scrollable: [''] },
    footer: { template: 'templates/generic/form-footer.hbs' }
  };

  /**
   * Open the form for the controlled regions, reusing the open window.
   * @param {Scene} scene The scene
   * @param {RegionDocument[]} regions The regions to convert
   * @returns {Promise<MakeStairApp>} The rendered application
   */
  static open(scene, regions) {
    const app = foundry.applications.instances.get('levelheaded-make-stair') ?? new MakeStairApp({ scene, regions });
    Object.assign(app, { scene, regions });
    return app.render({ force: true });
  }

  /** @inheritdoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sorted = this.scene.levels.sorted;
    const viewed = this.scene.levels.get(canvas.level?.id) ?? sorted[0];
    const index = sorted.indexOf(viewed);
    const [lower, upper] = sorted[index + 1] ? [viewed, sorted[index + 1]] : [sorted[index - 1], viewed];
    const choices = Object.fromEntries(this.scene.levels.reverseSorted.map((level) => [level.id, level.name]));
    const fields = MakeStairApp.SCHEMA.fields;
    return Object.assign(context, {
      rootId: this.id,
      fields: [
        { field: fields.type },
        { field: fields.lower, value: lower?.id, choices },
        { field: fields.upper, value: upper?.id, choices },
        { field: fields.offsetX, units: 'LEVELHEADED.Behavior.SilentChangeLevel.GridSpaces' },
        { field: fields.offsetY, units: 'LEVELHEADED.Behavior.SilentChangeLevel.GridSpaces' },
        { field: fields.cameraFollow }
      ],
      buttons: [{ type: 'submit', icon: 'fa-solid fa-stairs', label: 'LEVELHEADED.Stair.Title' }]
    });
  }

  /** @inheritdoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const type = this.element.querySelector('[name="type"]');
    const hint = type.closest('.form-group').querySelector('.hint');
    const stairOnly = ['offsetX', 'offsetY', 'cameraFollow'].map((name) => this.element.querySelector(`[name="${name}"]`).closest('.form-group'));
    type.addEventListener('change', () => {
      hint.textContent = _loc(`LEVELHEADED.Stair.TypeHint.${type.value}`);
      for (const group of stairOnly) group.hidden = type.value !== 'stair';
      this.setPosition({ height: 'auto' });
    });
  }

  /**
   * Turn the regions into the chosen connector.
   * @this {MakeStairApp}
   * @param {SubmitEvent} _event The submit event
   * @param {HTMLFormElement} _form The form
   * @param {foundry.applications.ux.FormDataExtended} formData The submitted values
   * @returns {Promise<void>}
   */
  static async #onSubmit(_event, _form, formData) {
    const config = formData.object;
    const lower = this.scene.levels.get(config.lower);
    const upper = this.scene.levels.get(config.upper);
    if (!lower || !upper || lower === upper) throw new Error(_loc('LEVELHEADED.Stair.SameLevel'));
    const span = connectorSpan(this.scene.levels.sorted, lower, upper, config.type);
    const behavior =
      config.type === 'elevator'
        ? { type: 'changeLevel' }
        : { type: MODULE.BEHAVIOR_TYPE, system: { destination: 'other', offsetX: config.offsetX, offsetY: config.offsetY, cameraFollow: config.cameraFollow } };
    const levels = span.levels.map((level) => level.id);
    await this.scene.updateEmbeddedDocuments(
      'Region',
      this.regions.map((region) => ({ _id: region.id, levels, elevation: span.elevation, 'restriction.enabled': false }))
    );
    const name = _loc(`LEVELHEADED.Stair.Type.${config.type}`);
    await Promise.all(this.regions.map((region) => region.createEmbeddedDocuments('RegionBehavior', [{ ...behavior, name }])));
  }
}
