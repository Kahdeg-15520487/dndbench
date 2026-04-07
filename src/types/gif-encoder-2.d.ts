declare module "gif-encoder-2" {
  class GIFEncoder {
    constructor(width: number, height: number, algorithm?: "neuquant" | "octree", repeat?: boolean);
    start(): void;
    setRepeat(repeat: number): void;
    setDelay(delay: number): void;
    setQuality(quality: number): void;
    addFrame(ctx: CanvasRenderingContext2D): void;
    finish(): void;
    out: { getData(): Uint8Array };
  }
  export default GIFEncoder;
}
