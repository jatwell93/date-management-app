declare module "quagga" {
  interface QuaggaStatic {
    init(config: any, callback: (err: any) => void): void;
    start(): void;
    stop(): void;
    onDetected(callback: (data: any) => void): void;
    onProcessed(callback: (data: any) => void): void;
    Result: any;
  }

  const Quagga: QuaggaStatic;
  export default Quagga;
}
