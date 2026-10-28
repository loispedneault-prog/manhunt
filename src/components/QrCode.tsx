import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

export function QrCode({ text, size = 260 }: { text: string; size?: number }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 2, width: size, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then(setSrc)
      .catch(() => setSrc(''))
  }, [text, size])
  return src ? <img className="qr" src={src} width={size} height={size} alt="QR" /> : <div className="qr" style={{ width: size, height: size }} />
}
