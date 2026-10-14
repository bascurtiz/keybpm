/**
 * Shared Essentia WASM loader with singleton promise.
 */

let essentiaPromise: Promise<{
  instance: any
}> | null = null

export async function getOrInitEssentia(): Promise<any> {
  if (essentiaPromise) return (await essentiaPromise).instance

  essentiaPromise = (async () => {
    // Dynamically import Essentia UMD bundle (WASM included)
    // @ts-expect-error essentia.js lacks TS declarations for UMD paths
    const EssentiaWASMModule = await import('essentia.js/dist/essentia-wasm.umd.js')
    // @ts-expect-error essentia.js lacks TS declarations for UMD paths
    const EssentiaCoreModule = await import('essentia.js/dist/essentia.js-core.umd.js')

    const wasmBackend =
      EssentiaWASMModule.default?.EssentiaWASM ||
      EssentiaWASMModule.EssentiaWASM ||
      (typeof window !== 'undefined' && (window as any).EssentiaWASM) ||
      EssentiaWASMModule.default ||
      EssentiaWASMModule

    const EssentiaCtor =
      EssentiaCoreModule.default?.Essentia ||
      (typeof EssentiaCoreModule.default === 'function' ? EssentiaCoreModule.default : null) ||
      EssentiaCoreModule.Essentia ||
      (typeof window !== 'undefined' && (window as any).Essentia) ||
      EssentiaCoreModule

    if (typeof EssentiaCtor !== 'function') {
      throw new Error(`Essentia constructor could not be resolved: ${typeof EssentiaCtor}`)
    }

    const instance = new EssentiaCtor(wasmBackend)
    return { instance }
  })()

  return (await essentiaPromise).instance
}
