import jsQR from 'jsqr'
import { useEffect, useRef, useState } from 'react'

/** Rear-camera QR reader (jsQR works on iOS Safari, unlike BarcodeDetector). */
export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const done = useRef(false)
  const cb = useRef(onResult)
  cb.current = onResult

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let last = 0
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    let cancelled = false

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      const v = videoRef.current
      if (!v || v.readyState < 2 || t - last < 150 || done.current) return
      last = t
      const scale = Math.min(1, 520 / Math.max(v.videoWidth, v.videoHeight))
      canvas.width = Math.floor(v.videoWidth * scale)
      canvas.height = Math.floor(v.videoHeight * scale)
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
      if (code?.data) {
        done.current = true
        cb.current(code.data)
      }
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(s => {
        if (cancelled) {
          s.getTracks().forEach(t => t.stop())
          return
        }
        stream = s
        const v = videoRef.current!
        v.srcObject = s
        v.setAttribute('playsinline', 'true')
        v.muted = true
        v.play().catch(() => {})
        raf = requestAnimationFrame(loop)
      })
      .catch(() => setError('Caméra indisponible. Utilise le code à 4 caractères.'))

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  return (
    <div className="scanner">
      {error ? <p className="err">{error}</p> : <video ref={videoRef} playsInline muted />}
      <div className="scanner-frame" />
    </div>
  )
}
