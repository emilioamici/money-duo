export function Donut({ slices, center, sub }: { slices: Array<{ color: string; value: number }>; center: string; sub: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0)
  const r = 60
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <svg viewBox="0 0 160 160" className="mx-auto h-52 w-52" role="img" aria-label="Ripartizione per categoria">
      <circle cx="80" cy="80" r={r} fill="none" stroke="rgb(var(--line))" strokeWidth="22" />
      {total > 0 && slices.map((s, i) => {
        const len = (s.value / total) * c
        const gap = slices.length > 1 ? 1.5 : 0
        const el = <circle key={i} cx="80" cy="80" r={r} fill="none" stroke={s.color} strokeWidth="22" strokeDasharray={`${Math.max(len - gap, 0)} ${c - Math.max(len - gap, 0)}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)" />
        offset += len
        return el
      })}
      <text x="80" y="78" textAnchor="middle" className="fill-ink text-[15px] font-bold">{center}</text>
      <text x="80" y="95" textAnchor="middle" className="fill-muted text-[9px]">{sub}</text>
    </svg>
  )
}
