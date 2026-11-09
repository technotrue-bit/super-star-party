/**
 * Stand-in for `three` when GLTFLoader imports it (vite.config.ts redirects
 * that one file here, like the three-mesh-bvh facade in src/render).
 *
 * Three is one module shared with the boot bundle, so every class a lazy
 * chunk names is hoisted into the main chunk. GLTFLoader names skins,
 * animation tracks, lines, points, PBR materials, point lights and the
 * file/image loaders; importing it straight from `three` grew the main chunk
 * ~12 KB gz. Here the classes the game already ships pass through, and the
 * rest are stand-ins that never run for the city GLB:
 * tools/pack-downtown-assets.mjs packs one unlit vertex-coloured material
 * (GLTFLoader builds a MeshBasicMaterial for it), no textures, skins,
 * animations, lights or cameras, and the theme parses an ArrayBuffer it
 * fetched itself, so no loader here ever fetches a file. Anything else
 * throws with its name.
 */
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  ColorManagement,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  InterpolateDiscrete,
  InterpolateLinear,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearMipmapNearestFilter,
  LinearSRGBColorSpace,
  Material,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MirroredRepeatWrapping,
  NearestFilter,
  NearestMipmapLinearFilter,
  NearestMipmapNearestFilter,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  RepeatWrapping,
  Sphere,
  SpotLight,
  SRGBColorSpace,
  Texture,
  TriangleFanDrawMode,
  TriangleStripDrawMode,
  Vector2,
  Vector3,
} from "three";

export {
  Box3,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  ColorManagement,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  InterpolateDiscrete,
  InterpolateLinear,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearMipmapNearestFilter,
  LinearSRGBColorSpace,
  Material,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MirroredRepeatWrapping,
  NearestFilter,
  NearestMipmapLinearFilter,
  NearestMipmapNearestFilter,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  RepeatWrapping,
  Sphere,
  SpotLight,
  SRGBColorSpace,
  Texture,
  TriangleFanDrawMode,
  TriangleStripDrawMode,
  Vector2,
  Vector3,
};

function notBundled(name: string): Error {
  return new Error(`[SSP] THREE.${name} is not bundled with the Downtown glTF loader (see gltfThreeFacade.ts)`);
}

/** Base class GLTFLoader extends: just the settings it reads and the setters it calls. */
export class Loader {
  manager: unknown;
  crossOrigin = "anonymous";
  withCredentials = false;
  path = "";
  resourcePath = "";
  requestHeader: Record<string, string> = {};

  constructor(manager?: unknown) {
    this.manager = manager ?? null;
  }

  load(..._args: unknown[]): void {
    throw notBundled("Loader.load (parse an ArrayBuffer instead)");
  }

  setCrossOrigin(value: string): this {
    this.crossOrigin = value;
    return this;
  }

  setWithCredentials(value: boolean): this {
    this.withCredentials = value;
    return this;
  }

  setPath(path: string): this {
    this.path = path;
    return this;
  }

  setResourcePath(path: string): this {
    this.resourcePath = path;
    return this;
  }

  setRequestHeader(header: Record<string, string>): this {
    this.requestHeader = header;
    return this;
  }
}

/** The parser builds a file loader and an image loader up front; neither ever loads here. */
class UnusedFetchLoader extends Loader {
  setResponseType(_type: string): this {
    return this;
  }
}

export const FileLoader = UnusedFetchLoader;
export const TextureLoader = UnusedFetchLoader;
export const ImageBitmapLoader = UnusedFetchLoader;

export const LoaderUtils = {
  extractUrlBase(_url: string): string {
    throw notBundled("LoaderUtils");
  },
  resolveURL(_url: string, _path: string): string {
    throw notBundled("LoaderUtils");
  },
};

/** Node names go through this for animation targets; the regex is three's. */
export class PropertyBinding {
  static sanitizeNodeName(name: string): string {
    return name.replace(/\s/g, "_").replace(/[[\].:/]/g, "");
  }
}

/** Throws when constructed. Still a class: GLTFLoader extends Interpolant at module load. */
function standIn(name: string) {
  return class {
    constructor(..._args: unknown[]) {
      throw notBundled(name);
    }
  };
}

export const Interpolant = standIn("Interpolant");
export const AnimationClip = standIn("AnimationClip");
export const NumberKeyframeTrack = standIn("NumberKeyframeTrack");
export const QuaternionKeyframeTrack = standIn("QuaternionKeyframeTrack");
export const VectorKeyframeTrack = standIn("VectorKeyframeTrack");
export const Bone = standIn("Bone");
export const Skeleton = standIn("Skeleton");
export const SkinnedMesh = standIn("SkinnedMesh");
export const Line = standIn("Line");
export const LineLoop = standIn("LineLoop");
export const LineSegments = standIn("LineSegments");
export const LineBasicMaterial = standIn("LineBasicMaterial");
export const Points = standIn("Points");
export const PointsMaterial = standIn("PointsMaterial");
export const MeshStandardMaterial = standIn("MeshStandardMaterial");
export const MeshPhysicalMaterial = standIn("MeshPhysicalMaterial");
export const PointLight = standIn("PointLight");
