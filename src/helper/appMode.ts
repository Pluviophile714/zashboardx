import { Capacitor } from '@capacitor/core'

export const isNativeAppMode =
  Capacitor.isNativePlatform() ||
  new URLSearchParams(window.location.search).has('app') ||
  localStorage.getItem('debug/native-app-mode') === '1'
