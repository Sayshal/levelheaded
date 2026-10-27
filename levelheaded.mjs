import { MODULE } from './scripts/constants.mjs';
import {
  BulkTools,
  ElevationDisplay,
  ElevationSync,
  FloorStack,
  GMView,
  LevelDoctor,
  LevelEnvironment,
  Occlusion,
  PlayerFollow,
  SceneMerge,
  SilentStairs,
  Templates
} from './scripts/features/_module.mjs';
import { registerSettings } from './scripts/settings.mjs';
import './styles/levelheaded.css';

Hooks.once('init', () => {
  ATLAS.register(MODULE.ID, { title: MODULE.TITLE, github: 'Sayshal/levelheaded', theme: { scope: `.${MODULE.ID}`, default: 'solarized' } });
  registerSettings();
  LevelDoctor.register();
  ElevationSync.register();
  ElevationDisplay.register();
  BulkTools.register();
  SilentStairs.register();
  PlayerFollow.register();
  GMView.register();
  Occlusion.register();
  FloorStack.register();
  Templates.register();
  LevelEnvironment.register();
  SceneMerge.register();
});
