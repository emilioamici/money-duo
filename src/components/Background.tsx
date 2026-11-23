/** Sfondo: macchie di colore sfocate che si muovono piano. Stanno dietro a tutto: il vetro le sfoca e le rifrange. */
export function Background() {
  const blob = (v: string) => ({ background: `rgb(var(--${v}))` })
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-bg">
      <div className="absolute -right-32 top-1/4 h-[28rem] w-[28rem] animate-float2 rounded-full blur-3xl" style={blob('blob-b')} />
      <div className="absolute -bottom-32 left-1/4 h-[30rem] w-[30rem] animate-float3 rounded-full blur-3xl" style={blob('blob-c')} />
    </div>
  )
}
