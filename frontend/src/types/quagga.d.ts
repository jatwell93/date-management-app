declare module 'quagga' {
  interface QuaggaStatic {
    init(config: unknown, callback: (err: unknown) => void): void;
    start(): void;
    stop(): void;
    onDetected(callback: (data: unknown) => void): void;
    offDetected(callback: (data: unknown) => void): void;
    onProcessed(callback: (data: unknown) => void): void;
    Result: unknown;
  }

  const Quagga: QuaggaStatic;
  export default Quagga;
}
