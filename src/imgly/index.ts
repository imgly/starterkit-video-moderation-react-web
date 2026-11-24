/**
 * CE.SDK Video Moderation Editor - Initialization Module
 *
 * This module configures CE.SDK for video moderation workflows:
 * - Video editor with timeline, clips, audio, text and effects
 * - Asset sources for videos, audio, images, text, shapes and effects
 * - An Export Video button in the navigation bar
 *
 * @see https://img.ly/docs/cesdk/js/get-started/overview-e18f40/
 */

import type CreativeEditorSDK from '@cesdk/cesdk-js';

import {
  BlurAssetSource,
  CaptionPresetsAssetSource,
  ImageColorsAssetSource,
  ColorPaletteAssetSource,
  CropPresetsAssetSource,
  DemoAssetSources,
  EffectsAssetSource,
  FiltersAssetSource,
  PagePresetsAssetSource,
  StickerAssetSource,
  TextAssetSource,
  TextComponentAssetSource,
  TypefaceAssetSource,
  UploadAssetSources,
  VectorShapeAssetSource
} from '@cesdk/cesdk-js/plugins';

import { VideoEditorConfig } from './config/plugin';

// Re-export configuration plugin
export { VideoEditorConfig } from './config/plugin';

/**
 * Initialize the CE.SDK Video Moderation Editor.
 *
 * @param cesdk - The CreativeEditorSDK instance to configure
 */
export async function initVideoModerationEditor(
  cesdk: CreativeEditorSDK
): Promise<void> {
  // Configuration Plugin (handles features, UI, settings and the
  // `exportDesign` action that the Export Video button runs)
  await cesdk.addPlugin(new VideoEditorConfig());

  // Asset Source Plugins
  await Promise.all([
    cesdk.addPlugin(new BlurAssetSource()),
    cesdk.addPlugin(new CaptionPresetsAssetSource()),
    cesdk.addPlugin(new ImageColorsAssetSource()),
    cesdk.addPlugin(new ColorPaletteAssetSource()),
    cesdk.addPlugin(new CropPresetsAssetSource()),

    // Upload sources. An uploaded video is checked like any other clip.
    cesdk.addPlugin(
      new UploadAssetSources({
        include: [
          'ly.img.image.upload',
          'ly.img.video.upload',
          'ly.img.audio.upload'
        ]
      })
    ),

    // Demo assets
    cesdk.addPlugin(
      new DemoAssetSources({
        include: ['ly.img.image.*', 'ly.img.audio.*', 'ly.img.video.*']
      })
    ),

    cesdk.addPlugin(new EffectsAssetSource()),
    cesdk.addPlugin(new FiltersAssetSource()),
    cesdk.addPlugin(
      new PagePresetsAssetSource({
        include: [
          'ly.img.page.presets.instagram.*',
          'ly.img.page.presets.tiktok.*',
          'ly.img.page.presets.youtube.*',
          'ly.img.page.presets.video.*'
        ]
      })
    ),
    cesdk.addPlugin(new StickerAssetSource()),
    cesdk.addPlugin(new TextAssetSource()),
    cesdk.addPlugin(new TextComponentAssetSource()),
    cesdk.addPlugin(new TypefaceAssetSource()),
    cesdk.addPlugin(new VectorShapeAssetSource())
  ]);

  // The built-in "Export Video" button, styled as the primary action.
  cesdk.ui.insertOrderComponent(
    { in: 'ly.img.navigation.bar', position: 'end' },
    {
      id: 'ly.img.exportVideo.navigationBar',
      color: 'accent'
    }
  );
}
