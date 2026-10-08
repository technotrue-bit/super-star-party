/**
 * Loaded only when effects quality is Low or High.
 * One RenderPass plus one EffectPass. Bloom's half-res mip blur, when High
 * asks for it, runs inside that effect. It is not another composer pass.
 */
import {
  BloomEffect,
  BlendFunction,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  RenderPass,
  VignetteEffect,
  type Effect,
} from "postprocessing";
import { UnsignedByteType, type PerspectiveCamera, type Scene, type WebGLRenderer } from "three";
import { settings, type EffectsQuality } from "../config/settings";

export type ActiveEffectsQuality = Exclude<EffectsQuality, "off">;

export interface PostFxSession {
  render(): void;
  setSize(width: number, height: number): void;
  setQuality(quality: ActiveEffectsQuality): void;
  dispose(): void;
  /** Composer passes. Always the RenderPass plus one EffectPass. */
  passCount(): number;
}

function makeEffects(quality: ActiveEffectsQuality): Effect[] {
  const fx = settings.effects;
  const fxaa = new FXAAEffect();
  fxaa.samples = quality === "high" ? fx.fxaaSamplesHigh : fx.fxaaSamplesLow;
  const vignette = new VignetteEffect({
    offset: fx.vignetteOffset,
    darkness: quality === "high" ? fx.vignetteDarknessHigh : fx.vignetteDarknessLow,
  });
  if (quality === "low") return [fxaa, vignette];
  const bloom = new BloomEffect({
    blendFunction: BlendFunction.SCREEN,
    luminanceThreshold: fx.bloomThreshold,
    luminanceSmoothing: fx.bloomSmoothing,
    mipmapBlur: true,
    intensity: fx.bloomIntensity,
    radius: fx.bloomRadius,
    levels: fx.bloomLevels,
  });
  return [bloom, fxaa, vignette];
}

export function createPostFx(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  quality: ActiveEffectsQuality,
): PostFxSession {
  const composer = new EffectComposer(renderer, {
    multisampling: 0,
    frameBufferType: UnsignedByteType,
  });
  composer.addPass(new RenderPass(scene, camera));

  let effectPass = new EffectPass(camera, ...makeEffects(quality));
  composer.addPass(effectPass);

  return {
    render() {
      composer.render();
    },
    setSize(width: number, height: number) {
      composer.setSize(width, height, false);
    },
    setQuality(next: ActiveEffectsQuality) {
      composer.removePass(effectPass);
      effectPass.dispose();
      effectPass = new EffectPass(camera, ...makeEffects(next));
      composer.addPass(effectPass);
    },
    dispose() {
      composer.dispose();
    },
    passCount() {
      return composer.passes.length;
    },
  };
}
