/**
 * Rubberband R3 Pitch-Bending and Keylock AudioWorklet node.
 * Uses official Breakfast Quay Rubber Band library compiled to WASM.
 */

export interface RubberBandNode extends AudioWorkletNode {
  setPitch(pitch: number): void
  setTempo(tempo: number): void
  setHighQuality(enabled: boolean): void
  close(): void
}

export function createRubberBandNode(
  context: BaseAudioContext,
  options?: AudioWorkletNodeOptions
): RubberBandNode {
  const node = new AudioWorkletNode(context, 'rubberband-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    ...options,
  }) as RubberBandNode

  node.setPitch = (pitch: number) => {
    node.port.postMessage(JSON.stringify(['pitch', pitch]))
  }

  node.setTempo = (tempo: number) => {
    node.port.postMessage(JSON.stringify(['tempo', tempo]))
  }

  node.setHighQuality = (highQuality: boolean) => {
    node.port.postMessage(JSON.stringify(['quality', highQuality]))
  }

  node.close = () => {
    node.port.postMessage(JSON.stringify(['close']))
  }

  return node
}
