export type ThemeMode = 'system' | 'light' | 'dark'
export type DensityMode = 'comfortable' | 'compact'
export type EditorSize = 'small' | 'medium' | 'large'

export type AppSettings = {
  theme: ThemeMode
  density: DensityMode
  editorSize: EditorSize
  defaultAutoApplyPatch: boolean
  evidenceWrap: boolean
  defaultLlmProfileId: string
}

export const SETTINGS_KEY = 'novix.settings.v1'

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  density: 'comfortable',
  editorSize: 'medium',
  defaultAutoApplyPatch: false,
  evidenceWrap: true,
  defaultLlmProfileId: 'mock_default',
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(next: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
}

export function applySettingsToDom(settings: AppSettings) {
  const html = document.documentElement
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark)
  html.classList.toggle('dark', dark)
  html.dataset.density = settings.density
  html.dataset.editorSize = settings.editorSize
}
