import { MODULE } from './constants.mjs';
import { ElevationDisplay } from './features/elevation-display.mjs';
import { Occlusion } from './features/occlusion.mjs';

const { BooleanField, NumberField, SetField, StringField } = foundry.data.fields;

/**
 * Ask every token on the canvas to redraw its labels.
 * @returns {void}
 */
function refreshTokenLabels() {
  ElevationDisplay.resetSettings();
  for (const token of canvas.tokens?.placeables ?? []) token.renderFlags.set({ refreshState: true, refreshTooltip: true });
}

/**
 * Re-run occlusion after a change to which tokens or surfaces occlude.
 * @returns {void}
 */
function refreshOcclusion() {
  if (!canvas.ready) return;
  Occlusion.applyMode();
  canvas.perception.update({ refreshOcclusion: true, refreshOccludedSurfaces: true });
}

/**
 * A set of token groups that trigger occlusion, shown as a multi-select.
 * @param {string[]} initial Default groups
 * @returns {SetField} The field
 */
function occlusionGroupsField(initial) {
  const choices = Object.fromEntries(MODULE.OCCLUSION_GROUPS.map((group) => [group, `LEVELHEADED.Occlusion.Group.${group}`]));
  return new SetField(new StringField({ required: true, blank: false, choices }), { initial });
}

/**
 * Register the module's settings.
 * @returns {void}
 */
export function registerSettings() {
  game.settings.register(MODULE.ID, MODULE.SETTINGS.LEVEL_WITH_ELEVATION, {
    name: 'LEVELHEADED.Settings.LevelWithElevation.Name',
    hint: 'LEVELHEADED.Settings.LevelWithElevation.Hint',
    scope: 'world',
    config: true,
    type: new BooleanField({ initial: true })
  });

  game.settings.register(MODULE.ID, MODULE.SETTINGS.LAND_AT, {
    name: 'LEVELHEADED.Settings.LandAt.Name',
    hint: 'LEVELHEADED.Settings.LandAt.Hint',
    scope: 'client',
    config: true,
    type: new StringField({
      initial: 'base',
      required: true,
      blank: false,
      choices: { base: 'LEVELHEADED.LevelMode.Base', relative: 'LEVELHEADED.LevelMode.Relative', absolute: 'LEVELHEADED.LevelMode.Absolute' }
    })
  });

  game.settings.register(MODULE.ID, MODULE.SETTINGS.PLAYER_VIEW_FOLLOWS, {
    name: 'LEVELHEADED.Settings.PlayerViewFollows.Name',
    hint: 'LEVELHEADED.Settings.PlayerViewFollows.Hint',
    scope: 'world',
    config: true,
    type: new BooleanField({ initial: true })
  });

  game.settings.register(MODULE.ID, MODULE.SETTINGS.KEEP_VIEW_WHEN_SELECTING, {
    name: 'LEVELHEADED.Settings.KeepViewWhenSelecting.Name',
    hint: 'LEVELHEADED.Settings.KeepViewWhenSelecting.Hint',
    scope: 'client',
    config: true,
    type: new BooleanField({ initial: true })
  });

  game.settings.register(MODULE.ID, MODULE.SETTINGS.LABELS_ON_OTHER_LEVELS, {
    name: 'LEVELHEADED.Settings.LabelsOnOtherLevels.Name',
    hint: 'LEVELHEADED.Settings.LabelsOnOtherLevels.Hint',
    scope: 'world',
    config: true,
    type: new StringField({
      initial: 'dim',
      required: true,
      blank: false,
      choices: { show: 'LEVELHEADED.Settings.LabelsOnOtherLevels.Show', dim: 'LEVELHEADED.Settings.LabelsOnOtherLevels.Dim', hide: 'LEVELHEADED.Settings.LabelsOnOtherLevels.Hide' }
    }),
    onChange: refreshTokenLabels
  });

  game.settings.register(MODULE.ID, MODULE.SETTINGS.SHOW_GMS_EVERY_LABEL, {
    name: 'LEVELHEADED.Settings.ShowGMsEveryLabel.Name',
    hint: 'LEVELHEADED.Settings.ShowGMsEveryLabel.Hint',
    scope: 'world',
    config: true,
    type: new BooleanField({ initial: false }),
    onChange: refreshTokenLabels
  });

  game.settings.register(MODULE.ID, MODULE.SETTINGS.ELEVATION_READOUT, {
    name: 'LEVELHEADED.Settings.ElevationReadout.Name',
    hint: 'LEVELHEADED.Settings.ElevationReadout.Hint',
    scope: 'client',
    config: true,
    type: new StringField({
      initial: 'relative',
      required: true,
      blank: false,
      choices: { relative: 'LEVELHEADED.Settings.ElevationReadout.Relative', absolute: 'LEVELHEADED.Settings.ElevationReadout.Absolute' }
    }),
    onChange: refreshTokenLabels
  });

  game.settings.register(MODULE.ID, MODULE.SETTINGS.ADD_FLOORS_TO_NEW_LEVELS, {
    name: 'LEVELHEADED.Settings.AddFloorsToNewLevels.Name',
    hint: 'LEVELHEADED.Settings.AddFloorsToNewLevels.Hint',
    scope: 'world',
    config: true,
    type: new BooleanField({ initial: true })
  });

  game.settings.register(MODULE.ID, MODULE.SETTINGS.ROOF_FADE_TOKENS_GM, {
    name: 'LEVELHEADED.Settings.RoofFadeTokensGM.Name',
    hint: 'LEVELHEADED.Settings.RoofFadeTokensGM.Hint',
    scope: 'world',
    config: true,
    type: occlusionGroupsField(['controlled', 'visible', 'highlighted']),
    onChange: refreshOcclusion
  });

  game.settings.register(MODULE.ID, MODULE.SETTINGS.ROOF_FADE_TOKENS_PLAYER, {
    name: 'LEVELHEADED.Settings.RoofFadeTokensPlayer.Name',
    hint: 'LEVELHEADED.Settings.RoofFadeTokensPlayer.Hint',
    scope: 'world',
    config: true,
    type: occlusionGroupsField(['owned', 'visible']),
    onChange: refreshOcclusion
  });

  game.settings.register(MODULE.ID, MODULE.SETTINGS.ROOF_FADE_DELAY, {
    name: 'LEVELHEADED.Settings.RoofFadeDelay.Name',
    hint: 'LEVELHEADED.Settings.RoofFadeDelay.Hint',
    scope: 'client',
    config: true,
    type: new NumberField({ initial: 0, min: 0, max: 2000, step: 50, nullable: false })
  });

  game.settings.register(MODULE.ID, MODULE.SETTINGS.TILE_FADE_DELAY, {
    name: 'LEVELHEADED.Settings.TileFadeDelay.Name',
    hint: 'LEVELHEADED.Settings.TileFadeDelay.Hint',
    scope: 'client',
    config: true,
    type: new NumberField({ initial: 250, min: 0, max: 2000, step: 50, nullable: false }),
    onChange: (delay) => (CONFIG.Canvas.hoverFade.delay = delay)
  });

  game.settings.register(MODULE.ID, MODULE.SETTINGS.HIDE_ABOVE, {
    scope: 'client',
    config: false,
    type: new BooleanField({ initial: false }),
    onChange: refreshOcclusion
  });

  game.settings.register(MODULE.ID, MODULE.SETTINGS.COMPACT_LEVEL_NAV, {
    scope: 'client',
    config: false,
    type: new BooleanField({ initial: false }),
    onChange: () => ui.nav?.render()
  });
}
