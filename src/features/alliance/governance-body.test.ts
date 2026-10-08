import { expect, it, vi } from 'vitest'
import { observeGovernanceBody } from './AlliancePanel'

it('fits the full document when its body grows or shrinks, and releases its observer', () => {
  let resize = () => {}
  const observe = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe = observe
    disconnect = disconnect
  })
  const body = { scrollHeight: 200 }
  const frame = {
    style: { height: '600px' },
    contentDocument: { body, get documentElement() { throw new Error('The viewport must not impose a minimum height') } },
  } as unknown as HTMLIFrameElement
  try {
    const stop = observeGovernanceBody(frame)
    expect(frame.style.height).toBe('200px')
    expect(observe).toHaveBeenCalledWith(body)
    body.scrollHeight = 700
    resize()
    expect(frame.style.height).toBe('700px')
    body.scrollHeight = 80
    resize()
    expect(frame.style.height).toBe('80px')
    stop?.()
    expect(disconnect).toHaveBeenCalledOnce()
  } finally { vi.unstubAllGlobals() }
})
