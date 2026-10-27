import { MODULE } from '../constants.mjs';
import { mergeScenes, sameDimensions } from '../features/scene-merge.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { BooleanField, NumberField, SchemaField, SetField, StringField } = foundry.data.fields;

/** Merge Scenes: copy other scenes into this one as levels stacked above its top. */
export class SceneMergeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options Application options
   * @param {Scene} options.scene The scene that receives the levels
   */
  constructor({ scene, ...options } = {}) {
    super(options);
    this.scene = scene;
  }

  static DEFAULT_OPTIONS = {
    id: 'levelheaded-scene-merge',
    classes: [MODULE.ID, 'scene-merge'],
    tag: 'form',
    window: { icon: 'fa-solid fa-layer-group', resizable: true, contentClasses: ['standard-form'] },
    position: { width: 600, height: 'auto' },
    form: { handler: SceneMergeApp.#onSubmit, closeOnSubmit: true }
  };

  /** @type {SchemaField} The form's fields, rendered with core's formGroup helper. */
  static SCHEMA = new SchemaField({
    scenes: new SetField(new StringField({ required: true, blank: false }), { label: 'LEVELHEADED.Merge.Scenes', hint: 'LEVELHEADED.Merge.ScenesHint' }),
    height: new NumberField({ label: 'LEVELHEADED.FloorStack.Height', hint: 'LEVELHEADED.Merge.HeightHint' }),
    surfaces: new BooleanField({ initial: true, label: 'LEVELHEADED.FloorStack.Surfaces', hint: 'LEVELHEADED.Merge.SurfacesHint' }),
    visible: new BooleanField({ initial: true, label: 'LEVELHEADED.FloorStack.Visible', hint: 'LEVELHEADED.FloorStack.VisibleHint' }),
    culling: new BooleanField({ initial: true, label: 'BEHAVIOR.TYPES.defineSurface.FIELDS.culling.label', hint: 'LEVELHEADED.FloorStack.CullingHint' }),
    allowMismatch: new BooleanField({ initial: false, label: 'LEVELHEADED.Merge.AllowMismatch', hint: 'LEVELHEADED.Merge.AllowMismatchHint' })
  });

  static PARTS = {
    main: { template: MODULE.TEMPLATES.FORM_FIELDS, classes: ['standard-form', 'scrollable'], scrollable: [''] },
    footer: { template: 'templates/generic/form-footer.hbs' }
  };

  /**
   * Open the form for a scene, reusing the open window.
   * @param {Scene} scene The scene that receives the levels
   * @returns {Promise<SceneMergeApp>} The rendered application
   */
  static open(scene) {
    const app = foundry.applications.instances.get('levelheaded-scene-merge') ?? new SceneMergeApp({ scene });
    app.scene = scene;
    return app.render({ force: true });
  }

  /** @inheritdoc */
  get title() {
    return _loc('LEVELHEADED.Merge.WindowTitle', { scene: this.scene.name });
  }

  /** @inheritdoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const { distance, units } = this.scene.grid;
    const mismatch = _loc('LEVELHEADED.Merge.Mismatch');
    const scenes = game.scenes.filter((scene) => scene !== this.scene).map((scene) => ({ value: scene.id, label: sameDimensions(scene, this.scene) ? scene.name : `${scene.name} (${mismatch})` }));
    const fields = SceneMergeApp.SCHEMA.fields;
    return Object.assign(context, {
      rootId: this.id,
      fields: [
        { field: fields.scenes, options: scenes },
        { field: fields.height, value: distance * 2, units, min: distance, step: distance },
        { field: fields.surfaces },
        { field: fields.visible },
        { field: fields.culling },
        { field: fields.allowMismatch }
      ],
      buttons: [{ type: 'submit', icon: 'fa-solid fa-layer-group', label: 'LEVELHEADED.Merge.Submit' }]
    });
  }

  /** @inheritdoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.window.title.textContent = this.title;
  }

  /**
   * Merge the chosen scenes, refusing mismatched dimensions unless the GM allows them.
   * @this {SceneMergeApp}
   * @param {SubmitEvent} _event The submit event
   * @param {HTMLFormElement} _form The form
   * @param {foundry.applications.ux.FormDataExtended} formData The submitted values
   * @returns {Promise<void>}
   */
  static async #onSubmit(_event, _form, formData) {
    const { scenes, height, allowMismatch, ...options } = formData.object;
    const sources = (scenes ?? []).map((id) => game.scenes.get(id)).filter(Boolean);
    if (!sources.length) throw new Error(_loc('LEVELHEADED.Merge.NoScenes'));
    if (!(height > 0)) throw new Error(_loc('LEVELHEADED.Merge.NoHeight'));
    const mismatched = sources.filter((source) => !sameDimensions(source, this.scene));
    if (mismatched.length && !allowMismatch) throw new Error(_loc('LEVELHEADED.Merge.Mismatched', { scenes: mismatched.map((scene) => scene.name).join(', ') }));
    await mergeScenes(this.scene, sources, { height, ...options });
    ui.notifications.info(_loc('LEVELHEADED.Merge.Done', { count: sources.length, scene: this.scene.name }));
  }
}
