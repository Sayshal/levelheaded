import { MODULE } from '../constants.mjs';
import { applyTemplate, SURFACES } from '../features/templates.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { SchemaField, StringField } = foundry.data.fields;

/** Surface Template: turn the selected regions into a roof, balcony, trapdoor, or vision and fade pair. */
export class SurfaceTemplateApp extends HandlebarsApplicationMixin(ApplicationV2) {
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
    id: 'levelheaded-surface-template',
    classes: [MODULE.ID, 'surface-template'],
    tag: 'form',
    window: { title: 'LEVELHEADED.Templates.Title', icon: 'fa-solid fa-shapes', resizable: true, contentClasses: ['standard-form'] },
    position: { width: 480, height: 'auto' },
    form: { handler: SurfaceTemplateApp.#onSubmit, closeOnSubmit: true }
  };

  /** @type {SchemaField} The form's fields, rendered with core's formGroup helper. */
  static SCHEMA = new SchemaField({
    type: new StringField({
      required: true,
      blank: false,
      initial: 'roof',
      label: 'LEVELHEADED.Templates.TypeLabel'
    }),
    level: new StringField({ required: true, blank: false, label: 'LEVELHEADED.Templates.Level', hint: 'LEVELHEADED.Templates.LevelHint' })
  });

  static PARTS = {
    main: { template: MODULE.TEMPLATES.FORM_FIELDS, classes: ['standard-form', 'scrollable'], scrollable: [''] },
    footer: { template: 'templates/generic/form-footer.hbs' }
  };

  /**
   * Open the form for the controlled regions, reusing the open window.
   * @param {Scene} scene The scene
   * @param {RegionDocument[]} regions The regions to convert
   * @returns {Promise<SurfaceTemplateApp>} The rendered application
   */
  static open(scene, regions) {
    const app = foundry.applications.instances.get('levelheaded-surface-template') ?? new SurfaceTemplateApp({ scene, regions });
    Object.assign(app, { scene, regions });
    return app.render({ force: true });
  }

  /** @inheritdoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const fields = SurfaceTemplateApp.SCHEMA.fields;
    const types = Object.fromEntries(Object.keys(SURFACES).map((type) => [type, `LEVELHEADED.Templates.Type.${type}`]));
    const levels = Object.fromEntries(this.scene.levels.reverseSorted.map((level) => [level.id, level.name]));
    return Object.assign(context, {
      rootId: this.id,
      fields: [
        { field: fields.type, choices: types, hint: `LEVELHEADED.Templates.TypeHint.${fields.type.initial}` },
        { field: fields.level, value: canvas.level?.id, choices: levels }
      ],
      buttons: [{ type: 'submit', icon: 'fa-solid fa-shapes', label: 'LEVELHEADED.Templates.Apply' }]
    });
  }

  /** @inheritdoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const type = this.element.querySelector('[name="type"]');
    const hint = type.closest('.form-group').querySelector('.hint');
    type.addEventListener('change', () => (hint.textContent = _loc(`LEVELHEADED.Templates.TypeHint.${type.value}`)));
  }

  /**
   * Apply the chosen template to the regions.
   * @this {SurfaceTemplateApp}
   * @param {SubmitEvent} _event The submit event
   * @param {HTMLFormElement} _form The form
   * @param {foundry.applications.ux.FormDataExtended} formData The submitted values
   * @returns {Promise<void>}
   */
  static async #onSubmit(_event, _form, formData) {
    const { type, level } = formData.object;
    const target = this.scene.levels.get(level);
    if (target) await applyTemplate(this.regions, type, target);
  }
}
