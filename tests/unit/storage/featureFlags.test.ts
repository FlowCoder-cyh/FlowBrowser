import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isV04Enabled } from '../../../src/storage/featureFlags'

describe('featureFlags.isV04Enabled', () => {
  const originalEnv = process.env.FLOWBROWSER_V04

  beforeEach(() => {
    delete process.env.FLOWBROWSER_V04
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FLOWBROWSER_V04
    } else {
      process.env.FLOWBROWSER_V04 = originalEnv
    }
  })

  it('returns false when env unset and setting.v04Enabled is false', () => {
    expect(isV04Enabled({ v04Enabled: false })).toBe(false)
  })

  it('returns true when env unset and setting.v04Enabled is true', () => {
    expect(isV04Enabled({ v04Enabled: true })).toBe(true)
  })

  it('env value "1" forces true regardless of setting', () => {
    process.env.FLOWBROWSER_V04 = '1'
    expect(isV04Enabled({ v04Enabled: false })).toBe(true)
  })

  it('env value "true" forces true regardless of setting', () => {
    process.env.FLOWBROWSER_V04 = 'true'
    expect(isV04Enabled({ v04Enabled: false })).toBe(true)
  })

  it('env value "0" forces false regardless of setting', () => {
    process.env.FLOWBROWSER_V04 = '0'
    expect(isV04Enabled({ v04Enabled: true })).toBe(false)
  })

  it('env value "false" forces false regardless of setting', () => {
    process.env.FLOWBROWSER_V04 = 'false'
    expect(isV04Enabled({ v04Enabled: true })).toBe(false)
  })

  it('env value "yes" (unrecognized) falls back to setting', () => {
    process.env.FLOWBROWSER_V04 = 'yes'
    expect(isV04Enabled({ v04Enabled: true })).toBe(true)
    expect(isV04Enabled({ v04Enabled: false })).toBe(false)
  })
})
