import { useEffect, useState } from 'react'

/** Événement non standard déclenché par le navigateur avant l'invite d'installation. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((fn) => fn())
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

export function useInstallPrompt(): { canInstall: boolean; installed: boolean; install: () => Promise<boolean> } {
  const [canInstall, setCanInstall] = useState(() => deferredPrompt !== null)
  const [installed, setInstalled] = useState(isStandalone)

  useEffect(() => {
    const update = () => {
      setCanInstall(deferredPrompt !== null)
      setInstalled(isStandalone())
    }
    listeners.add(update)
    const mql = window.matchMedia?.('(display-mode: standalone)')
    mql?.addEventListener?.('change', update)
    update()
    return () => {
      listeners.delete(update)
      mql?.removeEventListener?.('change', update)
    }
  }, [])

  const install = async (): Promise<boolean> => {
    if (!deferredPrompt) return false
    const prompt = deferredPrompt
    deferredPrompt = null
    notify()
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    return outcome === 'accepted'
  }

  return { canInstall, installed, install }
}
