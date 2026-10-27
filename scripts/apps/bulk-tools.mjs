import { MODULE } from '../constants.mjs';
import { repairNullLevels } from '../features/level-doctor.mjs';
import { copiesOnLevel, levelSetUpdates, movesToLevel } from '../features/bulk-tools.mjs';
import { LEVELED_DOCUMENTS } from '../utils.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { FormDataExtended } = foundry.applications.ux;

/** Assign, include, exclude, copy, move or paste the active layer's controlled placeables across levels. */
export class BulkToolsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'levelheaded-bulk-tools',
    classes: [MODULE.ID, 'bulk-tools'],
    tag: 'form',
    window: { title: 'LEVELHEADED.Bulk.Title', icon: 'fa-solid fa-boxes-stacked', contentClasses: ['standard-form'] },
    position: { width: 480, height: 'auto' },
    actions: {
      assign: BulkToolsApp.#onSetLevels,
      include: BulkToolsApp.#onSetLevels,
      exclude: BulkToolsApp.#onSetLevels,
      copy: BulkToolsApp.#onCopy,
      move: BulkToolsApp.#onMove,
      paste: BulkToolsApp.#onPaste,
      repairWalls: BulkToolsApp.#onRepairWalls
    }
  };

  static PARTS = { main: { template: MODULE.TEMPLATES.BULK_TOOLS, classes: ['standard-form', 'scrollable'], scrollable: [''] } };

  /**
   * The open window, if any.
   * @returns {BulkToolsApp|undefined} The application
   */
  static get instance() {
    return foundry.applications.instances.get('levelheaded-bulk-tools');
  }

  /**
   * Open the window, reusing the open one.
   * @returns {Promise<BulkToolsApp>} The rendered application
   */
  static open() {
    return (BulkToolsApp.instance ?? new BulkToolsApp()).render({ force: true });
  }

  /**
   * The active layer's document name, when it holds leveled placeables.
   * @returns {string|null} The document name
   */
  get documentName() {
    const documentName = canvas.activeLayer?.constructor.documentName;
    return LEVELED_DOCUMENTS.includes(documentName) ? documentName : null;
  }

  /**
   * The controlled placeables the tools act on.
   * @returns {foundry.abstract.Document[]} Their documents
   */
  get selection() {
    return this.documentName ? canvas.activeLayer.controlled.map((object) => object.document) : [];
  }

  /** @inheritdoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const scene = canvas.scene;
    const documentName = this.documentName;
    const selectableLevels = scene?.levels.reverseSorted.map((level) => ({ value: level.id, label: level.name })) ?? [];
    const typeLabel = documentName ? _loc(getDocumentClass(documentName).metadata.labelPlural) : '';
    return Object.assign(context, {
      rootId: this.id,
      levelsField: getDocumentClass('Wall').schema.fields.levels,
      selectableLevels,
      selectedLevels: [],
      target: canvas.level?.id,
      hasSelection: this.selection.length > 0,
      canPaste: !!documentName && canvas.activeLayer.clipboard.objects.length > 0,
      documentName,
      selectionLegend: documentName ? _loc('LEVELHEADED.Bulk.Selection', { count: this.selection.length, type: typeLabel }) : _loc('LEVELHEADED.Bulk.SetLevels.Name'),
      nullWalls: scene?.walls.filter((wall) => !wall._source.levels.length).length ?? 0,
      inputs: { createMultiSelectInput: (_field, config) => foundry.applications.fields.createMultiSelectInput(config) }
    });
  }

  /**
   * The submitted form values.
   * @returns {{levels: string[], allLevels: boolean, target: object|undefined}} The chosen levels and target
   */
  get formValues() {
    const { levels, allLevels, target } = new FormDataExtended(this.element).object;
    return { levels: [levels ?? []].flat(), allLevels: !!allLevels, target: canvas.scene.levels.get(target) };
  }

  /**
   * Rewrite the level sets of the selection.
   * @this {BulkToolsApp}
   * @param {PointerEvent} _event The click
   * @param {HTMLElement} target The button, whose action names the operation
   * @returns {Promise<void>}
   */
  static async #onSetLevels(_event, target) {
    const operation = target.dataset.action;
    const { levels, allLevels } = this.formValues;
    const levelIds = allLevels && operation !== 'exclude' ? [] : levels;
    if (operation === 'exclude' && !levelIds.length) return;
    await canvas.scene.updateEmbeddedDocuments(this.documentName, levelSetUpdates(this.selection, operation, levelIds));
    await this.render();
  }

  /**
   * Duplicate the selection onto the target level.
   * @this {BulkToolsApp}
   * @returns {Promise<void>}
   */
  static async #onCopy() {
    const { target } = this.formValues;
    if (target) await canvas.scene.createEmbeddedDocuments(this.documentName, copiesOnLevel(this.selection, target));
  }

  /**
   * Move the selection onto the target level.
   * @this {BulkToolsApp}
   * @returns {Promise<void>}
   */
  static async #onMove() {
    const { target } = this.formValues;
    if (target) await canvas.scene.updateEmbeddedDocuments(this.documentName, movesToLevel(this.selection, target));
  }

  /**
   * Paste the layer clipboard at its original position onto the target level.
   * @this {BulkToolsApp}
   * @returns {Promise<void>}
   */
  static async #onPaste() {
    const { target } = this.formValues;
    const documents = canvas.activeLayer.clipboard.objects.map((object) => object.document);
    if (target && documents.length) await canvas.scene.createEmbeddedDocuments(this.documentName, copiesOnLevel(documents, target));
  }

  /**
   * Put every wall without a level on the viewed level.
   * @this {BulkToolsApp}
   * @returns {Promise<void>}
   */
  static async #onRepairWalls() {
    await repairNullLevels(canvas.scene, 'Wall');
    await this.render();
  }
}
