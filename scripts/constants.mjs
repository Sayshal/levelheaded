/** @type {object} Module-wide identifiers, setting keys and template paths. */
export const MODULE = {
  ID: 'levelheaded',
  TITLE: 'Levelheaded',

  SETTINGS: {
    LEVEL_WITH_ELEVATION: 'levelWithElevation',
    LAND_AT: 'landAt',
    PLAYER_VIEW_FOLLOWS: 'playerViewFollows',
    KEEP_VIEW_WHEN_SELECTING: 'keepViewWhenSelecting',
    LABELS_ON_OTHER_LEVELS: 'labelsOnOtherLevels',
    SHOW_GMS_EVERY_LABEL: 'showGMsEveryLabel',
    ELEVATION_READOUT: 'elevationReadout',
    ADD_FLOORS_TO_NEW_LEVELS: 'addFloorsToNewLevels',
    ROOF_FADE_TOKENS_GM: 'roofFadeTokensGM',
    ROOF_FADE_TOKENS_PLAYER: 'roofFadeTokensPlayer',
    ROOF_FADE_DELAY: 'roofFadeDelay',
    TILE_FADE_DELAY: 'tileFadeDelay',
    HIDE_ABOVE: 'hideAbove',
    COMPACT_LEVEL_NAV: 'compactLevelNav'
  },

  /** Keybinding action names. */
  KEYBINDINGS: { LEVEL_UP: 'levelUp', LEVEL_DOWN: 'levelDown', HIDE_ABOVE: 'hideAbove' },

  /** Token groups that can trigger occlusion, mapped to core occlusion mode bits by name. */
  OCCLUSION_GROUPS: ['controlled', 'owned', 'hovered', 'highlighted', 'visible'],

  /** Scene flag keys under the module scope. */
  FLAGS: { SYNC_ELEVATION: 'syncElevation', ENVIRONMENT: 'environment', TEMPLATE: 'template' },

  /** Region behavior type id of the silent Change Level variant. */
  BEHAVIOR_TYPE: 'levelheaded.silentChangeLevel',

  TEMPLATES: {
    LEVEL_DOCTOR: 'modules/levelheaded/templates/level-doctor.hbs',
    BULK_TOOLS: 'modules/levelheaded/templates/bulk-tools.hbs',
    FORM_FIELDS: 'modules/levelheaded/templates/form-fields.hbs'
  }
};
