import { MODULE } from '../constants.mjs';
import { floorStackData } from '../features/floor-stack.mjs';
import { stackedLevels } from '../utils.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { BooleanField, NumberField, SchemaField, StringField } = foundry.data.fields;

/** Floor Stack wizard: create several floors of equal height, with surfaces between them. */
export class FloorStackApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options Application options
   * @param {Scene} options.scene The scene to add floors to
   */
  constructor({ scene, ...options } = {}) {
    super(options);
    this.scene = scene;
  }

  static DEFAULT_OPTIONS = {
    id: 'levelheaded-floor-stack',
    classes: [MODULE.ID, 'floor-stack'],
    tag: 'form',
    window: { title: 'LEVELHEADED.FloorStack.Title', icon: 'fa-solid fa-building', resizable: true, contentClasses: ['standard-form'] },
    position: { width: 480, height: 'auto' },
    form: { handler: FloorStackApp.#onSubmit, closeOnSubmit: true }
  };

  /** @type {SchemaField} The wizard's fields, rendered with core's formGroup helper. */
  static SCHEMA = new SchemaField({
    count: new NumberField({ initial: 3, min: 1, integer: true, label: 'LEVELHEADED.FloorStack.Count', hint: 'LEVELHEADED.FloorStack.CountHint' }),
    height: new NumberField({ label: 'LEVELHEADED.FloorStack.Height', hint: 'LEVELHEADED.FloorStack.HeightHint' }),
    base: new NumberField({ label: 'LEVELHEADED.FloorStack.Base', hint: 'LEVELHEADED.FloorStack.BaseHint' }),
    name: new StringField({ label: 'LEVELHEADED.FloorStack.Name', hint: 'LEVELHEADED.FloorStack.NameHint' }),
    surfaces: new BooleanField({ initial: true, label: 'LEVELHEADED.FloorStack.Surfaces', hint: 'LEVELHEADED.FloorStack.SurfacesHint' }),
    visible: new BooleanField({ initial: true, label: 'LEVELHEADED.FloorStack.Visible', hint: 'LEVELHEADED.FloorStack.VisibleHint' }),
    culling: new BooleanField({ initial: true, label: 'BEHAVIOR.TYPES.defineSurface.FIELDS.culling.label', hint: 'LEVELHEADED.FloorStack.CullingHint' })
  });

  static PARTS = {
    main: { template: MODULE.TEMPLATES.FORM_FIELDS, classes: ['standard-form', 'scrollable'], scrollable: [''] },
    footer: { template: 'templates/generic/form-footer.hbs' }
  };

  /**
   * Open the wizard for a scene, reusing the open window.
   * @param {Scene} scene The scene
   * @returns {Promise<FloorStackApp>} The rendered application
   */
  static open(scene) {
    const app = foundry.applications.instances.get('levelheaded-floor-stack') ?? new FloorStackApp({ scene });
    app.scene = scene;
    return app.render({ force: true });
  }

  /** @inheritdoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const { distance, units } = this.scene.grid;
    const top = stackedLevels(this.scene)
      .map((level) => level.elevation.top)
      .filter(Number.isFinite)
      .at(-1);
    const { count, height, base, name, surfaces, visible, culling } = FloorStackApp.SCHEMA.fields;
    return Object.assign(context, {
      rootId: this.id,
      fields: [
        { field: count },
        { field: height, value: distance * 2, units, min: distance, step: distance },
        { field: base, value: top ?? 0, units, step: distance },
        { field: name, value: _loc('LEVELHEADED.FloorStack.DefaultName') },
        { field: surfaces },
        { field: visible },
        { field: culling }
      ],
      buttons: [{ type: 'submit', icon: 'fa-solid fa-check', label: 'LEVELHEADED.FloorStack.Create' }]
    });
  }

  /**
   * Create the stack's levels and surfaces.
   * @this {FloorStackApp}
   * @param {SubmitEvent} _event The submit event
   * @param {HTMLFormElement} _form The form
   * @param {foundry.applications.ux.FormDataExtended} formData The submitted values
   * @returns {Promise<void>}
   */
  static async #onSubmit(_event, _form, formData) {
    const config = formData.object;
    if (!config.count || !config.height) return;
    const { levels, regions, below } = floorStackData(this.scene, config);
    await this.scene.createEmbeddedDocuments('Level', levels, { keepId: true, levelheadedStack: true });
    if (config.visible && below) await below.update({ 'visibility.levels': [...below._source.visibility.levels, levels[0]._id] });
    if (regions.length) await this.scene.createEmbeddedDocuments('Region', regions);
  }
}
